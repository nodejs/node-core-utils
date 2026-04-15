import { describe, it } from 'node:test';
import LandingSession from '../../lib/landing_session.js';

const createMockCli = () => ({
  prompt: () => Promise.resolve(false),
  ok: () => {},
  warn: () => {},
  info: () => {},
  log: () => {},
  separator: () => {},
  startSpinner: () => ({ stop: () => {} }),
  stopSpinner: () => {},
  setExitCode: () => {}
});

const createSession = (overrides = undefined) => {
  const options = {
    owner: 'nodejs',
    repo: 'node',
    upstream: 'origin',
    branch: 'main',
    prid: 123,
    oneCommitMax: false,
    backport: false,
    ...overrides
  };
  const session = new LandingSession(createMockCli(), {}, '/', options);

  let metadata = `${options.backport ? 'Backport-' : ''}PR-URL: http://example.com/${options.prid}\nReviewed-By: user1 <collab@mail.net>\n`;

  if (options.metadata) {
    metadata += options.metadata;
  }

  return Object.defineProperty(session, 'metadata', {
    __proto__: null,
    configurable: true,
    value: metadata
  });
};

describe('LandingSession.prototype.generateAmendedMessage', () => {
  it('should append PR-URL when there are no trailers', async(t) => {
    const session = createSession();
    const result = await session.generateAmendedMessage('foo: bar');

    t.assert.strictEqual(
      result,
      'foo: bar\n\nPR-URL: http://example.com/123\nReviewed-By: user1 <collab@mail.net>'
    );
  });

  it('should not duplicate trailers that are in metadata', async(t) => {
    const session = createSession({ metadata: 'Refs: http://example.com/321\nRefs: http://example.com/456' });
    const result = await session.generateAmendedMessage('foo: bar\n\nRefs: http://example.com/321');

    t.assert.strictEqual(
      result,
      'foo: bar\n\nRefs: http://example.com/321\nPR-URL: http://example.com/123\nReviewed-By: user1 <collab@mail.net>\nRefs: http://example.com/456'
    );
  });

  it('should strip trailers added by NCU', async(t) => {
    const session = createSession();
    const result = await session.generateAmendedMessage(
      'subsystem: fix bug\n\nReviewed-By: user1 <foo@bar.com>\nPR-URL: http://example.com/123\nBackport-PR-URL: http://example.com/321\nOther-Trailer: Value\n'
    );

    t.assert.strictEqual(
      result,
      'subsystem: fix bug\n\nOther-Trailer: Value\nPR-URL: http://example.com/123\nReviewed-By: user1 <collab@mail.net>'
    );
  });

  it('should strip trailers added by NCU regardless of case', async(t) => {
    const session = createSession();
    const result = await session.generateAmendedMessage(
      'subsystem: fix bug\n\nReViEWed-bY: user1 <foo@bar.com>\npr-url: http://example.com/123\nBACKPORT-PR-URL: http://example.com/321\nOther-Trailer: Value\n'
    );

    t.assert.strictEqual(
      result,
      'subsystem: fix bug\n\nOther-Trailer: Value\nPR-URL: http://example.com/123\nReviewed-By: user1 <collab@mail.net>'
    );
  });

  it('should not strip PR-URL trailer when backporting', async(t) => {
    const session = createSession({ backport: true, prid: 456 });
    const result = await session.generateAmendedMessage(
      'subsystem: foobar\n\nOther-Trailer: Value\nPR-URL: http://example.com/999\nReviewed-By: foobar <foo@bar.com>\n'
    );

    t.assert.strictEqual(
      result,
      'subsystem: foobar\n\nOther-Trailer: Value\nPR-URL: http://example.com/999\nBackport-PR-URL: http://example.com/456\nReviewed-By: user1 <collab@mail.net>'
    );
  });

  it('should clean-up trailers with extra space', async(t) => {
    const session = createSession();
    const result = await session.generateAmendedMessage(
      'subsystem: foobar\n\n\nTrailer:    Value   \n\n\n'
    );

    t.assert.strictEqual(result, 'subsystem: foobar\n\nTrailer: Value\nPR-URL: http://example.com/123\nReviewed-By: user1 <collab@mail.net>');
  });

  it('should handle empty message', async(t) => {
    const session = createSession();
    const result = await session.generateAmendedMessage('');

    t.assert.strictEqual(result, '\nPR-URL: http://example.com/123\nReviewed-By: user1 <collab@mail.net>');
  });

  it('should handle multi-line trailers', async(t) => {
    const session = createSession();
    const result = await session.generateAmendedMessage(
      'subsystem: foobar\n\nSigned-off-by: user1\n  <foobar@users.noreply.github.com>\n'
    );

    t.assert.strictEqual(result,
      'subsystem: foobar\n\nSigned-off-by: user1 <foobar@users.noreply.github.com>\nPR-URL: http://example.com/123\nReviewed-By: user1 <collab@mail.net>');
  });

  it('should not remove lines that look like trailers in the commit body', async(t) => {
    const session = createSession();
    const result = await session.generateAmendedMessage(
      'subsystem: foobar\n\nNot-A-Trailer: http://example.com/\n\nSigned-off-by: user1\n  <foobar@users.noreply.github.com>\n'
    );

    t.assert.strictEqual(result,
      'subsystem: foobar\n\nNot-A-Trailer: http://example.com/\n\nSigned-off-by: user1 <foobar@users.noreply.github.com>\nPR-URL: http://example.com/123\nReviewed-By: user1 <collab@mail.net>');
  });

  it('should handle cherry-pick from upstream', async(t) => {
    const session = createSession({ metadata: 'Refs: https://github.com/v8/v8/commit/cf1bce40a5ef4c7c1da351754f5bf526c0c96463\n' });
    const result = await session.generateAmendedMessage(`deps: V8: cherry-pick cf1bce40a5ef

Original commit message:

    [wasm] Fix S128Const on big endian

    Since http://crrev.com/c/2944437 globals are no longer little endian
    enforced.

    S128Const handling in the initializer needs to take this into account
    and byte reverse values which are hard coded in little endian order.

    This is currently causing failures on Node.js upstream:
    https://github.com/nodejs/node/pull/59034#issuecomment-4129144461

    Change-Id: Ifcc9ade93ee51565ab19b16e9dadf0ff5752f7a6
    Reviewed-on: https://chromium-review.googlesource.com/c/v8/v8/+/7704213
    Commit-Queue: Milad Farazmand <mfarazma@ibm.com>
    Reviewed-by: Manos Koukoutos <manoskouk@chromium.org>
    Cr-Commit-Position: refs/heads/main@{#106082}

PR-URL: https://github.com/nodejs/node/pull/62449
Refs: https://github.com/v8/v8/commit/cf1bce40a5ef4c7c1da351754f5bf526c0c96463
Reviewed-By: Guy Bedford <guybedford@gmail.com>
Reviewed-By: Luigi Pinca <luigipinca@gmail.com>
`);

    t.assert.strictEqual(result, `deps: V8: cherry-pick cf1bce40a5ef

Original commit message:

    [wasm] Fix S128Const on big endian

    Since http://crrev.com/c/2944437 globals are no longer little endian
    enforced.

    S128Const handling in the initializer needs to take this into account
    and byte reverse values which are hard coded in little endian order.

    This is currently causing failures on Node.js upstream:
    https://github.com/nodejs/node/pull/59034#issuecomment-4129144461

    Change-Id: Ifcc9ade93ee51565ab19b16e9dadf0ff5752f7a6
    Reviewed-on: https://chromium-review.googlesource.com/c/v8/v8/+/7704213
    Commit-Queue: Milad Farazmand <mfarazma@ibm.com>
    Reviewed-by: Manos Koukoutos <manoskouk@chromium.org>
    Cr-Commit-Position: refs/heads/main@{#106082}

Refs: https://github.com/v8/v8/commit/cf1bce40a5ef4c7c1da351754f5bf526c0c96463
PR-URL: http://example.com/123
Reviewed-By: user1 <collab@mail.net>`
    );
  });
});
