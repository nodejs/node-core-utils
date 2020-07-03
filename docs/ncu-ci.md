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

Options:
  --version   Show version number                                      [boolean]
  --copy      Write the results as markdown to clipboard        [default: false]
  --json      Write the results as json to the path                     [string]
  --markdown  Write the results as markdown to the path                 [string]
  --help      Show help                                                [boolean]
```

### `ncu-ci rate <type>`

`ncu-ci rate <type>` calculate the success rate for CI jobs in the last 100 runs per [CI Health History](https://github.com/nodejs/reliability#ci-health-history), where `<type>` can be either `pr` for `node-test-pull-request` or `commit` for `node-test-commit`.

Examples:

```sh
node on git:master ❯ ncu-ci rate pr
--------------------------------------------------------------------------------
[1/1] Running health
--------------------------------------------------------------------------------
✔  Done
| UTC Time         | RUNNING | SUCCESS | UNSTABLE | ABORTED | FAILURE | Green Rate |
| ---------------- | ------- | ------- | -------- | ------- | ------- | ---------- |
| 2020-07-03 16:28 | 1       | 7       | 34       | 10      | 48      | 7.87%      |
```

```sh
node on git:master ❯ ncu-ci rate commit
--------------------------------------------------------------------------------
[1/1] Running health
--------------------------------------------------------------------------------
✔  Done
| UTC Time         | RUNNING | SUCCESS | UNSTABLE | ABORTED | FAILURE | Green Rate |
| ---------------- | ------- | ------- | -------- | ------- | ------- | ---------- |
| 2020-07-03 16:28 | 2       | 8       | 27       | 5       | 58      | 8.60%      |
```

### `ncu-ci walk <type>`

`ncu-ci walk <type>` walks CI and displays failures, where `<type>` can be either `pr` for `node-test-pull-request` or `commit` for `node-test-commit`.

Example
```sh
node on git:master ❯ ncu-ci walk commit
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

For example, if you would like to see the results of `node-test-pull-request` for https://github.com/nodejs/node/pull/34127, you would visit the PR and note that the `node-test-pull-request` job can be found at https://ci.nodejs.org/job/node-test-pull-request/32158, and therefore the `<jobid>` is `32158`, not `34127`.

Example:
```sh
node on git:master ❯ ncu-ci pr 32158
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

For example, if you would like to see the results of `node-test-commit` for https://github.com/nodejs/node/pull/34086, you would visit the PR and note that the `node-test-commit` job can be found at https://ci.nodejs.org/job/node-test-commit/39377, and therefore the `<jobid>` is `39377`, not `34086`.

Example:
```sh
node on git:master ❯ ncu-ci commit 39377
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

`ncu-ci url <url>` takes a url corresponding to a PR on `nodejs/node`, detects the CI type (either `node-test-commit` or `node-test-pull-request`) and corresponding job id for the latest run, and returns a summary of results about the job run.

Example:
```sh
node on git:master ❯ ncu-ci url https://github.com/nodejs/node/pull/34127
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

`ncu-ci benchmark <jobid>` displays the results of a specified `benchmark-node-micro-benchmarks` CI job.

Example:
```sh
node on git:master ❯ ncu-ci benchmark 636
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

## Caveats

The CI failures are parsed using pattern matching and could be incorrect. Feel
free to open a pull request whenever you find a case that ncu-ci does not handle
well.
