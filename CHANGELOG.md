# Changelog

## [1.28.0](https://www.github.com/nodejs/node-core-utils/compare/v1.27.2...v1.28.0) (2021-09-20)


### ⚠ BREAKING CHANGES

* **ci:** Removed support for Node.js 10 and 15.

### Features

* prepare ncu for new README format ([#561](https://www.github.com/nodejs/node-core-utils/issues/561)) ([6898338](https://www.github.com/nodejs/node-core-utils/commit/6898338653c6edea657fd7e9a36fb3890fead0e1))


### Bug Fixes

* **cli-separator:** negative value on a long text ([#553](https://www.github.com/nodejs/node-core-utils/issues/553)) ([3e8b07d](https://www.github.com/nodejs/node-core-utils/commit/3e8b07decef270b127b7e2584051b950c686114d))
* **v8:** use V8's main branch ([#555](https://www.github.com/nodejs/node-core-utils/issues/555)) ([241055b](https://www.github.com/nodejs/node-core-utils/commit/241055b22c89b0b89efa9aebb06ea41039eece9d))


### Miscellaneous Chores

* **ci:** test on supported Node.js versions ([dafcdd6](https://www.github.com/nodejs/node-core-utils/commit/dafcdd69fad7e80ca3dea4c6387afe9d504c02c4))
* release 1.28.0 ([0044734](https://www.github.com/nodejs/node-core-utils/commit/00447343615a111a18864e9c7192463b0a38f653))

### [1.27.2](https://www.github.com/nodejs/node-core-utils/compare/v1.27.1...v1.27.2) (2021-07-03)


### Bug Fixes

* **update-v8:** force-add all files after cloning V8 ([#549](https://www.github.com/nodejs/node-core-utils/issues/549)) ([f23ff61](https://www.github.com/nodejs/node-core-utils/commit/f23ff6166bdd774090269352ca9da56132c3d574))

### [1.27.1](https://www.github.com/nodejs/node-core-utils/compare/v1.27.0...v1.27.1) (2021-06-10)


### Bug Fixes

* **pr-checker:** shouldn't fail on SKIPPED ([a578cd7](https://www.github.com/nodejs/node-core-utils/commit/a578cd739b785cdb6ac6c4358dda73d22a7ac690))

## [1.27.0](https://www.github.com/nodejs/node-core-utils/compare/v1.26.0...v1.27.0) (2021-02-26)


### Features

* update CI requirements for landing pull requests ([#533](https://www.github.com/nodejs/node-core-utils/issues/533)) ([ad3c76b](https://www.github.com/nodejs/node-core-utils/commit/ad3c76b3af9e934ff3c3c6b7e44419f518a7bc84))


### Bug Fixes

* **wpt:** download files as buffer instead of text ([#535](https://www.github.com/nodejs/node-core-utils/issues/535)) ([d6fad2a](https://www.github.com/nodejs/node-core-utils/commit/d6fad2a20955a3b7a7eb1626289146609298dabb))
* **wpt:** order version keys alphabetically ([#536](https://www.github.com/nodejs/node-core-utils/issues/536)) ([308982b](https://www.github.com/nodejs/node-core-utils/commit/308982b9cd69c781e4fbd3eb8ed5e68b137a28ca))

## [1.26.0](https://www.github.com/nodejs/node-core-utils/compare/v1.25.0...v1.26.0) (2021-02-08)


### Features

* automate creation of the first LTS release ([#514](https://www.github.com/nodejs/node-core-utils/issues/514)) ([53e68b4](https://www.github.com/nodejs/node-core-utils/commit/53e68b4737c59fae88c740330770f8245bde774b))
* make --checkCI optionable for git-node-land ([#528](https://www.github.com/nodejs/node-core-utils/issues/528)) ([b0be3dd](https://www.github.com/nodejs/node-core-utils/commit/b0be3dd365005236c596396026d8dce9378306a6))


### Bug Fixes

* accommodate case changes in README header ([e8ef932](https://www.github.com/nodejs/node-core-utils/commit/e8ef9329bf3fa23a64915da6d2b3741df5ce6a70))
* fetch most recent 100 commits ([#520](https://www.github.com/nodejs/node-core-utils/issues/520)) ([3c862d1](https://www.github.com/nodejs/node-core-utils/commit/3c862d1d298917287339b0d2d558b522bb2255cf))
* throw on missing info during release prep ([#519](https://www.github.com/nodejs/node-core-utils/issues/519)) ([223d075](https://www.github.com/nodejs/node-core-utils/commit/223d075fc91f421c7f1201b691e9197767b8d465))
* **v8:** correct order of ternary ([#513](https://www.github.com/nodejs/node-core-utils/issues/513)) ([6dab341](https://www.github.com/nodejs/node-core-utils/commit/6dab341314966dea25d277e2bd79ef8d58b4a71b))
* undefined failures & JSON error ([2c0cf83](https://www.github.com/nodejs/node-core-utils/commit/2c0cf834232867e0d0a40cf988ad111dafe17e25))

## [1.25.0](https://www.github.com/nodejs/node-core-utils/compare/v1.24.0...v1.25.0) (2020-09-29)


### Features

* allow to fixup everything into first commit with fixupAll ([4ad4a58](https://www.github.com/nodejs/node-core-utils/commit/4ad4a58a9471d3fd4e27e3b19bae979d91916cef))
* support NCU_VERBOSITY=debug environment variable ([4f84166](https://www.github.com/nodejs/node-core-utils/commit/4f841663818ace8721af1c18212f1f5928e5ce46))


### Bug Fixes

* git node metadata arg passing ([#500](https://www.github.com/nodejs/node-core-utils/issues/500)) ([55c780e](https://www.github.com/nodejs/node-core-utils/commit/55c780e52f03ecf38fc74177f8ee0d1e950ffd8d))
* handle citgm failures better ([#497](https://www.github.com/nodejs/node-core-utils/issues/497)) ([a429893](https://www.github.com/nodejs/node-core-utils/commit/a4298938f84382588db3101dcf611d89f6f0f1e9))

## [1.24.0](https://www.github.com/nodejs/node-core-utils/compare/v1.23.0...v1.24.0) (2020-08-21)


### Features

* check Actions and handle doc-only changes ([855f1d4](https://www.github.com/nodejs/node-core-utils/commit/855f1d46bd70aa54037111138a0d4b7a59f3001b))
* implement autorebase for PRs with multiple commits ([17ea885](https://www.github.com/nodejs/node-core-utils/commit/17ea88569ccae245017f9851f5a6e64b1ca6566c))
* make lint check opt-in ([b567c1e](https://www.github.com/nodejs/node-core-utils/commit/b567c1e57acec50abc12c49f51c93837a7ccd5e4))
* **git-node:** add git-node status ([ebc8fb2](https://www.github.com/nodejs/node-core-utils/commit/ebc8fb2652c9eaef5af556b6be0db089e8f29320))


### Bug Fixes

* allow opt-out of Fixes/Refs metadata ([#474](https://www.github.com/nodejs/node-core-utils/issues/474)) ([df5c572](https://www.github.com/nodejs/node-core-utils/commit/df5c572cded5a1b96da0894d3e3b15019116c594))
* lint during the landing process ([#435](https://www.github.com/nodejs/node-core-utils/issues/435)) ([de6d1e2](https://www.github.com/nodejs/node-core-utils/commit/de6d1e22fb11b344ba581b52627c36a3df910294))
* prevent duplicate and self-refs ([#478](https://www.github.com/nodejs/node-core-utils/issues/478)) ([95300fd](https://www.github.com/nodejs/node-core-utils/commit/95300fdcd98c1a1f5bd5d1f5dcbc8f96922096f8))
* properly handle failure to start CI ([48c306b](https://www.github.com/nodejs/node-core-utils/commit/48c306b4d84aacb799b75eaae1fe304eed0639fd))
* return value for validateLint ([#482](https://www.github.com/nodejs/node-core-utils/issues/482)) ([e379e9f](https://www.github.com/nodejs/node-core-utils/commit/e379e9f94688e38b7da5367eaadcfb7af74609a0))
* **v8:** support non-relative paths in V8 DEPS ([#471](https://www.github.com/nodejs/node-core-utils/issues/471)) ([746e5e5](https://www.github.com/nodejs/node-core-utils/commit/746e5e593a7af2244877cdee5282b9c3a507d2d5))
* repo/path mismatch in v8 update ([#465](https://www.github.com/nodejs/node-core-utils/issues/465)) ([57b7df8](https://www.github.com/nodejs/node-core-utils/commit/57b7df8016a3d1495be4f67fc3cc34db21a2b3a6))
