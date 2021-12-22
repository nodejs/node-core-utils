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

export const v8Deps = [
  {
    name: 'trace_event',
    repo: 'base/trace_event/common',
    gitignore: {
      match: '/base\n',
      replace: ''
    },
    since: 55
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
  }
];
