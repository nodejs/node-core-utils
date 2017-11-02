'use strict';

const assert = require('assert');
const sinon = require('sinon');
const {
  approvingReviews,
  allGreenReviewers,
  commentsWithLGTM,
  simpleCommits,
  collaborators,
  firstTimerPR,
  readme
} = require('../fixtures/data');
const TestLogger = require('../fixtures/test_logger');
const logger = new TestLogger();
const PRData = require('../../lib/pr_data');

function toRaw(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const rawPR = toRaw({
  repository: { pullRequest: firstTimerPR }
});
const rawUser = {
  user: {
    login: 'pr_author',
    email: 'pr_author@example.com'
  }
};

describe('PRData', function() {
  const request = {
    promise: sinon.stub(),
    gql: sinon.stub()
  };

  request.promise.withArgs({
    url: 'https://raw.githubusercontent.com/nodejs/node/master/README.md'
  }).returns(Promise.resolve(readme));
  request.promise.returns(new Error('unknown query'));
  request.gql.withArgs('PR').returns(Promise.resolve(rawPR));
  request.gql.withArgs('User').returns(Promise.resolve(rawUser));
  request.gql.withArgs('Reviews').returns(
    Promise.resolve(toRaw(approvingReviews)));
  request.gql.withArgs('PRComments').returns(
    Promise.resolve(toRaw(commentsWithLGTM)));
  request.gql.withArgs('PRCommits').returns(
    Promise.resolve(toRaw(simpleCommits)));

  request.gql.returns(new Error('unknown query'));

  it('getAll', async() => {
    const data = new PRData(16348, 'nodejs', 'node', logger, request);
    await data.getAll();
    assert.deepStrictEqual(data.collaborators, collaborators);
    assert.deepStrictEqual(data.pr, firstTimerPR);
    assert.deepStrictEqual(data.reviews, approvingReviews);
    assert.deepStrictEqual(data.comments, commentsWithLGTM);
    assert.deepStrictEqual(data.commits, simpleCommits);
    assert.deepStrictEqual(data.reviewers, allGreenReviewers);
  });
});
