import { basename } from 'node:path';

import { getPrURL } from './links.js';
import { IGNORE } from './run.js';

const BENCHMARK_DIR = 'benchmark';
// Entries in the benchmark folder that are not benchmark categories.
const NON_CATEGORY_DIRS = new Set(['fixtures']);

export default class BenchmarkSession {
  constructor(cli, request, argv) {
    this.cli = cli;
    this.request = request;
    this.argv = argv;
    this.workflow = argv.workflow || 'benchmark.yml';
  }

  get prUrl() {
    const { owner, repo, prid } = this.argv;
    return getPrURL({ owner, repo, prid });
  }

  async getPullRequest() {
    const { cli } = this;
    cli.startSpinner(`Fetching data for ${this.prUrl}`);
    const pr = await this.request.getPullRequest(this.prUrl);
    if (!pr || !pr.head) {
      cli.stopSpinner(
        `Could not find pull request ${this.prUrl}`,
        cli.SPINNER_STATUS.FAILED);
      throw new Error(IGNORE);
    }
    cli.stopSpinner(`Fetched data for ${this.prUrl}`);
    this.pr = pr;
    return pr;
  }

  async getCategories() {
    const { cli, pr } = this;
    const head = pr.head;
    // Prefer listing the benchmark folder on the PR head, falling back to the
    // base branch if the head repository is unavailable (e.g. deleted fork).
    const source = head.repo
      ? { fullName: head.repo.full_name, ref: head.sha }
      : { fullName: pr.base.repo.full_name, ref: pr.base.ref };
    const [owner, repo] = source.fullName.split('/');

    cli.startSpinner('Fetching available benchmark categories');
    let entries;
    try {
      entries = await this.request.listDirectory({
        owner,
        repo,
        path: BENCHMARK_DIR,
        ref: source.ref
      });
    } catch (e) {
      cli.stopSpinner(
        'Could not fetch benchmark categories',
        cli.SPINNER_STATUS.FAILED);
      throw e;
    }

    const categories = entries
      .filter((entry) => entry.type === 'dir')
      .map((entry) => entry.name)
      .filter((name) => !NON_CATEGORY_DIRS.has(name))
      .sort();

    if (categories.length === 0) {
      cli.stopSpinner(
        `No benchmark categories found in ${source.fullName}/${BENCHMARK_DIR}`,
        cli.SPINNER_STATUS.FAILED);
      throw new Error(IGNORE);
    }

    cli.stopSpinner(`Found ${categories.length} benchmark categories`);
    this.categories = categories;
    return categories;
  }

  async getTouchedBenchmarks() {
    const { cli, argv } = this;
    const touched = [];
    try {
      const files = this.request.getPullRequestFiles({
        owner: argv.owner,
        repo: argv.repo,
        prid: argv.prid
      });
      for await (const file of files) {
        const match = /^benchmark\/([^/]+)\/(.+\.js)$/.exec(file.filename);
        if (match && this.categories.includes(match[1])) {
          touched.push({
            category: match[1],
            name: basename(match[2], '.js')
          });
        }
      }
    } catch {
      // Not being able to fetch the changed files is not fatal: fall back to
      // an empty pre-selection.
      cli.warn('Could not determine which benchmark files the PR touches.');
    }
    this.touched = touched;
    return touched;
  }

  // Guess relevant categories from the PR subsystem labels, matching a label
  // to a category name up to a trailing plural "s" (e.g. `buffer` -> `buffers`).
  categoriesFromLabels() {
    const normalize = (name) => name.toLowerCase().replace(/s$/, '');
    const labels = (this.pr.labels ?? [])
      .map((label) => (typeof label === 'string' ? label : label.name))
      .filter(Boolean)
      .map(normalize);
    return new Set(
      this.categories.filter((category) =>
        labels.includes(normalize(category))));
  }

