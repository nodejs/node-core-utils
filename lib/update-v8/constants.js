import os from 'node:os';
import path from 'node:path';

const homedir = os.homedir();

export const chromiumGit = 'https://chromium.googlesource.com';

export const defaultBaseDir = path.join(homedir, '.update-v8');

export const v8Git = `${chromiumGit}/v8/v8.git`;

const gtestReplace = `/testing/gtest/*
!/testing/gtest/include
/testing/gtest/include/*
!/testing/gtest/include/gtest
/testing/gtest/include/gtest/*
!/testing/gtest/include/gtest/gtest_prod.h`;

const googleTestReplace = `/third_party/googletest/src/*
!/third_party/googletest/src/googletest
/third_party/googletest/src/googletest/*
!/third_party/googletest/src/googletest/include
/third_party/googletest/src/googletest/include/*
!/third_party/googletest/src/googletest/include/gtest
/third_party/googletest/src/googletest/include/gtest/*
!/third_party/googletest/src/googletest/include/gtest/gtest_prod.h`;

const zlibIgnore = `!/third_party/zlib
/third_party/zlib/contrib/bench
/third_party/zlib/contrib/tests
/third_party/zlib/google/test`;

const abseilIgnore = `!/third_party/abseil-cpp
/third_party/abseil-cpp/.github
/third_party/abseil-cpp/ci`;

const fp16Ignore = `!/third_party/fp16
/third_party/fp16/src/*
!/third_party/fp16/src/include`;

const fastFloatReplace = `/third_party/fast_float/src/*
!/third_party/fast_float/src/include`;

const highwayIgnore = `/third_party/highway/src/*
!/third_party/highway/src/hwy`;

const dragonboxIgnore = `/third_party/dragonbox/src/*
!/third_party/dragonbox/src/include`;

export const v8Deps = [
  {
    name: 'trace_event',
    repo: 'base/trace_event/common',
    gitignore: {
      match: '/base\n',
      replace: ''
    },
    since: 55,
    until: 125
  },
  {
    name: 'gtest',
    repo: 'testing/gtest',
    gitignore: {
      match: '/testing/gtest',
      replace: gtestReplace
    },
    since: 55,
    until: 66
  },
  {
    name: 'jinja2',
    repo: 'third_party/jinja2',
    gitignore: '!/third_party/jinja2',
    since: 56
  },
  {
    name: 'markupsafe',
    repo: 'third_party/markupsafe',
    gitignore: '!/third_party/markupsafe',
    since: 56
  },
  {
    name: 'googletest',
    repo: 'third_party/googletest/src',
    gitignore: {
      match: '/third_party/googletest/src',
      replace: googleTestReplace
    },
    since: 67
  },
  {
    name: 'zlib',
    repo: 'third_party/zlib',
    gitignore: zlibIgnore,
    since: 80
  },
  {
    name: 'ittapi',
    repo: 'third_party/ittapi',
    gitignore: '!/third_party/ittapi',
    since: 81
  },
  {
    name: 'abseil',
    repo: 'third_party/abseil-cpp',
    gitignore: abseilIgnore,
    since: 121
  },
  {
    name: 'fp16',
    repo: 'third_party/fp16/src',
    gitignore: fp16Ignore,
    since: 124
  },
  {
    name: 'fast_float',
    repo: 'third_party/fast_float/src',
    gitignore: {
      match: '/third_party/fast_float/src',
      replace: fastFloatReplace
    },
    since: 130
  },
  {
    name: 'highway',
    repo: 'third_party/highway/src',
    gitignore: {
      match: '/third_party/highway/src',
      replace: highwayIgnore
    },
    since: 134
  },
  {
    name: 'simdutf',
    repo: 'third_party/simdutf',
    gitignore: '!/third_party/simdutf',
    since: 134
  },
  {
    name: 'dragonbox',
    repo: 'third_party/dragonbox/src',
    gitignore: {
      match: '/third_party/dragonbox/src',
      replace: dragonboxIgnore
    },
    since: 138
  },
];
