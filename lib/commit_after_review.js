function commitAfterReview(commit, review, logger) {
  let commitIndex = commit.length === 0
    ? 0 : commit.length - 1;
  let reviewIndex = review.length === 0
    ? 0 : review.length - 1;

  let lastCommit = commit[commitIndex].commit;
  let lastReview = review[reviewIndex];

  let commitInfo = getDate(lastCommit.committedDate);
  let reviewInfo = getDate(lastReview.publishedAt);

  logger.info('checking if new commits were pushed' +
              ' after last review');

  switch (false) {
    // very edge case senario
    // commit after 1 year!
    case (commitInfo.year < reviewInfo.year ||
          commitInfo.year === reviewInfo.year):
      warn();
      break;

    case (commitInfo.month < reviewInfo.month ||
          commitInfo.month === reviewInfo.month):
      warn();
      break;

    case (commitInfo.date < reviewInfo.date ||
          commitInfo.date === reviewInfo.date):
      warn();
      break;

    case (commitInfo.hour < reviewInfo.hour ||
          commitInfo.hour === reviewInfo.hour):
      warn();
      break;

    case (commitInfo.minutes < reviewInfo.minutes ||
         commitInfo.minutes === reviewInfo.minutes):
      warn();
      break;
  }

  function warn() {
    let msg = 'There has been new commits pushed' +
              ' to Pull Request the since last review';
    logger.warn(msg);
    let pullURL = lastReview.url.split('#')[0];
    let commitURL = `${pullURL}/commits/${lastCommit.oid}`;
    let allChangesURL = `${pullURL}/files`;
    logger.warn('New commit url: ', commitURL);
    logger.warn('see all the changes: ', allChangesURL);
  }
}

function getDate(_date) {
  _date = _date.split('T');

  let day = _date[0];
  let time = _date[1];
  day = day.split('-');
  time = time.split(':');

  let date = {
    year: +day[0],
    month: +day[1],
    date: +day[2],
    hour: +time[0],
    minutes: +time[1]
  };

  return date;
}

module.exports = commitAfterReview;
