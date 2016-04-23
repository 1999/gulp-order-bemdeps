'use strict';

import vm from 'vm';
import bemNamingParser from 'parse-bem-identifier';
import through2 from 'through2';
import {colors, PluginError} from 'gulp-util';

import collectStreamFiles from './lib/collect-stream-files';
import bemNamingToClassname from './lib/bem-naming-to-classname';
import getFileStem from './lib/get-file-stem';
import TreeNode, {ensureExists} from './lib/tree-node';
import bfsOutputTree from './lib/bfs-output-tree';

const PLUGIN_NAME = 'gulp-order-bemdeps';
const BEM_NAMING = Symbol('bem');
const STEM = Symbol.for('stem');
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
 * Build tree from all deps.js files
 * Also build hash table with all tree nodes for fast insert op
 *
 * @param {Array<VinylFile>} deps
 * @return {Array<TreeNode, Map>} 2-elements array: [rootNode, hash]
 */
function combineDeps(deps) {
    const hashNodes = new Map();
    const rootNode = new TreeNode(null);

    // add root node to hash table
    hashNodes.set(null, rootNode);

    for (let file of deps) {
        const stem = getFileStem(file.path, '.deps.js');
        const stemDependencies = parseDependencies(file.contents.toString('utf8'));

        // ensure that node exists in hash table
        ensureExists(hashNodes, stem);

        // iterate through dependency (parent) nodes and add references
        // if tree is independent, add rootNode to its dependencies
        const treeNode = hashNodes.get(stem);

        if (!stemDependencies.size) {
            stemDependencies.add(null);
        }

        for (let dependencyStem of stemDependencies) {
            // ensure that dependency node exists in hash table
            ensureExists(hashNodes, dependencyStem);

            const parentNode = hashNodes.get(dependencyStem);
            treeNode.addParentNode(parentNode);
            parentNode.addChildNode(treeNode);
        }
    }

    return [rootNode, hashNodes];
}

function addTreeNodeDependency(hashNodes, stem, dependency) {
    ensureExists(hashNodes, stem);

    if (dependency) {
        ensureExists(hashNodes, dependency);

        const node = hashNodes.get(stem);
        const parent = hashNodes.get(dependency);

        node.addParentNode(parent);
        parent.addChildNode(node);
    }
}

function addRecursiveNodeDependencies(hashNodes, bemNaming) {
    const isBlock = isBlockBemNaming(bemNaming);
    const stem = bemNamingToClassname(bemNaming);

    if (isBlock) {
        // in case basic block is missing among deps, add it
        addTreeNodeDependency(hashNodes, bemNaming.block);
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

    addTreeNodeDependency(hashNodes, stem, bemNamingToClassname(bemNaming));
    addRecursiveNodeDependencies(hashNodes, bemNaming);
}

/**
 * Add block/element basic dependencies to flat tree. What is basic dependency?
 * If file stem is `block__elem` then it is Set(`block`)
 * If file stem is `block_mod_val__elem` then it is Set(`block`, `block_mod_val`)
 *
 * @param {Map} hashNodes
 * @param {TreeNode} rootNode
 */
function addBasicDependencies(hashNodes, rootNode) {
    for (let [stem, node] of hashNodes) {
        // skip root node
        if (node === rootNode) {
            continue;
        }

        const bemNaming = bemNamingParser(stem);

        // validate bem naming
        const isBadNaming = BEM_NAMING_PARSED_KEYS.some(key => bemNaming[key] === '');
        if (isBadNaming) {
            throw new PluginError(PLUGIN_NAME, `Invalid bem naming used: ${stem}`, {showStack: true});
        }

        addRecursiveNodeDependencies(hashNodes, bemNaming);
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
    ]).then(([
        [rootNode, hashNodes],
        {files, ctx, closeStreamCallback}
    ]) => {
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
            if (isBlock && !hashNodes.has(bemNaming.block)) {
                ctx.push(file);
                return false;
            }

            // build microdeps tree and inject it into the main one
            file[BEM_NAMING] = bemNaming;
            file[STEM] = fileStem;

            ensureExists(hashNodes, fileStem);
            return true;
        });

        // add missing basic dependencies
        addBasicDependencies(hashNodes, rootNode);

        // 3rd microtask: output
        bfsOutputTree(files, rootNode, hashNodes, ctx);

        // close stream
        closeStreamCallback();
    }).catch(err => {
        console.error(colors.red(err.message));
        console.error(err.toString());

        streamCtx.emit('error', err);
    });

    return output;
}

module.exports = gulpOrderBemDeps;
