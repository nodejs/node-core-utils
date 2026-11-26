import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fold } from '../../lib/ci/ci_utils.js';

describe('fold', () => {
  for (const { name, code, fence } of [
    { name: 'ordinary output', code: 'test failed', fence: '```' },
    { name: 'empty output', code: '', fence: '```' },
    { name: 'inline backticks', code: '`one` and ``two``', fence: '```' },
    {
      name: 'a fence followed by HTML and Markdown',
      code: 'failure\n```\n</details>\n\n# injected heading',
      fence: '````'
    },
    {
      name: 'multiple backtick runs including a longer fence',
      code: '```\n``````\n````',
      fence: '```````'
    },
    {
      name: 'a long backtick run within a line',
      code: 'before ````` after',
      fence: '``````'
    }
  ]) {
    it(`safely fences ${name}`, () => {
      assert.equal(fold('See failures', code),
        '<details>\n<summary>See failures</summary>\n\n' +
        `${fence}\n${code}\n${fence}\n</details>`);
    });
  }
});
