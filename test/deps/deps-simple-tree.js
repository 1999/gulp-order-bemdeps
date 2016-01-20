'use strict';

module.exports = {
    block: {
        mustDeps: [
            {block: 'mixins'}
        ]
    },

    mixins: {
        mustDeps: [
            {block: 'variables'}
        ]
    }
};
