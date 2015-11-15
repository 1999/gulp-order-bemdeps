'use strict';

let path = require('path');
let through2 = require('through2');
let File = require('vinyl');

let bemDepsOrder = require('../build');
let expect = require('chai').expect;
let collectStreamFiles = require('../lib/collect-stream-files');

function fillDeps(filename, stream) {
    let files = require(`./${filename}`);

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
        let stream = through2.obj();
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
            expect(files[0].stem).to.equal('block1');
            expect(files[1].stem).to.equal('block2');
            expect(files[2].stem).to.equal('block3');
        });
    });

    it('should reorder files even if no deps.js are supported but files need this', () => {
        let stream = through2.obj();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-empty', stream);

        // now pipe input files
        fillInputFiles(['block1__elem', 'block1', 'block2'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).then(files => {
            let blockIndex;
            let blockElemIndex;

            files.forEach((file, index) => {
                if (file.stem === 'block1') {
                    blockIndex = index;
                } else if (file.stem === 'block1__elem') {
                    blockElemIndex = index;
                }
            });

            expect(blockIndex).to.be.below(blockElemIndex);
        });
    });

    it('should reorder files in accordance to blocks dependencies', () => {
        let stream = through2.obj();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-simple-tree', stream);

        // now pipe input files
        fillInputFiles(['mixins', 'block', 'variables'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).then(files => {
            expect(files[0].stem).to.equal('variables');
            expect(files[1].stem).to.equal('mixins');
            expect(files[2].stem).to.equal('block');
        });
    });

    it('should reorder files even if distance to root is different', () => {
        let stream = through2.obj();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-multiple', stream);

        // now pipe input files
        fillInputFiles(['block', 'mixins', 'variables'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).then(files => {
            expect(files[0].stem).to.equal('variables');
            expect(files[1].stem).to.equal('mixins');
            expect(files[2].stem).to.equal('block');
        });
    });

    it('should reorder files even if its dependency block is not listed inside source files', () => {
        let stream = through2.obj();
        let myBemDepsOrder = bemDepsOrder(stream);

        // fill dependencies
        fillDeps('deps-hidden-dependency', stream);

        // now pipe input files
        fillInputFiles(['block__elem', 'variables', 'block'], myBemDepsOrder);

        return collectStreamFiles(myBemDepsOrder).then(files => {
            expect(files[0].stem).to.equal('variables');
            expect(files[1].stem).to.equal('block');
            expect(files[2].stem).to.equal('block__elem');
        });
    });
});
