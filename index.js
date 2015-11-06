'use strict';

let fs = require('fs');
let path = require('path');
let vm = require('vm');
let glob = require('glob');
let gutil = require('gulp-util');
let KinoPromise = require('kinopromise');
let bemNamingParser = require('parse-bem-identifier');
let through2 = require('through2');

let PluginError = gutil.PluginError;
let concat = Array.prototype.concat;

const PLUGIN_NAME = 'gulp-bem-css';
const INTERNAL_STORE_KEY = Symbol('store');
const BEM_NAMING_KEY = Symbol('grouped-blocks');
const BASE_DEPS_DIR = Symbol('base');
const BEM_NAMING_PARSED_KEYS = ['block', 'mod', 'modVal', 'elem', 'elemMod', 'elemVal'];

/**
 * Flatten dependencies from deps.js files
 *
 * @return {Array}
 * @see https://en.bem.info/technology/deps/about/#depsjs-syntax
 */
function flattenDepsJS(deps) {
    let output = [];

    if (!Array.isArray(deps)) {
        deps = [deps];
    }

    deps.forEach(dependency => {
        if (dependency.tech || dependency.noDeps) {
            return;
        }

        if (dependency.mustDeps) {
            output = output.concat(flattenDepsJS(dependency.mustDeps));
            return;
        }

        let dependencyStem = dependency.block;

        if (dependency.mod) {
            dependencyStem += `_${dependency.mod}`;
        }

        if (dependency.val) {
            dependencyStem += `_${dependency.val}`;
        }

        if (dependency.elem) {
            dependencyStem += `__${dependency.elem}`;
        }

        output.push(dependencyStem);
    });

    return output;
}

function getFileStem(filePath, ext) {
    filePath = path.resolve(filePath);
    ext = ext || path.extname(filePath);

    return path.basename(filePath, ext);
}

/**
 * Filter array by leaving only unique dependencies
 *
 * @param {Array} deps
 * @return {Set}
 */
function filterUnique(deps) {
    deps = concat.apply([], deps);
    return new Set(deps);
}

/**
 * Get block/element dependencies from deps.js and file stem
 *
 * @param {Object} dataChunk
 * @return {Promise}
 */
function getDependencies(dataChunk) {
    // basic dependencies
    // if file stem is 'block__elem' it is ['block']
    // if file stem is 'block_mod_val__elem' it is ['block', 'block_mod_val']
    let basicDependencies = [];

    if (dataChunk.bemNaming.mod || dataChunk.bemNaming.elem) {
        // this stem has either modifier or element in it
        // therefore it must depend on simple block
        basicDependencies.push(dataChunk.bemNaming.block);

        if (dataChunk.bemNaming.elemMod) {
            // this stem is something like block__elem_mod_val
            // therefore it must depend on block__elem
            basicDependencies.push(`${dataChunk.bemNaming.block}__${dataChunk.bemNaming.elem}`);
        }

        if (dataChunk.bemNaming.elem && dataChunk.bemNaming.mod) {
            // this stem is something either like block_mod_val__elem or block_mod__elem
            // therefore it must depend on block_mod_val or block_mod
            if (dataChunk.bemNaming.modVal) {
                basicDependencies.push(`${dataChunk.bemNaming.block}_${dataChunk.bemNaming.mod}_${dataChunk.bemNaming.modVal}`);
            } else {
                basicDependencies.push(`${dataChunk.bemNaming.block}_${dataChunk.bemNaming.mod}`);
            }
        }
    }

    if (!dataChunk.file) {
        return Promise.resolve(basicDependencies);
    }

    return new Promise(resolve => {
        fs.readFile(dataChunk.file, {encoding: 'utf8'}, (err, contents) => {
            let deps;

            try {
                deps = vm.runInThisContext(contents);
                deps = flattenDepsJS(deps).filter(Boolean);
            } catch (ex) {
                // TODO warn
            }

            resolve(basicDependencies.concat(deps || []));
        });
    });
}

/**
 * Get depth (length to root node) for this node
 *
 * @param {Object} rawDeps
 * @param {String} stem
 * @return {Number}
 */
function getNodeDepth(rawDeps, stem, base) {
    base = base || 0;

    if (!rawDeps[stem] || !rawDeps[stem].size) {
        return base;
    }

    // stem exists and has dependencies, increment depth
    base += 1;

    // calculate depth for each of dependencies
    // biggest takes the prize
    let dependenciesDepth = [];
    for (let dependencyStem of rawDeps[stem]) {
        dependenciesDepth.push(getNodeDepth(rawDeps, dependencyStem, base));
    }

    return Math.max(...dependenciesDepth);
}

