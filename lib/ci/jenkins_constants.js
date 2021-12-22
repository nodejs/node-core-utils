// com.tikal.jenkins.plugins.multijob.MultiJobBuild
const BUILD_FIELDS = 'builtOn,buildNumber,jobName,result,url';
const ACTION_TREE = 'actions[parameters[name,value]]';
const CHANGE_FIELDS = 'commitId,author[absoluteUrl,fullName],authorEmail,' +
                      'msg,date';
const CHANGE_TREE = `changeSet[items[${CHANGE_FIELDS}]]`;
export const PR_TREE =
  `result,url,number,${ACTION_TREE},${CHANGE_TREE},builtOn,` +
  `subBuilds[${BUILD_FIELDS},build[subBuilds[${BUILD_FIELDS}]]]`;
export const COMMIT_TREE =
  `result,url,number,${ACTION_TREE},${CHANGE_TREE},builtOn,` +
  `subBuilds[${BUILD_FIELDS}]`;
export const CITGM_MAIN_TREE =
  `result,url,number,${ACTION_TREE},${CHANGE_TREE},builtOn`;

export const FANNED_TREE =
  `result,url,number,subBuilds[phaseName,${BUILD_FIELDS}]`;

// hudson.tasks.test.MatrixTestResult
const RESULT_TREE = 'result[suites[cases[name,status]]]';
export const CITGM_REPORT_TREE =
`failCount,skipCount,totalCount,childReports[child[url],${RESULT_TREE}]`;

// hudson.matrix.MatrixBuild
export const BUILD_TREE = 'result,runs[url,number,result],builtOn';
export const LINTER_TREE = 'result,url,number,builtOn';
const CAUSE_TREE = 'upstreamBuild,upstreamProject,shortDescription,_class';
export const RUN_TREE = `actions[causes[${CAUSE_TREE}]],builtOn`;
