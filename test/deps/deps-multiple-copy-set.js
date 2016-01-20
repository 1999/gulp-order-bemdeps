'use strict';

module.exports = {
    'admin-post': {
        mustDeps: [
            {block: 'mixins'},
            {block: 'variables'},
            {block: 'button'}
        ]
    },

    button: {
        mustDeps: [
            {block: 'i-bem__dom'}
        ]
    }
};
