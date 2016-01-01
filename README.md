# gulp-order-bemdeps

[![Build Status](https://img.shields.io/travis/1999/gulp-order-bemdeps.svg?style=flat)](https://travis-ci.org/1999/gulp-order-bemdeps)
[![Dependency Status](http://img.shields.io/david/1999/gulp-order-bemdeps.svg?style=flat)](https://david-dm.org/1999/gulp-order-bemdeps#info=dependencies)
[![DevDependency Status](http://img.shields.io/david/dev/1999/gulp-order-bemdeps.svg?style=flat)](https://david-dm.org/1999/gulp-order-bemdeps#info=devDependencies)

Gulp plugin which reorders a stream of files using deps.js files contents. If you're not familiar with what BEM is or what deps.js files are used for, [this link](https://en.bem.info/technology/deps/about/#depsjs-syntax) is for you.

Post on Medium.com: https://medium.com/@1999/bem-more-than-methodology-less-than-technology-4b66c42da6ef

# Install

```
npm install gulp-order-bemdeps --save-dev
```

# Basic Usage

```javascript
'use strict';

let gulp = require('gulp');
let sass = require('gulp-sass');
let bemDepsOrder = require('gulp-order-bemdeps');

gulp.task('css', () => {
    gulp
        .src([
            'app/blocks/**/*.scss',
            'bower_components/bem-core/**/*.css',
            'app/ymodules/**/*.scss'
        ])
        .pipe(bemDepsOrder(gulp.src([
            'app/**/*deps.js'
        ])))
        .pipe(concat("all.css"))
        .pipe(sass().on('error', sass.logError))
        .pipe(gulp.dest("./"));
});
```

## Options
The only argument is stream of vinyl deps.js files. Use `gulp.src()` for this.
