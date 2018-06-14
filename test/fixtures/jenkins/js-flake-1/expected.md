Failures in job https://ci.nodejs.org/job/node-test-commit/19123/ 

#### [debian9-64](https://ci.nodejs.org/job/node-test-commit-linux/nodes=debian9-64/19446/console)

<details>
<summary>See failures</summary>

```
not ok 2178 sequential/test-inspector-port-zero-cluster
  ---
  duration_ms: 0.272
  severity: fail
  exitcode: 1
  stack: |-
    Debugger listening on ws://127.0.0.1:45799/0523bc03-e8b2-43fc-aafa-d246cee6800c
    For help, see: https://nodejs.org/en/docs/inspector
    Debugger listening on ws://127.0.0.1:45800/544f1c62-d55e-4ea7-85bc-d73edb36ea88
    For help, see: https://nodejs.org/en/docs/inspector
    Debugger listening on ws://127.0.0.1:45801/02db6a20-090d-43f0-8be4-9dff885ffd6f
    For help, see: https://nodejs.org/en/docs/inspector
    Starting inspector on 127.0.0.1:45802 failed: address already in use
    node: ../deps/uv/src/unix/core.c:117: uv_close: Assertion `!uv__is_closing(handle)' failed.
    assert.js:80
      throw new AssertionError(obj);
      ^
    
    AssertionError [ERR_ASSERTION]: code: null, signal: SIGABRT
        at Worker.worker.on.common.mustCall (/home/iojs/build/workspace/node-test-commit-linux/nodes/debian9-64/test/sequential/test-inspector-port-zero-cluster.js:20:16)
        at Worker.<anonymous> (/home/iojs/build/workspace/node-test-commit-linux/nodes/debian9-64/test/common/index.js:451:15)
        at Worker.emit (events.js:182:13)
        at ChildProcess.worker.process.once (internal/cluster/master.js:193:12)
        at Object.onceWrapper (events.js:273:13)
        at ChildProcess.emit (events.js:182:13)
        at Process.ChildProcess._handle.onexit (internal/child_process.js:237:12)
  ...

```
</details>

