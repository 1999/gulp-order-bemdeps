'use strict';

module.exports = {
    'admin-post': {
        mustDeps: [
            {block: 'mixins'},
            {block: 'variables'}
        ]
    },

    mixins: {
        mustDeps: [
            {block: 'variables'}
        ]
    },

    variables: {
        mustDeps: [
            {block: 'admin-post'}
        ]
    }
};
