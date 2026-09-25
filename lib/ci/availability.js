import { readJenkinsJSON } from './jenkins.js';

export async function checkAvailability(request) {
  const signal = AbortSignal.timeout(20_000);
  const controller = await readJenkinsJSON(request, '/api/json?tree=quietingDown', signal);
  if (controller?.quietingDown === true) {
    throw new Error('Jenkins is preparing for shutdown');
  }
  if (controller?.quietingDown !== false) {
    throw new Error('Jenkins quiet-down state is not confirmed');
  }

  const job = await readJenkinsJSON(request,
    '/job/node-test-pull-request/api/json?tree=disabled,buildable', signal);
  if (job?.disabled === true) {
    throw new Error('Jenkins PR job is disabled');
  }
  if (job?.buildable === false) {
    throw new Error('Jenkins PR job is not buildable');
  }
  if (job?.disabled !== false || job?.buildable !== true) {
    throw new Error('Jenkins PR job availability is not confirmed');
  }
}
