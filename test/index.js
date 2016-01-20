'use strict';

let path = require('path');
let gutil = require('gulp-util');
let File = gutil.File;

let bemDepsOrder = require('../build');
let expect = require('chai').expect;
let collectStreamFiles = require('../lib/collect-stream-files');
let getFileStem = require('../lib/get-file-stem');

function fillDeps(filename, stream) {
    let files = require(`./deps/${filename}`);

    Object.keys(files).forEach(file => {
        let vinylFile = new File({
            path: path.resolve(__dirname, `${file}.deps.js`),
            contents: new Buffer(`(${JSON.stringify(files[file])})`)
        });

        stream.write(vinylFile);
    });

    stream.end();
}

function fillInputFiles(files, stream) {
    for (let file of files) {
        let vinylFile = new File({
            path: path.resolve(__dirname, `${file}.css`),
            contents: new Buffer('')
        });

        stream.write(vinylFile);
    }

    stream.end();
}

describe('gulp-order-bemdeps', () => {
    it('should not change order of files if no deps.js exist', () => {
        let stream = gutil.noop();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-empty', stream);

        // now pipe input files
        fillInputFiles(['block1', 'block2', 'block3'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).then(files => {
            for (let file of files) {
                expect(file.isBuffer()).to.be.true;
            }

            // files number should stay the same
            expect(files).to.have.length(3);

            // files order should be the same
            expect(getFileStem(files[0].path)).to.equal('block1');
            expect(getFileStem(files[1].path)).to.equal('block2');
            expect(getFileStem(files[2].path)).to.equal('block3');
        });
    });

    it('should reorder files even if no deps.js are supported but files need this', () => {
        let stream = gutil.noop();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-empty', stream);

        // now pipe input files
        fillInputFiles(['block1__elem', 'block1', 'block2'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).then(files => {
            let blockIndex;
            let blockElemIndex;

            files.forEach((file, index) => {
                let stem = getFileStem(file.path);

                if (stem === 'block1') {
                    blockIndex = index;
                } else if (stem === 'block1__elem') {
                    blockElemIndex = index;
                }
            });

            expect(blockIndex).to.be.below(blockElemIndex);
        });
    });

    it('should reorder files in accordance to blocks dependencies', () => {
        let stream = gutil.noop();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-simple-tree', stream);

        // now pipe input files
        fillInputFiles(['mixins', 'block', 'variables'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).then(files => {
            expect(getFileStem(files[0].path)).to.equal('variables');
            expect(getFileStem(files[1].path)).to.equal('mixins');
            expect(getFileStem(files[2].path)).to.equal('block');
        });
    });

    it('should reorder files even if distance to root is different', () => {
        let stream = gutil.noop();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-multiple', stream);

        // now pipe input files
        fillInputFiles(['block', 'mixins', 'variables'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).then(files => {
            expect(getFileStem(files[0].path)).to.equal('variables');
            expect(getFileStem(files[1].path)).to.equal('mixins');
            expect(getFileStem(files[2].path)).to.equal('block');
        });
    });

    it('should reorder files even if its dependency block is not listed inside source files', () => {
        let stream = gutil.noop();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-hidden-dependency', stream);

        // now pipe input files
        fillInputFiles(['block__elem', 'variables', 'block'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).then(files => {
            expect(getFileStem(files[0].path)).to.equal('variables');
            expect(getFileStem(files[1].path)).to.equal('block');
            expect(getFileStem(files[2].path)).to.equal('block__elem');
        });
    });

    it('should stop piping data and show stack if bem naming is invalid', () => {
        let stream = gutil.noop();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-invalid-bem-naming', stream);

        // now pipe input files
        fillInputFiles(['sample-block'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).catch(err => {
            expect(err.message).to.be.equal('Invalid bem naming used: invalid-block____foo');
        });
    });

    it('should calculate tree nodes weight using depth traversal, not width', () => {
        let stream = gutil.noop();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-multiple-copy-set', stream);

        // now pipe input files
        fillInputFiles(['admin-post', 'variables', 'mixins', 'button', 'i-bem__dom'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder);
    });

    it('should show error if circular dependency is detected', () => {
        let stream = gutil.noop();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-circular', stream);

        // now pipe input files
        fillInputFiles(['some-block'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).catch(err => {
            expect(err.message).to.match(new RegExp('^Circular dependency detected'));
        });
    });

    it('should reorder files if deps.js files contain mods object', () => {
        let stream = gutil.noop();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-mods', stream);

        // now pipe input files
        fillInputFiles(['film-header', 'argument_type_movie', 'film-header__argument'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).then(files => {
            expect(getFileStem(files[0].path)).to.equal('argument_type_movie');
            expect(getFileStem(files[1].path)).to.equal('film-header');
            expect(getFileStem(files[2].path)).to.equal('film-header__argument');
        });
    });

    it('should reorder files if deps.js files contain elems array', () => {
        let stream = gutil.noop();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-elems', stream);

        // now pipe input files
        fillInputFiles(['film-header', 'argument', 'argument__series', 'film-header__argument'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).then(files => {
            expect(getFileStem(files[0].path)).to.equal('argument');
            expect(getFileStem(files[1].path)).to.equal('argument__series');
            expect(getFileStem(files[2].path)).to.equal('film-header');
            expect(getFileStem(files[3].path)).to.equal('film-header__argument');
        });
    });
});
