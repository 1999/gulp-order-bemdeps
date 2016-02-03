'use strict';

module.exports = {
    'film-header': {
        mustDeps: [
            {
                block: 'button',
                elem: 'elem',
                elemMods: {
                    size: 's'
                }
            }
        ]
    },

    'button': {
        mustDeps: [
            {
                block: 'input',
                elem: 'elem',
                elemMods: {
                    size: 's'
                }
            }
        ]
    }
};
