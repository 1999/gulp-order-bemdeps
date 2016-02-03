'use strict';

let vm = require('vm');
let gutil = require('gulp-util');
let bemNamingParser = require('parse-bem-identifier');
let through2 = require('through2');

let PluginError = gutil.PluginError;
let collectStreamFiles = require('./lib/collect-stream-files');
let bemNamingToClassname = require('./lib/bem-naming-to-classname');
let getFileStem = require('./lib/get-file-stem');

const PLUGIN_NAME = 'gulp-bem-css';
const BEM_NAMING = Symbol('bem');
const STEM = Symbol('stem');
const BEM_NAMING_PARSED_KEYS = ['block', 'mod', 'modVal', 'elem', 'elemMod', 'elemVal', 'elemMods'];

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

                        if (modVal === true) {
                            dependencyStem += `_${modName}_${modVal}`;
                        } else {
                            dependencyStem += `_${modName}_${modVal}`;
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
    let output = new Map();

    for (let file of deps) {
        let stem = getFileStem(file.path, '.deps.js');
        let stemDependencies = parseDependencies(file.contents.toString('utf8'));

        if (output.has(stem)) {
            let existingDependencies = output.get(stem);

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
 * If file stem is `block_mod_val__elem` then it is Set(`block`)
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
 * Recursively calculate distance from node to the root element
 *
 * @param {Map} tree - flat tree of all stems
 * @param {String} stem - stem to search for
 * @param {Number} weight - current weight
 * @param {Set} dependencyTree - set of dependencies in case of circular dependency
 * @return {Number}
 */
function calcRecursiveNodeWeight(tree, stem, weight, dependencyTree) {
    weight += 1;

    // probably this file has already been exported
    if (!tree.has(stem)) {
        return weight;
    }

    let dependencies = tree.get(stem);
    if (!dependencies.size) {
        return weight;
    }

    let weights = [];
    for (let dependency of dependencies) {
        if (dependencyTree.has(dependency)) {
            throw new PluginError(PLUGIN_NAME, `Circular dependency detected: ${Array.from(dependencyTree)}`, {showStack: true});
        }

        let nodeDependencyTree = new Set(dependencyTree);
        nodeDependencyTree.add(dependency);

        let dependencyDistanceWeight = calcRecursiveNodeWeight(tree, dependency, weight, nodeDependencyTree, stem);
        weights.push(dependencyDistanceWeight);
    }

    return Math.max(...weights);
}

/**
 * Calculation of tree nodes' weights which is the most important part of the plugin
 * By this time tree consists of all existing deps and input files with their existing dependencies
 * Each tree key is a string file stem (for example `award_important`) and value is a set of dependencies
 * Task is to calculate the longest distance to the root block out of all stem's dependencies
 * If set of stem's dependencies is empty node weight equals 1 (its parent is invisible root node)
 *
 * @param {Map} tree
 * @return {Map}
 */
function calcTreeNodesWeight(tree) {
    let output = new Map();

    for (let [stem,] of tree) {
        let weight = calcRecursiveNodeWeight(tree, stem, 0, new Set());
        output.set(stem, weight);
    }

    return output;
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
function gulpBemCSS(deps) {
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
            let fileStem = getFileStem(file.path);
            let bemNaming = bemNamingParser(fileStem);

            // validate bem naming
            let isBadNaming = BEM_NAMING_PARSED_KEYS.some(key => {
                return bemNaming[key] === '';
            });

            if (isBadNaming) {
                throw new PluginError(PLUGIN_NAME, `Invalid bem naming used: ${fileStem}`, {showStack: true});
            }

            let isBlock = isBlockBemNaming(bemNaming);
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

        // calculate tree nodes' weights
        let treeNodesWeights = calcTreeNodesWeight(tree);

        // 3rd microtask: reorder
        files.sort((a, b) => {
            return (treeNodesWeights.get(a[STEM]) || 0) - (treeNodesWeights.get(b[STEM]) || 0);
        });

        for (let file of files) {
            ctx.push(file);
        }

        // close stream
        closeStreamCallback();
    }).catch(err => {
        console.error(gutil.colors.red(err.message));
        console.error(err.toString());

        streamCtx.emit('error', err);
    });

    return output;
}

module.exports = gulpBemCSS;
