'use strict';

module.exports = {
    block: {
        mustDeps: [
            {block: 'mixins'},
            {block: 'variables'}
        ]
    },

    mixins: {
        mustDeps: [
            {block: 'variables'}
        ]
    }
};
