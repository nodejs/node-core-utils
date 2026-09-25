import { PRBuild } from './build-types/pr_build.js';

export const RESUME_TREE = 'result,building,' +
  'actions[parameters[name,value],causes[_class,upstreamProject,upstreamBuild,upstreamUrl]]';
const RESUME_CAUSE = 'com.tikal.jenkins.plugins.multijob.ResumeCause';
const PR_JOB = 'node-test-pull-request';

function getParameter(data, name) {
  const values = new Set((data.actions ?? []).flatMap(action => action.parameters ?? [])
    .filter(parameter => parameter.name === name)
    .map(parameter => parameter.value));
  return values.size === 1 ? [...values][0] : undefined;
}

export function getApprovedSHA(data) {
  const value = getParameter(data, 'COMMIT_SHA_CHECK');
  return typeof value === 'string' && value ? value : undefined;
}

export async function hasResumeAction(request, build) {
  // The build API omits unexported actions. The context menu exposes the
  // same actions Jenkins offers to the authenticated user on the build page.
  const response = await request.fetch(`${build.jobUrl}contextMenu`, {
    method: 'GET',
    redirect: 'error'
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(
      `Jenkins returned HTTP ${response.status} ${response.statusText ?? ''}`.trim());
  }
  const menu = await response.json();
  if (!Array.isArray(menu?.items)) {
    throw new Error('Jenkins returned an invalid build context menu');
  }
  const resumeURL = `${build.jobUrl}resume`;
  return menu.items.some(item => {
    // Jenkins' new build page exposes action URLs through a LinkEvent.
    const actionURL = item?.url ?? item?.event?.url;
    if (typeof actionURL !== 'string') return false;
    let url;
    try {
      url = new URL(actionURL, build.jobUrl).href;
    } catch {
      return false;
    }
    return url === resumeURL || url === `${resumeURL}/`;
  });
}

export async function findResumableBuild(cli, request, { jobid, owner, repo, prid }, data) {
  const approvedSHA = getApprovedSHA(data);
  const checkedBuilds = [];
  if (!approvedSHA) return { build: undefined, checkedBuilds, approvedSHA };
  let build = new PRBuild(cli, request, jobid, undefined, RESUME_TREE);
  while (data.building === false &&
         (data.result === 'FAILURE' || data.result === 'ABORTED')) {
    if (getApprovedSHA(data) !== approvedSHA) break;
    const buildOwner = getParameter(data, 'TARGET_GITHUB_ORG');
    const buildRepo = getParameter(data, 'TARGET_REPO_NAME');
    if (typeof buildOwner !== 'string' || buildOwner.toLowerCase() !== owner.toLowerCase() ||
        typeof buildRepo !== 'string' || buildRepo.toLowerCase() !== repo.toLowerCase() ||
        String(getParameter(data, 'PR_ID')) !== String(prid)) {
      throw new Error(`CI job ${jobid} does not match pull request ${owner}/${repo}#${prid}`);
    }
    checkedBuilds.push({ jobid, build });
    if (await hasResumeAction(request, build)) {
      return { jobid, build, checkedBuilds, approvedSHA };
    }

    // Jenkins copies earlier causes when resuming. Follow the nearest parent,
    // not the first cause, and only within this PR job's actual resume lineage.
    const parent = (data.actions ?? []).flatMap(action => action.causes ?? [])
      .filter(cause => cause?._class === RESUME_CAUSE &&
        cause.upstreamProject === PR_JOB && cause.upstreamUrl === `job/${PR_JOB}/` &&
        Number.isSafeInteger(cause.upstreamBuild) &&
        cause.upstreamBuild > 0 && cause.upstreamBuild < jobid)
      .sort((a, b) => b.upstreamBuild - a.upstreamBuild)[0];
    if (!parent) break;

    jobid = parent.upstreamBuild;
    build = new PRBuild(cli, request, jobid, undefined, RESUME_TREE);
    data = await build.getBuildData();
  }
  return { build: undefined, checkedBuilds, approvedSHA };
}
