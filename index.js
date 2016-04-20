'use strict';

let vm = require('vm');
let gutil = require('gulp-util');
let bemNamingParser = require('parse-bem-identifier');
let through2 = require('through2');

let PluginError = gutil.PluginError;
let collectStreamFiles = require('./lib/collect-stream-files');
let bemNamingToClassname = require('./lib/bem-naming-to-classname');
let getFileStem = require('./lib/get-file-stem');

const PLUGIN_NAME = 'gulp-order-bemdeps';
const BEM_NAMING = Symbol('bem');
const STEM = Symbol('stem');
const BEM_NAMING_PARSED_KEYS = ['block', 'mod', 'modVal', 'elem', 'elemMod', 'elemVal'];

/**
 * Helper function
 * Detects whether stem is block-only or not
 *
 * @param {Object} bemNaming - object got from bemNamingParser
 * @return {Boolean}
 */
function isBlockBemNaming(bemNaming) {
    return BEM_NAMING_PARSED_KEYS.every(key => {
        return key === 'block'
            ? bemNaming[key] !== undefined
            : bemNaming[key] === undefined;
    });
}

/**
 * Helper function
 * Returns stream to be exported out of main exported function
 * And promise which becomes resolved when all of input files are collected
 *
 * @return {Object}
 */
function getStreamAndPromiseForInputStream() {
    let resolver;
    let files = [];

    let promise = new Promise(resolve => {
        resolver = resolve;
    });

    let stream = through2.obj((file, encoding, callback) => {
        files.push(file);
        callback();
    }, function (closeStreamCallback) {
        resolver({
            files: files,
            ctx: this,
            closeStreamCallback: closeStreamCallback
        });
    });

    return {
        stream: stream,
        promise: promise
    };
}

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

        if (typeof dependency.mods === 'object') {
            if (Array.isArray(dependency.mods)) {
                for (let modName of dependency.mods) {
                    output.push(`${dependencyStem}_${modName}`);
                }
            } else {
                Object.keys(dependency.mods).forEach(modName => {
                    const modVal = dependency.mods[modName];

                    if (Array.isArray(modVal)) {
                        for (let modFinalVal of modVal) {
                            output.push(`${dependencyStem}_${modName}_${modFinalVal}`);
                        }
                    } else if (typeof modVal === 'boolean') {
                        output.push(`${dependencyStem}_${modName}`);
                    } else {
                        output.push(`${dependencyStem}_${modName}_${modVal}`);
                        output.push(`${dependencyStem}_${modName}`);
                    }
                });
            }
        } else if (Array.isArray(dependency.elems)) {
            for (let elem of dependency.elems) {
                output.push(`${dependencyStem}__${elem}`);
            }
        } else {
            if (dependency.mod) {
                dependencyStem += `_${dependency.mod}`;
            }

            if (dependency.val) {
                dependencyStem += `_${dependency.val}`;
            }

            if (dependency.elem) {
                dependencyStem += `__${dependency.elem}`;

                let {elemMods} = dependency;

                if (elemMods) {
                    Object.keys(elemMods).forEach(modName => {
                        let modVal = elemMods[modName];

                        dependencyStem += `_${modName}`;
                        output.push(dependencyStem);

                        if (typeof modVal !== 'boolean') {
                            dependencyStem += `_${modVal}`;
                        }
                    });
                }
            }

            output.push(dependencyStem);
        }
    });

    return output;
}

/**
 * Parse deps.js file contents into flat array of dependencies
 *
 * @param {String} contents
 * @return {Set}
 */
function parseDependencies(contents) {
    let deps = vm.runInThisContext(contents);
    return new Set(flattenDepsJS(deps).filter(Boolean));
}

/**
 * Combine all deps.js files into one map
 * This is useful because there can be multiple files with one stem (they are resolved with `levels` in ENB/BEM)
 *
 * @param {Array} deps
 * @return {Map} where keys are {String} stems and values are {Set} with dependencies of this stem
 */
