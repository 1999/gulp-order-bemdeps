'use strict';

let path = require('path');

/**
 * Get filename without description
 *
 * @param {String} filePath
 * @param {String} [ext]
 * @return {String}
 */
module.exports = function getFileStem(filePath, ext) {
    filePath = path.resolve(filePath);
    ext = ext || path.extname(filePath);

    return path.basename(filePath, ext);
}
