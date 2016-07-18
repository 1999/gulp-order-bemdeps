'use strict';

/**
 * Helper function
 * Returns promise which becomes resolved when all files are collected
 *
 * @param {Stream} stream
 * @return {Promise}
 */
export default function collectStreamFiles(stream) {
    return new Promise((resolve, reject) => {
        const files = [];

        stream.on('data', file => files.push(file));
        stream.on('end', () => resolve(files));
        stream.on('error', reject);
    });
}
