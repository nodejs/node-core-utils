'use strict';

const homedir = require('os').homedir();
const path = require('path');

const chromiumGit = 'https://chromium.googlesource.com';

exports.defaultBaseDir = path.join(homedir, '.update-v8');
exports.chromiumGit = chromiumGit;

exports.v8Git = `${chromiumGit}/v8/v8.git`;

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
/third_party/zlib/google`;

exports.v8Deps = [
  {
    name: 'trace_event',
    repo: 'v8/base/trace_event/common',
    path: 'base/trace_event/common',
    gitignore: {
      match: '/base\n',
      replace: ''
    },
    since: 55
  },
  {
    name: 'gtest',
    repo: 'v8/testing/gtest',
    path: 'testing/gtest',
    gitignore: {
      match: '/testing/gtest',
      replace: gtestReplace
    },
    since: 55,
    until: 66
  },
  {
    name: 'jinja2',
    repo: 'v8/third_party/jinja2',
    path: 'third_party/jinja2',
    gitignore: '!/third_party/jinja2',
    since: 56
  },
  {
    name: 'markupsafe',
    repo: 'v8/third_party/markupsafe',
    path: 'third_party/markupsafe',
    gitignore: '!/third_party/markupsafe',
    since: 56
  },
  {
    name: 'googletest',
    repo: 'v8/third_party/googletest/src',
    path: 'third_party/googletest/src',
    gitignore: {
      match: '/third_party/googletest/src',
      replace: googleTestReplace
    },
    since: 67
  },
  {
    name: 'zlib',
    repo: 'v8/third_party/zlib',
    path: 'third_party/zlib',
    gitignore: zlibIgnore,
    since: 80
  }
];
