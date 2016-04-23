'use strict';

import path from 'path';

/**
 * Get filename without description
 *
 * @param {String} filePath
 * @param {String} [ext]
 * @return {String}
 */
export default function getFileStem(filePath, ext) {
    filePath = path.resolve(filePath);
    ext = ext || path.extname(filePath);

    return path.basename(filePath, ext);
}
