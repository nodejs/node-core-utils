import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkAvailability } from '../../lib/ci/availability.js';

const controllerURL = 'https://ci.nodejs.org/api/json?tree=quietingDown';
const jobURL = 'https://ci.nodejs.org/job/node-test-pull-request/api/json?tree=disabled,buildable';
const availableController = { quietingDown: false };
const availableJob = { disabled: false, buildable: true };

function requestFor(t, controller = availableController, job = availableJob) {
  return {
    fetch: t.mock.fn(async(url) => {
      assert.ok(url === controllerURL || url === jobURL);
      return { status: 200, json: async() => url === controllerURL ? controller : job };
    })
  };
}

describe('Jenkins availability', () => {
  it('confirms controller and PR job availability with one shared deadline', async(t) => {
    const controller = new AbortController();
    const timeout = t.mock.method(AbortSignal, 'timeout', () => controller.signal);
    const request = requestFor(t);

    assert.equal(await checkAvailability(request), undefined);
    assert.deepEqual(timeout.mock.calls.map(call => call.arguments), [[20_000]]);
    assert.deepEqual(request.fetch.mock.calls.map(call => call.arguments), [
      [controllerURL, {
        method: 'GET', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: controller.signal
      }],
      [jobURL, {
        method: 'GET', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: controller.signal
      }]
    ]);
  });

  it('stops before reading the job when Jenkins is quieting down', async(t) => {
    const request = requestFor(t, { quietingDown: true });
    await assert.rejects(checkAvailability(request), {
      message: 'Jenkins is preparing for shutdown'
    });
    assert.equal(request.fetch.mock.callCount(), 1);
  });

  for (const controller of [null, {}, { quietingDown: 'false' }, { quietingDown: 0 }]) {
    it(`rejects unknown controller state: ${JSON.stringify(controller)}`, async(t) => {
      const request = requestFor(t, controller);
      await assert.rejects(checkAvailability(request), {
        message: 'Jenkins quiet-down state is not confirmed'
      });
      assert.equal(request.fetch.mock.callCount(), 1);
    });
  }

  for (const job of [
    { disabled: true, buildable: false },
    { disabled: true, buildable: true }
  ]) {
    it(`rejects disabled PR job: ${JSON.stringify(job)}`, async(t) => {
      await assert.rejects(checkAvailability(requestFor(t, availableController, job)), {
        message: 'Jenkins PR job is disabled'
      });
    });
  }

  it('rejects a PR job that cannot be built', async(t) => {
    const request = requestFor(t, availableController, { disabled: false, buildable: false });
    await assert.rejects(checkAvailability(request), {
      message: 'Jenkins PR job is not buildable'
    });
  });

  for (const job of [
    null, {}, { disabled: false }, { buildable: true },
    { disabled: 'false', buildable: true }, { disabled: false, buildable: 'true' }
  ]) {
    it(`rejects unknown PR job state: ${JSON.stringify(job)}`, async(t) => {
      await assert.rejects(checkAvailability(requestFor(t, availableController, job)), {
        message: 'Jenkins PR job availability is not confirmed'
      });
    });
  }

  for (const failedURL of [controllerURL, jobURL]) {
    it(`propagates network failures from ${failedURL}`, async(t) => {
      const failure = new Error('Connection reset');
      const request = requestFor(t);
      request.fetch.mock.mockImplementation(async(url) => {
        if (url === failedURL) throw failure;
        return { status: 200, json: async() => availableController };
      });
      await assert.rejects(checkAvailability(request), error => error === failure);
      assert.equal(request.fetch.mock.callCount(), failedURL === controllerURL ? 1 : 2);
    });

    it(`rejects malformed JSON from ${failedURL}`, async(t) => {
      const request = requestFor(t);
      request.fetch.mock.mockImplementation(async(url) => ({
        status: 200,
        json: async() => {
          if (url === failedURL) throw new SyntaxError('Invalid JSON');
          return availableController;
        }
      }));
      await assert.rejects(checkAvailability(request), /JSON/);
      assert.equal(request.fetch.mock.callCount(), failedURL === controllerURL ? 1 : 2);
    });

    for (const status of [302, 401, 403, 404, 503]) {
      it(`rejects HTTP ${status} from ${failedURL}`, async(t) => {
        const request = requestFor(t);
        const cancel = t.mock.fn(async() => {});
        const json = t.mock.fn(async() => availableJob);
        request.fetch.mock.mockImplementation(async(url) => url === failedURL
          ? { status, statusText: 'Unavailable', body: { cancel }, json }
          : { status: 200, json: async() => availableController });
        await assert.rejects(checkAvailability(request), new RegExp(String(status)));
        assert.equal(request.fetch.mock.callCount(), failedURL === controllerURL ? 1 : 2);
        assert.equal(json.mock.callCount(), 0);
        assert.equal(cancel.mock.callCount(), 1);
      });
    }
  }

  it('preserves connection failures while reading a response body', async() => {
    const failure = new Error('Connection reset while reading response');
    const request = {
      fetch: async() => ({ status: 200, json: async() => { throw failure; } })
    };
    await assert.rejects(checkAvailability(request), error => error === failure);
  });

  it('keeps the deadline active while reading the job response body', async(t) => {
    const controller = new AbortController();
    t.mock.method(AbortSignal, 'timeout', () => controller.signal);
    const timeout = new DOMException('Availability check timed out', 'TimeoutError');
    const request = requestFor(t);
    request.fetch.mock.mockImplementation(async(url, { signal }) => ({
      status: 200,
      json: async() => {
        if (url === controllerURL) return availableController;
        const body = new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        controller.abort(timeout);
        return body;
      }
    }));

    await assert.rejects(checkAvailability(request), error => error === timeout);
    assert.equal(request.fetch.mock.callCount(), 2);
  });
});
