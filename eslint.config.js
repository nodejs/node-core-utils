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
    ],
  },
  {
    languageOptions: {
      globals: globals.node,
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
            return pkg.exports?.[`./${relativePath}`]?.import?.default ??
                   pkg.exports?.[`./${relativePath}`]?.import ??
                   pkg.exports?.[`./${relativePath}`]?.default ??
                   pkg.exports?.[`./${relativePath}`] ??
                   pkg.exports?.['.']?.import?.default ??
                   pkg.exports?.['.']?.import ??
                   pkg.exports?.['.']?.[0]?.import ??
                   pkg.exports?.['.']?.default ??
                   pkg.exports?.['.'] ??
                   (relativePath || pkg.main);
          },
        },
      },
    },
  },
];
