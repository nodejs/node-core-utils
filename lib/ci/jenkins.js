import { CI_DOMAIN } from './ci_type_parser.js';

export async function readJenkinsJSON(request, path, signal) {
  const response = await request.fetch(`https://${CI_DOMAIN}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`Jenkins returned HTTP ${response.status} ${response.statusText ?? ''}`.trim());
  }
  try {
    return await response.json();
  } catch (cause) {
    if (signal.aborted) throw signal.reason;
    if (cause instanceof SyntaxError) {
      throw new Error('Jenkins returned invalid JSON', { cause });
    }
    throw cause;
  }
}
