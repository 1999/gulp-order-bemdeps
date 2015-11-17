'use strict';

/**
 * Helper function
 * Returns promise which becomes resolved when all files are collected
 *
 * @param {Stream} stream
 * @return {Promise}
 */
module.exports = function collectStreamFiles(stream) {
    return new Promise((resolve, reject) => {
        let files = [];

        stream.on('data', file => files.push(file));
        stream.on('end', () => resolve(files));
        stream.on('error', reject);
    });
};