  async promptCategories() {
    const { cli, categories } = this;
    // Fall back to the PR labels when the PR does not touch any benchmark file.
    const preselected = this.touched.length
      ? new Set(this.touched.map((f) => f.category))
      : this.categoriesFromLabels();

    cli.info(`Based on the PR ${
        this.touched.length ? 'changed files' : 'labels'
      }, this/these benchmark(s) seem(s) relevant:`);
    cli.info([...preselected].join(', '));
    cli.info('If not relevant, do not forget to unselect it/them.');

    const selected = await cli.promptCheckbox(
      'Select the benchmark categories to run:',
      categories.map((name) => ({
        name,
        value: name,
        checked: preselected.has(name)
      })));

    if (!selected || selected.length === 0) {
      cli.warn('No benchmark category selected, aborting.');
      throw new Error(IGNORE);
    }
    return selected;
  }

  async promptFilter(selected) {
    const { cli, touched } = this;

    // When a single benchmark file was touched and only its category is
    // selected, pre-fill the filter with that file so it runs on its own.
    const defaultAnswer =
      touched.length === 1 && selected.length === 1 &&
      selected[0] === touched[0].category
        ? touched[0].name
        : '';

    const filter = await cli.prompt(
      'Substring to filter which benchmarks run (leave empty to run all):',
      { questionType: cli.QUESTION_TYPE.INPUT, defaultAnswer });
    return filter?.trim() || undefined;
  }

  async start() {
    const { cli, argv } = this;

    await this.getPullRequest();
    await this.getCategories();
    cli.startSpinner('Checking for benchmark files listed in the PR changes...');
    await this.getTouchedBenchmarks();
    cli.stopSpinner(`Found ${this.touched.length} benchmark file(s) in the PR changes`);
    const selected = await this.promptCategories();
    const filter = await this.promptFilter(selected);

    const workflowOwner = argv.workflowOwner || argv.owner;
    const workflowRepo = argv.workflowRepo || argv.repo;
    const prRepo = `${argv.owner}/${argv.repo}`;
    // The workflow token can only comment when it runs in the PR repository;
    // default to not commenting when the workflow lives elsewhere.
    const sameRepo = `${workflowOwner}/${workflowRepo}` === prRepo;
    const postComment = await cli.prompt(
      'Should the workflow post the results as a comment on the PR?',
      { defaultAnswer: sameRepo });

    const category = selected.join(' ');
    // Benchmark the commit provided on the command line, defaulting to the
    // current PR head.
    const commit = argv.commit || this.pr.head.sha;

    const inputs = {
      pr_id: `${argv.prid}`,
      commit,
      category
    };
    // The benchmark workflow checks out `inputs.repo || github.repository`; only
    // set it when the workflow lives in a different repository than the PR.
    if (!sameRepo) {
      inputs.repo = prRepo;
    }
    if (filter) {
      inputs.filter = filter;
    }
    if (argv.runs != null) {
      inputs.runs = `${argv.runs}`;
    }
    inputs['post-comment'] = `${postComment}`;

    cli.separator('Benchmark');
    cli.table('PR:', this.prUrl);
    cli.table('Commit:', commit);
    cli.table('Categories:', category);
    if (inputs.filter) cli.table('Filter:', inputs.filter);
    if (inputs.runs) cli.table('Runs:', inputs.runs);
    cli.table('Comment on PR:', postComment ? 'yes' : 'no');
    cli.table('Workflow:',
      `${workflowOwner}/${workflowRepo} (${this.workflow}@${argv.ref})`);

    const confirmed = await cli.prompt(
      'Trigger the benchmark workflow with these settings?',
      { defaultAnswer: true });
    if (!confirmed) {
      cli.warn('Aborted, no workflow was triggered.');
      throw new Error(IGNORE);
    }

    cli.startSpinner('Dispatching benchmark workflow');
    await this.request.dispatchWorkflow(this.workflow, {
      owner: workflowOwner,
      repo: workflowRepo,
      ref: argv.ref,
      inputs
    });
    cli.stopSpinner('Benchmark workflow dispatched');
    cli.info('Follow the run at ' +
      `https://github.com/${workflowOwner}/${workflowRepo}/actions/` +
      `workflows/${this.workflow}`);
  }
}
