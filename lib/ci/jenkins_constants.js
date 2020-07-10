// com.tikal.jenkins.plugins.multijob.MultiJobBuild
const BUILD_FIELDS = 'builtOn,buildNumber,jobName,result,url';
const ACTION_TREE = 'actions[parameters[name,value]]';
const CHANGE_FIELDS = 'commitId,author[absoluteUrl,fullName],authorEmail,' +
                      'msg,date';
const CHANGE_TREE = `changeSet[items[${CHANGE_FIELDS}]]`;
const PR_TREE =
  `result,url,number,${ACTION_TREE},${CHANGE_TREE},builtOn,` +
  `subBuilds[${BUILD_FIELDS},build[subBuilds[${BUILD_FIELDS}]]]`;
const COMMIT_TREE =
  `result,url,number,${ACTION_TREE},${CHANGE_TREE},builtOn,` +
  `subBuilds[${BUILD_FIELDS}]`;
const CITGM_MAIN_TREE =
  `result,url,number,${ACTION_TREE},${CHANGE_TREE},builtOn`;

const FANNED_TREE =
  `result,url,number,subBuilds[phaseName,${BUILD_FIELDS}]`;

// hudson.tasks.test.MatrixTestResult
const RESULT_TREE = 'result[suites[cases[name,status]]]';
const CITGM_REPORT_TREE =
`failCount,skipCount,totalCount,childReports[child[url],${RESULT_TREE}]`;

// hudson.matrix.MatrixBuild
const BUILD_TREE = 'result,runs[url,number,result],builtOn';
const LINTER_TREE = 'result,url,number,builtOn';
const CAUSE_TREE = 'upstreamBuild,upstreamProject,shortDescription,_class';
const RUN_TREE = `actions[causes[${CAUSE_TREE}]],builtOn`;

module.exports = {
  PR_TREE,
  COMMIT_TREE,
  CITGM_MAIN_TREE,
  FANNED_TREE,
  CITGM_REPORT_TREE,
  BUILD_TREE,
  LINTER_TREE,
  RUN_TREE
};