function combineDeps(deps) {
    const output = new Map();

    for (let file of deps) {
        const stem = getFileStem(file.path, '.deps.js');
        const stemDependencies = parseDependencies(file.contents.toString('utf8'));

        if (output.has(stem)) {
            const existingDependencies = output.get(stem);

            for (let dependency of stemDependencies) {
                existingDependencies.add(dependency);
            }
        } else {
            output.set(stem, stemDependencies);
        }
    }

    return output;
}

function addTreeNodeDependency(tree, stem, dependency) {
    if (!tree.has(stem)) {
        tree.set(stem, new Set());
    }

    if (dependency) {
        tree.get(stem).add(dependency);
    }
}

function addRecursiveNodeDependencies(tree, bemNaming) {
    let isBlock = isBlockBemNaming(bemNaming);
    let stem = bemNamingToClassname(bemNaming);

    if (isBlock) {
        // in case basic block is missing among deps, add it
        addTreeNodeDependency(tree, bemNaming.block);
        return;
    }

    if (bemNaming.elemModVal) {
        delete bemNaming.elemModVal;
    } else if (bemNaming.elemMod) {
        delete bemNaming.elemMod;
    } else if (bemNaming.elem) {
        delete bemNaming.elem;
    } else if (bemNaming.modVal) {
        delete bemNaming.modVal;
    } else if (bemNaming.mod) {
        delete bemNaming.mod;
    }

    addTreeNodeDependency(tree, stem, bemNamingToClassname(bemNaming));
    addRecursiveNodeDependencies(tree, bemNaming);
}

/**
 * Add block/element basic dependencies to flat tree. What is basic dependency?
 * If file stem is `block__elem` then it is Set(`block`)
 * If file stem is `block_mod_val__elem` then it is Set(`block`, `block_mod_val`)
 *
 * @param {Map} tree
 */
function addBasicDependencies(tree) {
    for (let [stem,] of tree) {
        let bemNaming = bemNamingParser(stem);

        // validate bem naming
        let isBadNaming = BEM_NAMING_PARSED_KEYS.some(key => {
            return bemNaming[key] === '';
        });

        if (isBadNaming) {
            throw new PluginError(PLUGIN_NAME, `Invalid bem naming used: ${stem}`, {showStack: true});
        }

        addRecursiveNodeDependencies(tree, bemNaming);
    }
}

/**
 * Add essential dependencies to tree. What is essential dependency?
 * If file stem is `mixins` and it depends on `variables` and there's no `variables` in tree
 * then it's `variables`
 *
 * @param {Map} tree
 */
function addRootDependencies(tree) {
    for (let [stem, dependencies] of tree) {
        for (let dependencyStem of dependencies) {
            if (!tree.has(dependencyStem)) {
                tree.set(dependencyStem, new Set());
            }
        }
    }
}

/**
 * Output tree with BFS
 *
 * @param {Array<VinylFile>} files
 * @param {Map<String:Set>} tree
 * @param {Stream} ctx
 */
function bfsOutputTree(files, tree, ctx) {
    // convert files into hash table so we could find faster
    const filesHash = new Map();
    for (let file of files) {
        filesHash.set(file[STEM], file);
    }

    // convert dependency tree to the opposite side:
    // right now tree node value is its dependencies i.e. stems is depends on
    // new tree node value is its dependent i.e. stems which depend on current node
    const treeDependents = new Map();
    for (let [stem, dependencies] of tree) {
        if (!treeDependents.has(stem)) {
            treeDependents.set(stem, new Set())
        }

        for (let dependencyStem of dependencies) {
            if (!treeDependents.has(dependencyStem)) {
                treeDependents.set(dependencyStem, new Set());
            }

            treeDependents.get(dependencyStem).add(stem);
        }
    }

    // find all tree nodes which have no dependencies: these are root node children
    // then add fake root node with these nodes to start BFS
    const rootNodeStem = Symbol('root');
    const rootNodeChildren = new Set();

    for (let [stem, dependencies] of tree) {
        if (!dependencies.size) {
            rootNodeChildren.add(stem);
        }
    }

    // first add root node into processing queue
    const processingQueue = [{
        dependents: rootNodeChildren,
        stem: rootNodeStem
    }];

    while (processingQueue.length) {
        const treeNode = processingQueue.shift();

        // output file corresponding to node if it's not root node
        if (treeNode.stem !== rootNodeStem && filesHash.has(treeNode.stem)) {
            const file = filesHash.get(treeNode.stem);

            ctx.push(file);
            filesHash.delete(treeNode.stem);
        }

        for (let stem of treeNode.dependents) {
            // this node has probably been processed already
            if (!treeDependents.has(stem)) {
                continue;
            }

            const childNodeDependents = treeDependents.get(stem);

            // add node to processing queue
            processingQueue.push({
                stem,
                dependents: childNodeDependents
            });

            // delete it from tree so it won't be processed twice
            treeDependents.delete(stem);
        }
    }
}

