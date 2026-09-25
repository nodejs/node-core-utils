import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getPRWorkload } from '../../lib/ci/workload.js';

const queueURL = 'https://ci.nodejs.org/queue/api/json?tree=items[id,task[url]]';
const computerURL = 'https://ci.nodejs.org/computer/api/json?' +
  'tree=computer[executors[currentExecutable[url,queueId]],' +
  'oneOffExecutors[currentExecutable[url,queueId]]]';
const prJobURL = 'https://ci.nodejs.org/job/node-test-pull-request/';
const jsonResponse = data => new Response(JSON.stringify(data), {
  headers: { 'content-type': 'application/json' }
});
const requestFor = (data, computers = { computer: [] }) => ({
  fetch: async url => jsonResponse(url === computerURL ? computers : data)
});
const executable = (number, queueId = number) => ({
  currentExecutable: { url: `${prJobURL}${number}/`, queueId }
});

describe('PR CI workload', () => {
  it('counts only the canonical PR job, including repeated queued requests', async() => {
    const items = [
      { id: 1, task: { url: prJobURL } },
      { id: 2, task: { url: prJobURL } },
      { id: 3, task: { url: prJobURL.slice(0, -1) } },
      { task: { url: 'https://ci.nodejs.org/job/node-test-commit/' } },
      { task: { url: 'https://ci.nodejs.org/job/node-test-pull-request-other/' } },
      { task: { url: 'https://ci.nodejs.org/job/folder/job/node-test-pull-request/' } },
      { task: { url: `${prJobURL}123/` } },
      { task: { url: `${prJobURL}?other=job` } },
      { task: { url: 'https://example.com/job/node-test-pull-request/' } }
    ];
    assert.equal(await getPRWorkload(requestFor({ items })), 3);
  });

  it('returns zero when idle using two GETs with a shared deadline', async(t) => {
    const signal = new AbortController().signal;
    const timeout = t.mock.method(AbortSignal, 'timeout', () => signal);
    const fetch = t.mock.fn(async(url, options) => {
      assert.ok([queueURL, computerURL].includes(url));
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.signal, signal);
      return jsonResponse(url === queueURL ? { items: [] } : { computer: [] });
    });
    assert.equal(await getPRWorkload({ fetch }), 0);
    assert.deepEqual(fetch.mock.calls.map(call => call.arguments[0]), [queueURL, computerURL]);
    assert.equal(timeout.mock.callCount(), 1);
    assert.deepEqual(timeout.mock.calls[0].arguments, [20_000]);
  });

  it('ignores unrelated task types that do not export a URL', async() => {
    const items = [
      { task: {} },
      { task: { _class: 'example.CustomTask', url: null } },
      { id: 1, task: { url: prJobURL } }
    ];
    assert.equal(await getPRWorkload(requestFor({ items })), 1);
  });

  it('counts active PR builds when the waiting queue has no PR jobs', async() => {
    const computers = {
      computer: [{
        executors: Array.from({ length: 20 }, (_, index) => executable(77871 + index)),
        oneOffExecutors: []
      }]
    };
    assert.equal(await getPRWorkload(requestFor({ items: [] }, computers)), 20);
  });

  it('combines queued requests with regular and one-off executors without duplicates', async() => {
    const items = [
      { id: 1, task: { url: prJobURL } },
      { id: 2, task: { url: prJobURL } }
    ];
    const computers = {
      computer: [{
        executors: [
          executable(123, 1),
          executable(124, 3),
          { currentExecutable: null },
          { currentExecutable: { url: 'https://ci.nodejs.org/job/node-test-commit/123/' } }
        ],
        oneOffExecutors: [
          executable(124, 3),
          // An older active run must count even when newer builds have finished.
          executable(1, -1),
          { currentExecutable: { url: `${prJobURL}123`, queueId: 1 } },
          { currentExecutable: {} }
        ]
      }]
    };
    assert.equal(await getPRWorkload(requestFor({ items }, computers)), 4);
  });

  it('ignores other job and child URLs on executors', async() => {
    const urls = [
      'https://example.com/job/node-test-pull-request/123/',
      'https://ci.nodejs.org/job/folder/job/node-test-pull-request/123/',
      'https://ci.nodejs.org/job/node-test-pull-request-other/123/',
      `${prJobURL}123/child/`, `${prJobURL}123?other=job`, prJobURL
    ];
    const computers = {
      computer: [{
        executors: urls.map(url => ({ currentExecutable: { url, queueId: 1 } })),
        oneOffExecutors: []
      }]
    };
    assert.equal(await getPRWorkload(requestFor({ items: [] }, computers)), 0);
  });

  for (const id of [undefined, null, -1, '123', 0.5]) {
    it(`rejects malformed PR queue IDs: ${id}`, async() => {
      await assert.rejects(getPRWorkload(requestFor({
        items: [{ id, task: { url: prJobURL } }]
      })), /invalid queue item ID/);
    });
  }

  for (const computers of [
    null, {}, { computer: null }, { computer: {} },
    { computer: [null] }, { computer: [{}] },
    { computer: [{ executors: [], oneOffExecutors: null }] }
  ]) {
    it(`rejects malformed executor data: ${JSON.stringify(computers)}`, async() => {
      await assert.rejects(getPRWorkload(requestFor({ items: [] }, computers)),
        /invalid executor/);
    });
  }

  for (const executor of [
    null, [], { currentExecutable: false }, { currentExecutable: [] },
    { currentExecutable: { url: 123 } },
    { currentExecutable: { url: `${prJobURL}123/` } }
  ]) {
    it(`rejects a malformed executable: ${JSON.stringify(executor)}`, async() => {
      await assert.rejects(getPRWorkload(requestFor({ items: [] }, {
        computer: [{ executors: [executor], oneOffExecutors: [] }]
      })), /invalid exec/);
    });
  }

  it('does not return a partial queue count if the executor query fails', async() => {
    const error = new Error('Connection reset');
    const request = {
      async fetch(url) {
        if (url === computerURL) throw error;
        return jsonResponse({ items: [{ id: 1, task: { url: prJobURL } }] });
      }
    };
    await assert.rejects(getPRWorkload(request), error);
  });

  for (const data of [null, {}, [], { items: null }, { items: {} }]) {
    it(`rejects malformed queue data: ${JSON.stringify(data)}`, async() => {
      await assert.rejects(getPRWorkload(requestFor(data)), /invalid queue/);
    });
  }

  for (const item of [null, false, [], {}, { task: null }, { task: 'job' }, { task: [] }]) {
    it(`rejects a malformed queue item: ${JSON.stringify(item)}`, async() => {
      await assert.rejects(getPRWorkload(requestFor({ items: [item] })), /invalid queue item/);
    });
  }

  it('rejects a malformed task URL instead of reporting an empty queue', async() => {
    await assert.rejects(getPRWorkload(requestFor({ items: [{ task: { url: 123 } }] })),
      /invalid queue task URL/);
  });

  it('propagates HTTP errors without returning a queue count', async() => {
    const request = {
      fetch: async() => new Response('Forbidden', { status: 403, statusText: 'Forbidden' })
    };
    await assert.rejects(getPRWorkload(request), /403/);
  });

  it('propagates network failures', async() => {
    const error = new Error('Connection reset');
    const request = { async fetch() { throw error; } };
    await assert.rejects(getPRWorkload(request), error);
  });

  it('propagates invalid JSON errors', async() => {
    const request = { fetch: async() => new Response('<html>Not JSON</html>') };
    await assert.rejects(getPRWorkload(request), error => {
      assert.equal(error.message, 'Jenkins returned invalid JSON');
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    });
  });
});
