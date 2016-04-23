'use strict';

const STEM = Symbol.for('stem');

/**
 * Output tree with BFS. The main difference from original BFS is that in BEM deps tree
 * there can be multiple parents for one node, i.e. ({mustDeps: [{block: 'foo'}, {block: 'bar'}]}).
 * In this case current node/block should be piped out only after its dependencies have been already piped.
 * Simple modification to BFS is checking whether all dependencies have been piped or not.
 * If yes, it's a good time to add current node to processing queue. Otherwise we should skip the node.
 *
 * @param {Array<VinylFile>} files
 * @param {TreeNode} rootNode
 * @param {Map} hashNodes
 * @param {Stream} ctx
 */
export default function bfsOutputTree(files, rootNode, hashNodes, ctx) {
    // convert files into hash table so we could find faster
    const filesHash = new Map();
    for (let file of files) {
        const node = hashNodes.get(file[STEM]);
        filesHash.set(node, file);
    }

    // BFS
    const processingQueue = [rootNode];

    while (processingQueue.length) {
        const node = processingQueue.shift();

        // continue if this node has already been visited
        if (node.visited) {
            continue;
        }

        // output node if all its parents have been visited already
        // else continue
        let allParentsDone = true;
        for (let parentNode of node.parentNodes) {
            if (!parentNode.visited) {
                allParentsDone = false;
                break;
            }
        }

        if (!allParentsDone) {
            continue;
        }

        // do not visit this node later
        node.markVisited();

        // do not output root node (it's virtual node)
        // and nodes which were piped before (completely independent)
        if (node !== rootNode && filesHash.has(node)) {
            ctx.push(filesHash.get(node));
        }

        // add node children to queue
        for (let childNode of node.childNodes) {
            processingQueue.push(childNode);
        }
    }
};
