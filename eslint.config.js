import globals from 'globals';
import pluginJs from '@eslint/js';
import neostandard from 'neostandard';
import nodePlugin from 'eslint-plugin-n';
import pluginPromise from 'eslint-plugin-promise';
import importPlugin from 'eslint-plugin-import';

export default [
  pluginJs.configs.recommended,
  ...neostandard(),
  nodePlugin.configs['flat/recommended'],
  pluginPromise.configs['flat/recommended'],
  importPlugin.flatConfigs.recommended,
  {
    ignores: [
      '**/.git',
      '**/.nyc_output',
      'coverage/',
      'node_modules/',
      'lib/wpt/templates/',
      'test/fixtures/release/*.js', // Copied from the nodejs/node repo
    ],
  },
  {
    languageOptions: {
      globals: globals.nodeBuiltin,
      sourceType: 'module',
      ecmaVersion: 'latest',
    },
    rules: {
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/space-before-function-paren': ['error', 'never'],
      '@stylistic/no-multi-spaces': ['error', { ignoreEOLComments: true }],
      camelcase: 'off',
      '@stylistic/max-len': [
        2,
        100,
        4,
        { ignoreRegExpLiterals: true, ignoreUrls: true },
      ],
      '@stylistic/object-property-newline': 'off',
      'promise/always-return': ['error', { ignoreLastCallback: true }],
      'n/no-process-exit': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
    },
    settings: {
      'import/resolver': {
        node: {
          pathFilter(pkg, path, relativePath) {
            const pkgExport = relativePath
              ? pkg.exports?.[`./${relativePath}`]
              : pkg.exports?.['.'];
            return pkgExport?.import?.default ??
                   pkgExport?.import ??
                   pkgExport?.[0]?.import ??
                   pkgExport?.default ??
                   pkgExport ??
                   (relativePath || pkg.main);
          },
        },
      },
    },
  },
];
