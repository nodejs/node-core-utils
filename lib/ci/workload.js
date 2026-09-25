import { CI_DOMAIN, CI_TYPES, CI_TYPES_KEYS } from './ci_type_parser.js';
import { readJenkinsJSON } from './jenkins.js';

const PR_JOB_URL = `https://${CI_DOMAIN}/job/${CI_TYPES.get(CI_TYPES_KEYS.PR).jobName}`;

export async function getPRWorkload(request) {
  const signal = AbortSignal.timeout(20_000);
  const data = await readJenkinsJSON(request, '/queue/api/json?tree=items[id,task[url]]', signal);
  if (!Array.isArray(data?.items)) {
    throw new Error('Jenkins returned an invalid queue');
  }

  const queued = new Set();
  for (const item of data.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        !item.task || typeof item.task !== 'object' || Array.isArray(item.task)) {
      throw new Error('Jenkins returned an invalid queue item');
    }
    const { url } = item.task;
    // Some Jenkins task types do not export a URL.
    if (url === undefined || url === null) continue;
    if (typeof url !== 'string') {
      throw new Error('Jenkins returned an invalid queue task URL');
    }
    if (url === PR_JOB_URL || url === `${PR_JOB_URL}/`) {
      if (!Number.isSafeInteger(item.id) || item.id < 0) {
        throw new Error('Jenkins returned an invalid queue item ID');
      }
      queued.add(item.id);
    }
  }

  // PR multijobs stay on an executor while waiting for downstream tests. The
  // waiting queue alone misses those builds, and build history can be truncated.
  const computers = await readJenkinsJSON(request,
    '/computer/api/json?tree=computer[executors[currentExecutable[url,queueId]],' +
    'oneOffExecutors[currentExecutable[url,queueId]]]', signal);
  if (!Array.isArray(computers?.computer)) {
    throw new Error('Jenkins returned invalid executor data');
  }
  const running = new Set();
  for (const computer of computers.computer) {
    if (!Array.isArray(computer?.executors) || !Array.isArray(computer?.oneOffExecutors)) {
      throw new Error('Jenkins returned invalid executor lists');
    }
    for (const executor of [...computer.executors, ...computer.oneOffExecutors]) {
      if (!executor || typeof executor !== 'object' || Array.isArray(executor)) {
        throw new Error('Jenkins returned an invalid executor');
      }
      const build = executor.currentExecutable;
      if (build === undefined || build === null) continue;
      if (typeof build !== 'object' || Array.isArray(build)) {
        throw new Error('Jenkins returned an invalid executable');
      }
      const { url, queueId } = build;
      if (url === undefined || url === null) continue;
      if (typeof url !== 'string') {
        throw new Error('Jenkins returned an invalid executable URL');
      }
      if (!url.startsWith(`${PR_JOB_URL}/`)) continue;
      const match = /^([1-9]\d*)\/?$/.exec(url.slice(PR_JOB_URL.length + 1));
      if (!match) continue;
      if (!Number.isSafeInteger(queueId)) {
        throw new Error('Jenkins returned an invalid executable queue ID');
      }
      running.add(match[1]);
      // A queued request can start between the two reads. Count it only once.
      queued.delete(queueId);
    }
  }
  return queued.size + running.size;
}
