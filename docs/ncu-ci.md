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
  ncu-ci walk <type>        Walk the CI and store the failures
  ncu-ci url <url>          Automatically detect CI type and show results
  ncu-ci pr <jobid>         Show results of a node-test-pull-request CI job
  ncu-ci commit <jobid>     Show results of a node-test-commit CI job
  ncu-ci benchmark <jobid>  Show results of a benchmark-node-micro-benchmarks CI
                            job

Options:
  --version  Show version number                                       [boolean]
  --copy     Write the results as markdown to clipboard         [default: false]
  --json     Write the results as json to the path                      [string]
  --help     Show help                                                 [boolean]
```

## Example

Get the CI results of PR 12345 (including latest results of each type of
supported CI) and copy the summaries into clipboard:

```
ncu-ci url https://github.com/nodejs/node/pull/12345 --copy
```

Get the results of job #12345 of  `node-test-pull-request`:

```
ncu-ci pr 12345
```

Walk the CI for the latest 100 runs of `node-test-pull-request`, write the
failures into a JSON file

```
ncu-ci walk pr --json database.json
```

Calculate the green rate of the CI for
[CI Health History](https://github.com/nodejs/reliability#ci-health-history)

```
ncu-ci rate pr
```

## Caveats

The CI failures are parsed using pattern matching and could be incorrect. Feel
free to open a pull request whenever you find a case that ncu-ci does not handle
well.
