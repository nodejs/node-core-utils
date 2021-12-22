import assert from 'node:assert';

import sinon from 'sinon';

import PRData from '../../lib/pr_data.js';

import {
  approvingReviews,
  allGreenReviewers,
  commentsWithLGTM,
  oddCommits,
  collaborators,
  firstTimerPR,
  readme
} from '../fixtures/data.js';
import TestCLI from '../fixtures/test_cli.js';

function toRaw(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const rawPR = toRaw({
  repository: { pullRequest: firstTimerPR }
});

describe('PRData', function() {
  const request = {
    text: sinon.stub(),
    gql: sinon.stub()
  };

  request.text
    .withArgs('https://raw.githubusercontent.com/nodejs/node/HEAD/README.md')
    .returns(Promise.resolve(readme));
  request.text.returns(new Error('unknown query'));
  request.gql.withArgs('PR').returns(Promise.resolve(rawPR));
  request.gql.withArgs('Reviews').returns(
    Promise.resolve(toRaw(approvingReviews)));
  request.gql.withArgs('PRComments').returns(
    Promise.resolve(toRaw(commentsWithLGTM)));
  request.gql.withArgs('PRCommits').returns(
    Promise.resolve(toRaw(oddCommits)));

  request.gql.returns(new Error('unknown query'));

  const argv = { prid: 16348, owner: 'nodejs', repo: 'node' };
  it('getAll', async() => {
    const cli = new TestCLI();
    const data = new PRData(argv, cli, request);
    await data.getAll();
    assert.deepStrictEqual(data.collaborators, collaborators, 'collaborators');
    assert.deepStrictEqual(data.pr, firstTimerPR, 'pr');
    assert.deepStrictEqual(data.reviews, approvingReviews, 'reviews');
    assert.deepStrictEqual(data.comments, commentsWithLGTM, 'comments');
    assert.deepStrictEqual(data.commits, oddCommits, 'commits');
    assert.deepStrictEqual(data.reviewers, allGreenReviewers, 'reviewers');
  });
});
