'use strict';

class TreeNode {
    constructor(stem) {
        this._stem = stem;
        this._dependencies = new Set();
        this._dependents = new Set();
        this._visited = false;
    }

    get childNodes() {
        return this._dependents;
    }

    get parentNodes() {
        return this._dependencies;
    }

    get visited() {
        return this._visited;
    }

    /**
     * Node can be marked as visited if its parents have already been visited
     */
    markVisited() {
        this._visited = true;
    }

    /**
     * There can be multiple parent nodes if block depends on multiple blocks
     * Example is: ({mustDeps: [{block: 'foo'}, {block: 'bar'}]})
     * Parent nodes are `dependencies` of current node
     */
    addParentNode(node) {
        this._dependencies.add(node);
    }

    /**
     * Adds dependent node to the list of childNodes
     */
    addChildNode(node) {
        this._dependents.add(node);
    }
}

/**
 * A little helper function to ensure that tree node exists in hash table
 *
 * @param {Map} hash
 * @param {String} stem
 */
export function ensureExists(hash, stem) {
    if (!hash.has(stem)) {
        const node = new TreeNode(stem);

        // all nodes have root parent node by default
        // it's just a litle hack but because of the fact that blocks/nodes can have
        // multiple parents, it becomes pretty natural
        if (stem) {
            const rootNode = hash.get(null);

            node.addParentNode(rootNode);
            rootNode.addChildNode(node);
        }

        hash.set(stem, node);
    }
};

export default TreeNode;
