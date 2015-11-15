'use strict';

/**
 * Helper function
 * Returns promise which becomes resolved when all files are collected
 *
 * @param {Stream} stream
 * @return {Promise}
 */
module.exports = function collectStreamFiles(stream) {
    return new Promise(resolve => {
        let files = [];

        stream.on('data', file => files.push(file));
        stream.on('end', () => resolve(files));
    });
};