/**
 * Build dependencies tree with nodes from raw list
 *
 * @param {Object} rawDeps
 * @return {Map} where first item is root node
 */
function buildDepthGraph(rawDeps) {
    let knownDepthNodes = [];

    Object.keys(rawDeps).forEach(stem => {
        knownDepthNodes.push({
            depth: getNodeDepth(rawDeps, stem),
            stem: stem
        });
    });

    return knownDepthNodes.sort((a, b) => {
        return (a.depth - b.depth) || a.stem.localeCompare(b.stem);
    }).map(node => node.stem);
}

/**
 * Iterate over tree of dependencies
 * Implements breadth-first search
 *
 * @param {Array} list
 */
function * iterateList(ctx, list) {
    for (let stem of list) {
        let filesList = ctx[BEM_NAMING_KEY].get(stem);

        if (filesList) {
            for (let file of filesList) {
                yield file;
            }
        }
    }
}

function groupByBemNaming(file) {
    this[BEM_NAMING_KEY] = this[BEM_NAMING_KEY] || new Map();

    let fileStem = file.stem || getFileStem(file.path);
    let bemNaming = bemNamingParser(fileStem);

    // validate bem naming
    let isBadNaming = BEM_NAMING_PARSED_KEYS.some(key => {
        return bemNaming[key] === '';
    });

    if (isBadNaming) {
        throw new PluginError(PLUGIN_NAME, `Invalid bem naming used: ${fileStem}`);
    }

    // save bem naming structure to use it afterwards
    file.bemNaming = bemNaming;

    // add file to bemnaming list
    let bemNamingValue = this[BEM_NAMING_KEY].get(fileStem) || [];
    bemNamingValue.push(file);
    this[BEM_NAMING_KEY].set(fileStem, bemNamingValue);

    // TODO sort for levels
}

function buildDependencyTree() {
    return new Promise((resolve, reject) => {
        let base = this[BASE_DEPS_DIR];

        glob(`${base}/**/*.deps.js`, (err, deps) => {
            if (err) {
                reject(err);
                return;
            }

            let stems = new Map();
            let promises = {};

            // first add basic deps for existing files
            for (let [stem, filesList] of this[BEM_NAMING_KEY]) {
                let stemFile = {
                    file: null,
                    bemNaming: filesList[0].bemNaming
                };

                stems.set(stem, [stemFile]);
            }

            for (let file of deps) {
                let stem = getFileStem(file, '.deps.js');
                let bemNaming = bemNamingParser(stem);

                // validate bem naming
                let isBadNaming = BEM_NAMING_PARSED_KEYS.some(key => {
                    return bemNaming[key] === '';
                });

                if (isBadNaming) {
                    reject(new Error(`Invalid bem naming used: ${stem}`));
                    return;
                }

                let stemFiles = stems.get(stem) || [];
                stemFiles.push({file: file, bemNaming: bemNaming});
                stems.set(stem, stemFiles);
            }

            for (let [stem, filesList] of stems) {
                let filesPromises = filesList.map(getDependencies);
                promises[stem] = Promise.all(filesPromises).then(filterUnique);
            }

            KinoPromise.all(promises).then(buildDepthGraph).then(resolve).catch(reject);
        });
    });
}

function transform(file, encoding, callback) {
    // store all files from previous pipe
    this[INTERNAL_STORE_KEY] = this[INTERNAL_STORE_KEY] || [];
    this[INTERNAL_STORE_KEY].push(file);

    callback();
}

function flush(callback) {
    gutil.log('all source files read, queue length is %d', this[INTERNAL_STORE_KEY].length);

    gutil.log('group files by bem blocks naming and sort them');
    this[INTERNAL_STORE_KEY].forEach(groupByBemNaming.bind(this));

    gutil.log('build dependency tree for all blocks/elements');
    buildDependencyTree.call(this).then(tree => {
        for (let file of iterateList(this, tree)) {
            let header = new Buffer(`/* ${file.path}: begin */\n`);
            let footer = new Buffer(`/* ${file.path}: end */\n`);
            file.contents = Buffer.concat([header, file.contents, footer]);

            this.push(file);
        }

        callback();
    }).catch(err => {
        throw new PluginError(PLUGIN_NAME, `Dependency tree build fail: ${err.message}`, {showStack: true});
    });
}

/**
 * BEM CSS files order function
 * Main exported function
 *
 * @param {String} [base = process.cwd()]
 */
function gulpBemCSS(base) {
    let stream = through2.obj(transform, flush);
    stream[BASE_DEPS_DIR] = base || process.cwd();

    return stream;
}

module.exports = gulpBemCSS;
