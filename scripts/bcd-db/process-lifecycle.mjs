export function observeChild(child) {
  const state = { closed: false, error: null, code: null, signal: null };
  const done = new Promise((resolve) => {
    child.on('error', (error) => { state.error ??= error; });
    child.once('close', (code, signal) => {
      Object.assign(state, { closed: true, code, signal });
      resolve(state);
    });
  });
  return { state, done };
}

async function closedWithin(observed, milliseconds) {
  if (observed.state.closed) return true;
  let timer;
  try {
    return await Promise.race([
      observed.done.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function stopChild(child, observed, graceMs = 2000, killMs = 2000) {
  const running = () => child.pid != null && !observed.state.closed
    && child.exitCode === null && child.signalCode === null;
  if (running()) child.kill('SIGTERM');
  if (await closedWithin(observed, graceMs)) return observed.state;
  if (running()) child.kill('SIGKILL');
  if (await closedWithin(observed, killMs)) return observed.state;
  throw new Error('POSTGREST_CLEANUP_TIMEOUT', { cause: observed.state.error ?? undefined });
}

// Keep assertion, shutdown and directory failures, in that order; never print PASS here.
export async function cleanupFixture(child, observed, removeDirectory, primaryError) {
  const errors = primaryError === undefined ? [] : [primaryError];
  try {
    if (child && observed) await stopChild(child, observed);
  } catch (error) { errors.push(error); }
  finally {
    try { removeDirectory(); } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'POSTGREST_FIXTURE_FAILED');
}
