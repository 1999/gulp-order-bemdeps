## 0.8.1

 * bump `topological-sort` package, get rid of deprecated `gulp-util`

## 0.8.0

 * **new**: topological sorting with [topological-sort](https://www.npmjs.com/package/topological-sort). It can be significantly faster on some configurations.
 * `eslint` is now used for linting

## 0.7.0

 * **new**: BFS approach to output sorted files. It can be significantly faster on some configurations.

## 0.6.0

 * **new**: elemMods support

## 0.5.0

 * **new**: `block_mod_val.tech` now depends on `block_mod.tech` and then on `block.tech` files

## 0.4.0

 * **new**: support mods flat arrays (check this test for more info: 2c751031c7ec36b01a94f79020c8157de634b3d6)
 * **new**: support mods value arrays (check this test for more info: 15fa6d2fe2e025d478a2b38b3ae76b9c67dd2f20)

## 0.3.1

 * support `mods` and `elems` keys in deps.js files

## 0.3.0

 * **new**: plugin emits error if smth bad happens (circular dependency, bad BEM naming etc)
 * changes: get rid of vinyl devDependency
 * fix: calculate tree nodes' weight using depth traversal, not width

## 0.2.0

 * **breaking change**: argument to plugin is now stream of vinyl files
 * add: multiple tests to describe plugin behaviour

## 0.1.2

 * a bit cleaner code using destructing assignment and babel plugin for publishing NPM package

## 0.1.1

 * support LTS Node.js version with babel plugin for spread operator which is available in Node.js 5.x

## 0.1.0

 * first release :smiley:
