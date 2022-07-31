# Changelog

## [2.0.1](https://github.com/nodejs/node-core-utils/compare/v2.0.0...v2.0.1) (2022-07-31)


### Bug Fixes

* add a specific error message for the commit queue ([#645](https://github.com/nodejs/node-core-utils/issues/645)) ([3d6ece6](https://github.com/nodejs/node-core-utils/commit/3d6ece6e2d25d66be1fcec65eea26ae695f793e8))
* parse ci failure error ([#640](https://github.com/nodejs/node-core-utils/issues/640)) ([0d49eda](https://github.com/nodejs/node-core-utils/commit/0d49edaf6736b393b0597ee67d70381cd5841b40))
* respect existing trailers in commit messages ([#632](https://github.com/nodejs/node-core-utils/issues/632)) ([f442797](https://github.com/nodejs/node-core-utils/commit/f44279701b6a426341e1e665d16e0182a5787336))

## [2.0.0](https://github.com/nodejs/node-core-utils/compare/v1.31.4...v2.0.0) (2022-06-22)


### ⚠ BREAKING CHANGES

* **ci:** Removed support for Node.js 12 and 17.

### Bug Fixes

* broken enquirer in listr2 ([#636](https://github.com/nodejs/node-core-utils/issues/636)) ([460b50d](https://github.com/nodejs/node-core-utils/commit/460b50dcea878a6234021448441395efefaeb2bf))


### Miscellaneous Chores

* **ci:** test on supported Node.js versions ([40a1ee2](https://github.com/nodejs/node-core-utils/commit/40a1ee220b058a1ce2b6e513d75d2a5ea0124633))

### [1.31.4](https://github.com/nodejs/node-core-utils/compare/v1.31.3...v1.31.4) (2022-04-25)


### Bug Fixes

* add trailing line feed to formatted JSON ([#623](https://github.com/nodejs/node-core-utils/issues/623)) ([1bcc72b](https://github.com/nodejs/node-core-utils/commit/1bcc72baa60c8d660f1b493c09017d1da4093b8c))
* check last fast-track request comment ([#606](https://github.com/nodejs/node-core-utils/issues/606)) ([19ddfb6](https://github.com/nodejs/node-core-utils/commit/19ddfb64bf53b0cceab9a4a039fe74af79cdee9d))
* **config:** add file path to error message when parsing fails ([#608](https://github.com/nodejs/node-core-utils/issues/608)) ([7c73862](https://github.com/nodejs/node-core-utils/commit/7c73862b1f2817983d986ae2aaa1c35f57210aa3))
* use res.arrayBuffer() instead of res.buffer() ([#624](https://github.com/nodejs/node-core-utils/issues/624)) ([03b4b70](https://github.com/nodejs/node-core-utils/commit/03b4b704065d5d6b9294cf6913f03de0b8072f92))

### [1.31.3](https://github.com/nodejs/node-core-utils/compare/v1.31.2...v1.31.3) (2022-04-19)


### Bug Fixes

* use `getUrlFromOP()` for `fixes` links ([#614](https://github.com/nodejs/node-core-utils/issues/614)) ([4b0e94b](https://github.com/nodejs/node-core-utils/commit/4b0e94b08a81e98aa04d7912e582f66dc5726b1e))

### [1.31.2](https://github.com/nodejs/node-core-utils/compare/v1.31.1...v1.31.2) (2022-04-08)


### Bug Fixes

* correct username and token validation ([64a977c](https://github.com/nodejs/node-core-utils/commit/64a977c1739be74a0e4b78f2004b43f9ddcb6615))
* update permitted GitHub token characters ([dc3d3ef](https://github.com/nodejs/node-core-utils/commit/dc3d3efb320a838380aef2eb231644036aa015ec))

### [1.31.1](https://www.github.com/nodejs/node-core-utils/compare/v1.31.0...v1.31.1) (2022-03-17)


### Bug Fixes

* comply with markdown style guidelines ([13d7b2d](https://www.github.com/nodejs/node-core-utils/commit/13d7b2dbb174a73f3f32010ab4b7396143bd986e))

## [1.31.0](https://www.github.com/nodejs/node-core-utils/compare/v1.30.1...v1.31.0) (2021-12-21)


### Features

* check fast-track approvals ([#588](https://www.github.com/nodejs/node-core-utils/issues/588)) ([d0215d6](https://www.github.com/nodejs/node-core-utils/commit/d0215d6bdcaa7ec087992dbc29ebcae15e81dff5))


### Bug Fixes

* allow pending dependabot checks in PR checker ([829c68d](https://www.github.com/nodejs/node-core-utils/commit/829c68dbfed0b56a0f56534aa1ca6de5a6289b30))
* fetch first 100 check suites in PR checker ([e98d72e](https://www.github.com/nodejs/node-core-utils/commit/e98d72ef49d32d8b8a0605cce222cb8aaab8c128))

### [1.30.1](https://www.github.com/nodejs/node-core-utils/compare/v1.30.0...v1.30.1) (2021-11-17)


### Bug Fixes

* **deps:** revert to node-fetch ([#595](https://www.github.com/nodejs/node-core-utils/issues/595)) ([e475060](https://www.github.com/nodejs/node-core-utils/commit/e4750602c59ae40c06835a86da92782ff2693ecf))
* fixupAll flag should take precedence over autorebase ([#593](https://www.github.com/nodejs/node-core-utils/issues/593)) ([b62fe29](https://www.github.com/nodejs/node-core-utils/commit/b62fe296a0de54eb55d80992cb2e437448b06732))

## [1.30.0](https://www.github.com/nodejs/node-core-utils/compare/v1.29.1...v1.30.0) (2021-11-08)


### Features

* **land:** avoid landing on the wrong default branch ([#586](https://www.github.com/nodejs/node-core-utils/issues/586)) ([48d4641](https://www.github.com/nodejs/node-core-utils/commit/48d4641ffa9034e37f8d7b7890c6c7c95e14f15d))
* spawn the user's editor to edit commit messages ([811de87](https://www.github.com/nodejs/node-core-utils/commit/811de87206806246a98033c60c5db2557d56da12))
* suggest `gh pr` commands to finish landing ([#583](https://www.github.com/nodejs/node-core-utils/issues/583)) ([25b452d](https://www.github.com/nodejs/node-core-utils/commit/25b452d61c49cf723be5ea2ae3b927b3878ad902))


### Bug Fixes

* add missing new line in changelog ([#591](https://www.github.com/nodejs/node-core-utils/issues/591)) ([e7a95a4](https://www.github.com/nodejs/node-core-utils/commit/e7a95a4ec4b166b9311c673f1d4617da4a13d2bc))
* display the correct amount of remaining time for fast-tracked PRs ([#581](https://www.github.com/nodejs/node-core-utils/issues/581)) ([f28ec2d](https://www.github.com/nodejs/node-core-utils/commit/f28ec2d50ce68965a87ed61182660763bd642543))
* update detection of changelog links ([#587](https://www.github.com/nodejs/node-core-utils/issues/587)) ([4cd1beb](https://www.github.com/nodejs/node-core-utils/commit/4cd1beb07a0a9d44ca1d8dd9708a29929d566956))
* use COMMIT_EDITMSG file name to edit commits ([2a23e37](https://www.github.com/nodejs/node-core-utils/commit/2a23e3734dd3ac2326fee43ac0221924c36d9bf9))

### [1.29.1](https://www.github.com/nodejs/node-core-utils/compare/v1.29.0...v1.29.1) (2021-10-31)


### Bug Fixes

* prepare for one last README change ([#578](https://www.github.com/nodejs/node-core-utils/issues/578)) ([ef1edc7](https://www.github.com/nodejs/node-core-utils/commit/ef1edc78504ad3b26bb1889685f206a9ce575768))

## [1.29.0](https://www.github.com/nodejs/node-core-utils/compare/v1.28.2...v1.29.0) (2021-10-28)


### Features

* **cli:** prompt user when landing PR with several commits ([#572](https://www.github.com/nodejs/node-core-utils/issues/572)) ([89925c3](https://www.github.com/nodejs/node-core-utils/commit/89925c306728ba8147413b0ad622e55a6dd5475e))


### Bug Fixes

* update detection of changelog links ([#573](https://www.github.com/nodejs/node-core-utils/issues/573)) ([44c6fc8](https://www.github.com/nodejs/node-core-utils/commit/44c6fc878178af17def7b0e047fc5b155796f927))
* update detection of changelog links (take 2) ([#575](https://www.github.com/nodejs/node-core-utils/issues/575)) ([e66ba17](https://www.github.com/nodejs/node-core-utils/commit/e66ba171e81d77abcf38adc9f3bca966523e7b19))
* update for recent changelog format change ([#576](https://www.github.com/nodejs/node-core-utils/issues/576)) ([8f1fa9c](https://www.github.com/nodejs/node-core-utils/commit/8f1fa9c47f93c40ce7b80a375940bffcd6eabdf2))
* update proxy-agent to 5.0.0 ([#570](https://www.github.com/nodejs/node-core-utils/issues/570)) ([3091f99](https://www.github.com/nodejs/node-core-utils/commit/3091f99cca1683f29cf5cd4358738338fe013aba))

### [1.28.2](https://www.github.com/nodejs/node-core-utils/compare/v1.28.1...v1.28.2) (2021-10-04)


### Bug Fixes

* **update-v8:** remove abseil-cpp from V8 dependencies ([#567](https://www.github.com/nodejs/node-core-utils/issues/567)) ([8ccf184](https://www.github.com/nodejs/node-core-utils/commit/8ccf184773f660cc1765f26af3103870729cb8b2))

### [1.28.1](https://www.github.com/nodejs/node-core-utils/compare/v1.28.0...v1.28.1) (2021-09-25)


### Bug Fixes

* **update-v8:** add abseil-cpp as a V8 dependency ([#565](https://www.github.com/nodejs/node-core-utils/issues/565)) ([96d46ab](https://www.github.com/nodejs/node-core-utils/commit/96d46ab0322aeea9fbf6dcd7121e8a87505e568c))

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
