# ncu-ci

Parse the results of a Jenkins CI run in https://ci.nodejs.org/ and display
a summary for all the failures.

Supported jobs:

- [node-test-pull-request](https://ci.nodejs.org/job/node-test-pull-request)
- [node-test-commit](https://ci.nodejs.org/job/node-test-commit)
- [benchmark-node-micro-benchmarks](https://ci.nodejs.org/job/benchmark-node-micro-benchmarks/)

```
ncu-ci <command>

Commands:
  ncu-ci rate <type>        Calculate the green rate of a CI job in the last 100
                            runs
  ncu-ci walk <type>        Walk the CI and display the failures
  ncu-ci url <url>          Automatically detect CI type and show results
  ncu-ci pr <jobid>         Show results of a node-test-pull-request CI job
  ncu-ci commit <jobid>     Show results of a node-test-commit CI job
  ncu-ci benchmark <jobid>  Show results of a benchmark-node-micro-benchmarks CI
                            job
  ncu-ci citgm <jobid>      Show results of a citgm-smoker CI job
  ncu-ci daily              Show recent results of node-daily-master

Options:
  --version          Show version number                               [boolean]
  --copy             Write the results as markdown to clipboard
                                                      [boolean] [default: false]
  --nobuild          If running cigtm, whether or not jobid is citgm-nobuild.
                                                      [boolean] [default: false]
  --json <path>      Write the results as json to <path>                [string]
  --markdown <path>  Write the results as markdown to <path>            [string]
  --help             Show help                                         [boolean]
```

### `ncu-ci rate <type>`

`ncu-ci rate <type>` calculate the success rate for CI jobs in the last 100 runs per [CI Health History](https://github.com/nodejs/reliability#ci-health-history), where `<type>` can be either `pr` for `node-test-pull-request` or `commit` for `node-test-commit`. See `ncu-ci rate --help` for more.

Examples:

```sh
node on git:main ❯ ncu-ci rate pr
--------------------------------------------------------------------------------
[1/1] Running health
--------------------------------------------------------------------------------
✔  Done
| UTC Time         | RUNNING | SUCCESS | UNSTABLE | ABORTED | FAILURE | Green Rate |
| ---------------- | ------- | ------- | -------- | ------- | ------- | ---------- |
| 2020-07-03 16:28 | 1       | 7       | 34       | 10      | 48      | 7.87%      |
```

```sh
node on git:main ❯ ncu-ci rate commit
--------------------------------------------------------------------------------
[1/1] Running health
--------------------------------------------------------------------------------
✔  Done
| UTC Time         | RUNNING | SUCCESS | UNSTABLE | ABORTED | FAILURE | Green Rate |
| ---------------- | ------- | ------- | -------- | ------- | ------- | ---------- |
| 2020-07-03 16:28 | 2       | 8       | 27       | 5       | 58      | 8.60%      |
```

### `ncu-ci walk <type>`

`ncu-ci walk <type>` walks CI and displays failures, where `<type>` can be either `pr` for `node-test-pull-request` or `commit` for `node-test-commit`. See `ncu-ci walk --help` for more.

Example:
```sh
node on git:main ❯ ncu-ci walk commit
✔  Done--------------------------------------------------------------------------------
[1/60] Running health
--------------------------------------------------------------------------------
| UTC Time         | RUNNING | SUCCESS | UNSTABLE | ABORTED | FAILURE | Green Rate |
| ---------------- | ------- | ------- | -------- | ------- | ------- | ---------- |
| 2020-07-03 16:50 | 1       | 8       | 27       | 5       | 59      | 8.51%      |

--------------------------------------------------------------------------------
[2/60] Running https://ci.nodejs.org/job/node-test-commit/39446/
--------------------------------------------------------------------------------
✔  Build data downloaded
✔  Data downloaded
----------------------------------- Summary ------------------------------------
Result     FAILURE
URL        https://ci.nodejs.org/job/node-test-commit/39446/
Source     https://api.github.com/repos/libuv/ci-tmp-libuv-node/git/refs/heads/jenkins-libuv-in-node-141
Commit     [b205f29c5b4d] Replace libuv version with refs/heads/v1.x from libuv/libuv
Date       2020-07-03 15:44:21 +0000
Author     ci <ci@iojs.org>
-------------------------------- freebsd11-x64 ---------------------------------
URL        https://ci.nodejs.org/job/node-test-commit-freebsd/nodes=freebsd11-x64/34327/console
Type       JENKINS_FAILURE
Built On   test-digitalocean-freebsd11-x64-2
Reason     
  Build timed out (after 6 minutes). Marking the build as failed.
--------------------------------- Other builds ---------------------------------
Unstable   https://ci.nodejs.org/job/node-test-commit-linux/35929/
Unstable   https://ci.nodejs.org/job/node-test-commit-arm-fanned/15212/
--------------------------------------------------------------------------------
[3/60] Running https://ci.nodejs.org/job/node-test-commit/39444/
...etc
```

Possible use cases:

1. Walk CI for the latest 100 runs of `node-test-pull-request`,
aggregate failures, write the results into a Markdown file,
and then cache the responses from Jenkins so that the next time the command
is run, it picks up cached data written on disk for jobs whose results
are known.

Note: results are cached in `${ncu_intallation_path}/.ncu/cache`, so you
may want to clean it up from time to time.

```
ncu-ci walk pr --stats --cache --markdown results.md
```

2. Walk  CI for the latest 100 runs of `node-test-pull-request`, and then write the
failures into a JSON file named database.json.

```
ncu-ci walk pr --json database.json
```

### `ncu-ci pr <jobid>` 

`ncu-ci pr <jobid>` returns information about the results of a `node-test-pull-request` job.

For example, if you would like to see the results of `node-test-pull-request` for https://github.com/nodejs/node/pull/34127, you would visit the PR and note that the `node-test-pull-request` job can be found at https://ci.nodejs.org/job/node-test-pull-request/32158, and therefore the `<jobid>` is `32158`, not `34127`. See `ncu-ci pr --help` for more.

Example:
```sh
node on git:main ❯ ncu-ci pr 32158
--------------------------------------------------------------------------------
[1/1] Running PR: 32158
--------------------------------------------------------------------------------
✔  Build data downloaded
----------------------------------- Summary ------------------------------------
Result     UNSTABLE
URL        https://ci.nodejs.org/job/node-test-pull-request/32158/
Source     https://github.com/nodejs/node/pull/34127/
Commit     [faa808326cb0] lib: handle missing callbackMap in esm logic
Date       2020-06-29 16:51:58 -0700
Author     Shelley Vohr <shelley.vohr@gmail.com>
--------------------------------- Other builds ---------------------------------
Unstable   https://ci.nodejs.org/job/node-test-commit-arm-fanned/15155/
```

### `ncu-ci commit <jobid>` 

`ncu-ci commit <jobid>` returns information about the results of a specified `node-test-commit` job.

For example, if you would like to see the results of `node-test-commit` for https://github.com/nodejs/node/pull/34086, you would visit the PR and note that the `node-test-commit` job can be found at https://ci.nodejs.org/job/node-test-commit/39377, and therefore the `<jobid>` is `39377`, not `34086`. See `ncu-ci commit --help` for more.

Example:
```sh
node on git:main ❯ ncu-ci commit 39377
--------------------------------------------------------------------------------
[1/1] Running COMMIT: 39377
--------------------------------------------------------------------------------
✔  Build data downloaded
----------------------------------- Summary ------------------------------------
Result     UNSTABLE
URL        https://ci.nodejs.org/job/node-test-commit/39377/
Source     https://github.com/undefined/undefined/pull/34086/
Commit     [725a1df7b849] quic: remove redundant cast
Date       2020-06-27 22:14:09 +0800
Author     Jiawen Geng <technicalcute@gmail.com>
--------------------------------- Other builds ---------------------------------
Unstable   https://ci.nodejs.org/job/node-test-commit-linux/35868/
Unstable   https://ci.nodejs.org/job/node-test-commit-arm-fanned/15148/
```

### `ncu-ci url <url>` 

`ncu-ci url <url>` takes a url corresponding to a PR on `nodejs/node`, detects the CI type (either `node-test-commit` or `node-test-pull-request`) and corresponding job id for the latest run, and returns a summary of results about the job run. See `ncu-ci url --help` for more.

Example:
```sh
node on git:main ❯ ncu-ci url https://github.com/nodejs/node/pull/34127
--------------------------------------------------------------------------------
[1/1] Running PR: 32158
--------------------------------------------------------------------------------
✔  Build data downloaded
----------------------------------- Summary ------------------------------------
Result     UNSTABLE
URL        https://ci.nodejs.org/job/node-test-pull-request/32158/
Source     https://github.com/nodejs/node/pull/34127/
Commit     [faa808326cb0] lib: handle missing callbackMap in esm logic
Date       2020-06-29 16:51:58 -0700
Author     Shelley Vohr <shelley.vohr@gmail.com>
--------------------------------- Other builds ---------------------------------
Unstable   https://ci.nodejs.org/job/node-test-commit-arm-fanned/15155/
```

### `ncu-ci benchmark <jobid>` 

`ncu-ci benchmark <jobid>` displays the results of a specified `benchmark-node-micro-benchmarks` CI job. See `ncu-ci benchmark --help` for more.

Example:
```sh
node on git:main ❯ ncu-ci benchmark 636
--------------------------------------------------------------------------------
[1/1] Running BENCHMARK: 636
--------------------------------------------------------------------------------
✔  Data downloaded
                                                                                               confidence improvement accuracy (*) (**) (***)
 http2/compat.js duration=5 benchmarker='test-double-http2' clients=2 streams=100 requests=100         NA       NaN %           NA   NA    NA
 http2/compat.js duration=5 benchmarker='test-double-http2' clients=2 streams=10 requests=100          NA       NaN %           NA   NA    NA
 http2/compat.js duration=5 benchmarker='test-double-http2' clients=2 streams=10 requests=1000         NA       NaN %           NA   NA    NA
 http2/compat.js duration=5 benchmarker='test-double-http2' clients=2 streams=1 requests=100           NA       NaN %           NA   NA    NA
 http2/compat.js duration=5 benchmarker='test-double-http2' clients=2 streams=1 requests=1000          NA       NaN %           NA   NA    NA
 http2/compat.js duration=5 benchmarker='test-double-http2' clients=2 streams=200 requests=100         NA       NaN %           NA   NA    NA
 http2/compat.js duration=5 benchmarker='test-double-http2' clients=2 streams=20 requests=100          NA       NaN %           NA   NA    NA
 http2/compat.js duration=5 benchmarker='test-double-http2' clients=2 streams=20 requests=1000         NA       NaN %           NA   NA    NA
 http2/compat.js duration=5 benchmarker='test-double-http2' clients=2 streams=40 requests=100          NA       NaN %           NA   NA    NA

Be aware that when doing many comparisons the risk of a false-positive
result increases. In this case there are 9 comparisons, you can thus
expect the following amount of false-positive results:
  0.45 false positives, when considering a   5% risk acceptance (*, **, ***),
  0.09 false positives, when considering a   1% risk acceptance (**, ***),
  0.01 false positives, when considering a 0.1% risk acceptance (***)
++ mv output030720-170033.csv /w/bnch-comp
Collecting metadata...
Metadata collection done.
Notifying upstream projects of job completion
Finished: SUCCESS
```

### `ncu-ci citgm <jobid> [jobid2]`

`ncu-ci citgm <jobid> [jobid2]` shows the results of a given citgm-smoker job, with the option to compare per-platform results of two jobs. You See `ncu-ci citgm --help` for more.

Example:
```
node on git:main ❯ ncu-ci citgm 2400
--------------------------------------------------------------------------------
[1/1] Running CITGM: 2400
--------------------------------------------------------------------------------
✔  Header data downloaded
✔  Report data downloaded
----------------------------------- Summary ------------------------------------
Result     FAILURE
URL        https://ci.nodejs.org/job/citgm-smoker/2400/testReport/
Source     https://github.com/nodejs/node/pull/34093/
Commit     [9ec07f42864c] 2020-06-30, Version 14.5.0 (Current)
Date       2020-06-29 21:17:56 -0700
Author     Shelley Vohr <shelley.vohr@gmail.com>
----------------------------------- Failures -----------------------------------
┌────────────────────────┬───────────────────────┬───────────────────────┬─────────────────────────┬─────────────────────┬─────────────────┬────────────────────┐
│        (index)         │           0           │           1           │            2            │          3          │        4        │         5          │
├────────────────────────┼───────────────────────┼───────────────────────┼─────────────────────────┼─────────────────────┼─────────────────┼────────────────────┤
│       debian9-64       │ 'coffeescript-v2.5.1' │   'through2-v4.0.2'   │                         │                     │                 │                    │
│      rhel7-s390x       │   'through2-v4.0.2'   │                       │                         │                     │                 │                    │
│   fedora-latest-x64    │ 'coffeescript-v2.5.1' │   'through2-v4.0.2'   │                         │                     │                 │                    │
│     ubuntu1604-64      │ 'coffeescript-v2.5.1' │   'through2-v4.0.2'   │                         │                     │                 │                    │
│        osx1014         │    'acorn-v7.3.1'     │ 'coffeescript-v2.5.1' │     'clinic-v6.0.2'     │ 'ember-cli-v3.19.0' │ 'semver-v7.3.2' │ 'watchify-v3.11.1' │
│     ubuntu1804-64      │ 'coffeescript-v2.5.1' │   'through2-v4.0.2'   │                         │                     │                 │                    │
│ fedora-last-latest-x64 │ 'coffeescript-v2.5.1' │   'through2-v4.0.2'   │                         │                     │                 │                    │
│     centos7-ppcle      │ 'coffeescript-v2.5.1' │    'clinic-v6.0.2'    │ 'torrent-stream-v1.2.0' │  'through2-v4.0.2'  │                 │                    │
└────────────────────────┴───────────────────────┴───────────────────────┴─────────────────────────┴─────────────────────┴─────────────────┴────────────────────┘
```

Comparison Example:
```sh
node-core-utils on git:allow-citgm-comparison ❯ ncu-ci citgm 2392 2390
--------------------------------------------------------------------------------
[1/1] Running CITGM: 2392
--------------------------------------------------------------------------------
✔  Summary data downloaded
✔  Results data downloaded
✔  Summary data downloaded
✔  Results data downloaded
----------------------------------- Summary ------------------------------------
Result     FAILURE
URL        https://ci.nodejs.org/job/citgm-smoker/2392/
Source     https://api.github.com/repos/nodejs/node/git/refs/heads/v12.x
Commit     [feed95cd4c2c] Working on v12.18.1
Date       2020-06-02 20:27:47 +0200
Author     Michaël Zasso <targos@protonmail.com>
----------------------------------- Summary ------------------------------------
Result     FAILURE
URL        https://ci.nodejs.org/job/citgm-smoker/2390/
Source     https://github.com/nodejs/node/pull/33811/
Commit     [9a60117875dd] 2020-06-16, Version 12.18.1 'Erbium' (LTS)
Date       2020-06-09 20:23:09 -0700
Author     Shelley Vohr <shelley.vohr@gmail.com>
----------------------------------- Results ------------------------------------



FAILURE: 5 failures in 2390 not present in 2392


┌────────────────────────┬───────────────────────────┬────────────────────────────┐
│        (index)         │             0             │             1              │
├────────────────────────┼───────────────────────────┼────────────────────────────┤
│     centos7-ppcle      │      'multer-v1.4.2'      │                            │
│   fedora-latest-x64    │    'spawn-wrap-v2.0.0'    │                            │
│ fedora-last-latest-x64 │                           │                            │
│       debian9-64       │ 'express-session-v1.17.1' │ 'yeoman-generator-v4.10.1' │
│        osx1014         │                           │                            │
│      rhel7-s390x       │  'torrent-stream-v1.2.0'  │                            │
│      aix71-ppc64       │                           │                            │
│     ubuntu1604-64      │                           │                            │
│     ubuntu1804-64      │                           │                            │
└────────────────────────┴───────────────────────────┴────────────────────────────┘
```

### `ncu-ci daily`

`ncu-ci daily` show recent results of `node-daily-master`. You can also aggregate the results by passing `--cache`, or limit the maximum number of CIs jobs to get data from with `--limit=N`. See `ncu-ci daily --help` for more.

```sh
node on git:main ❯ ncu-ci daily
✔  Done--------------------------------------------------------------------------------
[1/16] Running health
--------------------------------------------------------------------------------
| UTC Time         | RUNNING | SUCCESS | UNSTABLE | ABORTED | FAILURE | Green Rate |
| ---------------- | ------- | ------- | -------- | ------- | ------- | ---------- |
| 2020-07-20 19:15 | 0       | 6       | 5        | 1       | 34      | 13.33%     |

--------------------------------------------------------------------------------
[2/16] Running https://ci.nodejs.org/job/node-daily-master/2004/
--------------------------------------------------------------------------------
✔  Build data downloaded
✔  Build data downloaded
✔  Data downloaded
----------------------------------- Summary ------------------------------------
Result     FAILURE
URL        https://ci.nodejs.org/job/node-test-commit/39692/
Source     https://api.github.com/repos/nodejs/node/git/refs/heads/main
Commit     [bf0d82c10247] test: remove common.localhostIPv6
Date       2020-07-16 16:57:30 -0700
Author     Rich Trott <rtrott@gmail.com>
-------------------------------- ubuntu1604-64 ---------------------------------
URL        https://ci.nodejs.org/job/node-test-commit-linux/nodes=ubuntu1604-64/36148/console
Type       JS_TEST_FAILURE
Built On   test-rackspace-ubuntu1604-x64-1
Reason     
  not ok 2783 benchmark/test-benchmark-streams
    ---
    duration_ms: 2.518
    severity: fail
    exitcode: 1
    stack: |-
      assert.js:385
          throw err;
          ^
      
      AssertionError [ERR_ASSERTION]: benchmark file not running exactly one configuration in test: 
      streams/creation.js
      streams/creation.js kind="duplex" n=1: 6,840.272790078869
      
      streams/pipe-object-mode.js
      streams/pipe-object-mode.js n=1: 134.18694119525676
      
      streams/pipe.js
      streams/pipe.js n=1: 127.79219557726546
      
      streams/readable-async-iterator.js
      2
      streams/readable-async-iterator.js sync="yes" n=1: 120.35939314793974
      
      streams/readable-bigread.js
      streams/readable-bigread.js n=1: 29.298658098020184
      
      streams/readable-bigunevenread.js
      streams/readable-bigunevenread.js n=1: 22.972824549899766
      
      streams/readable-boundaryread.js
      streams/readable-boundaryread.js type="string" n=1: 17.122757569423193
      
      streams/readable-readall.js
      streams/readable-readall.js n=1: 53.44909695078247
      
      streams/readable-unevenread.js
      streams/readable-unevenread.js n=1: 15.20828514524817
      
      streams/writable-manywrites.js
      streams/writable-manywrites.js len=1 callback="yes" writev="yes" sync="yes" n=1: 1,075.9039475991742
      
          at ChildProcess.<anonymous> (/home/iojs/build/workspace/node-test-commit-linux/nodes/ubuntu1604-64/test/common/benchmark.js:38:12)
          at ChildProcess.emit (events.js:314:20)
          at Process.ChildProcess._handle.onexit (internal/child_process.js:276:12) {
        generatedMessage: false,
        code: 'ERR_ASSERTION',
        actual: false,
        expected: true,
        operator: '=='
      }
    ...
  
--------------------------------- Other builds ---------------------------------
--------------------------------------------------------------------------------
[3/16] Running https://ci.nodejs.org/job/node-daily-master/2003/
--------------------------------------------------------------------------------
✔  Build data downloaded
✔  Build data downloaded
⠸ Querying console text for job/node-test-commit-osx/nodes=osx1015/35280/
```

## Caveats

The CI failures are parsed using pattern matching and could be incorrect. Feel
free to open a pull request whenever you find a case that ncu-ci does not handle
well.
