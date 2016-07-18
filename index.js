'use strict';

import vm from 'vm';
import bemNamingParser from 'parse-bem-identifier';
import through2 from 'through2';
import {colors, PluginError} from 'gulp-util';
import TopologicalSort from 'topological-sort';

import collectStreamFiles from './lib/collect-stream-files';
import bemNamingToClassname from './lib/bem-naming-to-classname';
import getFileStem from './lib/get-file-stem';

const PLUGIN_NAME = 'gulp-order-bemdeps';
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
    const files = [];
    let resolver;

    const promise = new Promise(resolve => {
        resolver = resolve;
    });

    const stream = through2.obj((file, encoding, callback) => {
        files.push(file);
        callback();
    }, function (closeStreamCallback) {
        resolver({
            files,
            closeStreamCallback,
            ctx: this
        });
    });

    return {stream, promise};
}

/**
 * Flatten dependencies from deps.js files
 *
 * @return {Array<String>}
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
 * Parse deps.js file contents into flat set of dependencies
 *
 * @param {String} contents
 * @return {Set<String>}
 */
function parseDependencies(contents) {
    let deps = vm.runInThisContext(contents);
    return new Set(flattenDepsJS(deps).filter(Boolean));
}

/**
 * Build block/element basic dependencies from file name
 * What is basic dependency?
 * If file stem is `block__elem` then it is Set(`block`)
 * If file stem is `block_mod_val__elem` then it is Set(`block`, `block_mod_val`)
 *
 * @param {String} stem
 * @return {Array<String>}
 */
function buildBasicDependencies(stem) {
    const bemNaming = bemNamingParser(stem);
    const output = [];

    // validate bem naming
    const isBadNaming = BEM_NAMING_PARSED_KEYS.some(key => bemNaming[key] === '');
    if (isBadNaming) {
        throw new PluginError(PLUGIN_NAME, `Invalid bem naming used: ${stem}`, {showStack: true});
    }

    if (isBlockBemNaming(bemNaming)) {
        return output;
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

    const dependencyStem = bemNamingToClassname(bemNaming);
    output.push(dependencyStem);

    return output.concat(buildBasicDependencies(dependencyStem));
}

/**
 * BEM files reorder
 * It takes deps.js files stream as an argument and reorders input files based on built dependency tree
 * Uses topological sort for building dependency tree.
 *
 * @param {Stream} deps - stream of vinyl deps files (use gulp.src() for this)
 * @return {Stream}
 */
export default function gulpOrderBemDeps(deps) {
    let streamCtx;

    // wait for all input files
    const {
        stream: output,
        promise: inputPromise
    } = getStreamAndPromiseForInputStream();

    Promise.all([
        collectStreamFiles(deps),
        inputPromise
    ]).then(([depsFiles, {files, ctx, closeStreamCallback}]) => {
        streamCtx = ctx;

        // we need to merge files (input stream) with depsFiles (function argument stream)
        // output should also contain basic dependencies (`block` for `block__elem`)
        // we also need to distinguish between existing files in the merged set
        // and those which don't exist (there's no such file in `files` array)
        const mergedNodes = new Map;
        const edges = [];

        // first add all dependencies with their dependencies
        for (let dependencyFile of depsFiles) {
            const stem = getFileStem(dependencyFile.path, '.deps.js');
            const stemDependencies = parseDependencies(dependencyFile.contents.toString('utf8'));

            if (!mergedNodes.has(stem)) {
                mergedNodes.set(stem, {});
            }

            for (let dependencyStem of stemDependencies) {
                if (!mergedNodes.has(dependencyStem)) {
                    mergedNodes.set(dependencyStem, {});
                }

                edges.push([dependencyStem, stem]);
            }
        }

        // then add all files and their basic dependencies
        for (let inputFile of files) {
            const stem = getFileStem(inputFile.path);
            const mergedNode = mergedNodes.get(stem) || {};
            mergedNode.file = inputFile;
            mergedNodes.set(stem, mergedNode);

            const fileDependencies = buildBasicDependencies(stem);

            for (let i = 0; i < fileDependencies.length; i++) {
                const dependencyFileStem = fileDependencies[i];

                if (!mergedNodes.has(dependencyFileStem)) {
                    mergedNodes.set(dependencyFileStem, {});
                }

                const toEdgeKey = (i === 0) ? stem : fileDependencies[i - 1];
                edges.push([fileDependencies[i], toEdgeKey]);
            }
        }

        const sortOp = new TopologicalSort(mergedNodes);
        for (let [fromKey, toKey] of edges) {
            sortOp.addEdge(fromKey, toKey);
        }

        const sorted = sortOp.sort();

        for (let [, value] of sorted) {
            if (value.file) {
                ctx.push(value.file);
            }
        }

        // close stream
        closeStreamCallback();
    }).catch(err => {
        console.error(colors.red(err.message));
        console.error(err.toString());

        streamCtx.emit('error', err);
    });

    return output;
}