/**
 * BEM files reorder (main exported function)
 * It takes deps.js files stream as an argument and reorders input files based on built dependency tree
 * Task can be divided into three small microtasks:
 *
 * 1) Get all deps.js files and build dependency tree. There can be blocks which don't have own deps.js file
 *     which means that this block doesn't depend on anything and can be exported (sent out of pipe) right now.
 *     But also there can be input files like `award_mod_val.css` without their own deps.js files. Instead these
 *     files depend on their main block (award) which can have its own deps.js file.
 * 2) Get all input files and start iteration. If file is block (not block__elem or block_mod) and dependency tree
 *     which was built during step 1 doesn't contain it, it is independent block and can be exported right now. if this
 *     file is element declaration (`award__item.css`) or anything else which depends on smth, one should build a micro-
 *     dependency tree for this file and inject into main dependency tree.
 * 3) Re-order! One should iterate over all input files and sort them in accordance to their weight in dependency tree
 *
 * @param {Stream} deps - stream of vinyl deps files (use gulp.src() for this)
 * @return {Stream}
 */
function gulpOrderBemDeps(deps) {
    let streamCtx;

    let {
        stream: output,
        promise: inputPromise
    } = getStreamAndPromiseForInputStream();

    // first and second microtasks do not depend on each other so it's safe
    // to perform them in parallel
    Promise.all([
        collectStreamFiles(deps).then(combineDeps),
        inputPromise
    ]).then(([tree, {files, ctx, closeStreamCallback}]) => {
        streamCtx = ctx;

        // filter block files with no dependencies (2nd microtask)
        files = files.filter(file => {
            const fileStem = getFileStem(file.path);
            const bemNaming = bemNamingParser(fileStem);

            // validate bem naming
            const isBadNaming = BEM_NAMING_PARSED_KEYS.some(key => {
                return bemNaming[key] === '';
            });

            if (isBadNaming) {
                throw new PluginError(PLUGIN_NAME, `Invalid bem naming used: ${fileStem}`, {showStack: true});
            }

            // if file stem is not listed in dependencies tree it's independent
            // so it's safe to output it right now
            const isBlock = isBlockBemNaming(bemNaming);
            if (isBlock && !tree.has(bemNaming.block)) {
                ctx.push(file);
                return false;
            }

            // build microdeps tree and inject it into the main one
            file[BEM_NAMING] = bemNaming;
            file[STEM] = fileStem;

            if (!tree.has(fileStem)) {
                tree.set(fileStem, new Set());
            }

            return true;
        });

        // add missing basic dependencies
        addBasicDependencies(tree);

        // add essential dependencies (block->mixins->variables: add variables)
        addRootDependencies(tree);

        // 3rd microtask: reorder and output
        bfsOutputTree(files, tree, ctx);

        // close stream
        closeStreamCallback();
    }).catch(err => {
        console.error(gutil.colors.red(err.message));
        console.error(err.toString());

        streamCtx.emit('error', err);
    });

    return output;
}

module.exports = gulpOrderBemDeps;
