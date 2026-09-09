import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { observeChild, stopChild, cleanupFixture } from './process-lifecycle.mjs';

const posix = { skip: process.platform === 'win32' ? 'POSIX signal semantics require Linux CI' : false };
const moduleUrl = new URL('./process-lifecycle.mjs', import.meta.url).href;
const synthetic = (source) => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  return { child, observed: observeChild(child) };
};

test('normal early exit and repeated cleanup observe the same close', { timeout: 5000 }, async () => {
  const { child, observed } = synthetic('process.exitCode = 7;');
  await observed.done;
  assert.equal(observed.state.code, 7);
  assert.equal(observed.state.signal, null);
  assert.equal(await stopChild(child, observed), observed.state);
  assert.equal(await stopChild(child, observed), observed.state);
});

test('TERM closes a live child; signal exit is not mistaken for running', { ...posix, timeout: 5000 }, async () => {
  const { child, observed } = synthetic('setInterval(() => {}, 1000); console.log("ready");');
  try {
    await once(child.stdout, 'data');
    await stopChild(child, observed);
    assert.equal(observed.state.signal, 'SIGTERM');
    assert.equal(child.exitCode, null);
    assert.equal(await stopChild(child, observed), observed.state);
  } finally { await stopChild(child, observed); }
});

test('ignored TERM escalates to KILL with bounded waits', { ...posix, timeout: 5000 }, async () => {
  const { child, observed } = synthetic('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); console.log("ready");');
  try {
    await once(child.stdout, 'data');
    await stopChild(child, observed, 40, 1000);
    assert.equal(observed.state.signal, 'SIGKILL');
  } finally { await stopChild(child, observed); }
});

test('ENOENT is observed before close and cleanup does not await another event', { timeout: 5000 }, async () => {
  const child = spawn(`crm-nonexistent-synthetic-child-${process.pid}`, [], { stdio: 'ignore' });
  const observed = observeChild(child);
  await stopChild(child, observed);
  assert.equal(observed.state.error.code, 'ENOENT');
  assert.equal(observed.state.closed, true);
});

test('close deadline after KILL rejects instead of leaving an unsettled await', { timeout: 1000 }, async () => {
  const signals = [];
  const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null, kill: (signal) => signals.push(signal) });
  const observed = observeChild(child);
  const started = performance.now();
  await assert.rejects(stopChild(child, observed, 15, 15), /POSTGREST_CLEANUP_TIMEOUT/);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.ok(performance.now() - started < 500);
  child.emit('close', null, 'SIGKILL');
  await stopChild(child, observed);
});

test('primary failure survives shutdown and directory failures; removal always runs', async () => {
  const primary = new Error('assertion failed'), shutdown = new Error('signal failed'), removal = new Error('remove failed');
  const child = { pid: 123, exitCode: null, signalCode: null, kill() { throw shutdown; } };
  const observed = { state: { closed: false }, done: new Promise(() => {}) };
  let removed = false;
  await assert.rejects(cleanupFixture(child, observed, () => { removed = true; throw removal; }, primary), (error) => {
    assert.deepEqual(error.errors, [primary, shutdown, removal]); return true;
  });
  assert.equal(removed, true);
  await assert.rejects(cleanupFixture(undefined, undefined, () => {}, primary), (error) => error === primary);
  await assert.rejects(cleanupFixture(undefined, undefined, () => { throw removal; }), (error) => error === removal);
  await cleanupFixture(undefined, undefined, () => {});
});

test('successful close clears a long grace timer, allowing process exit', { timeout: 5000 }, () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { EventEmitter } from 'node:events';
    import { observeChild, stopChild } from ${JSON.stringify(moduleUrl)};
    const child = Object.assign(new EventEmitter(), {pid: 1, exitCode: null, signalCode: null,
      kill() { setImmediate(() => child.emit('close', null, 'SIGTERM')); }});
    await stopChild(child, observeChild(child), 60000, 60000);
  `], { encoding: 'utf8', timeout: 3000 });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
});

test('old signal cleanup reproduces Node exit 13, corrected lifecycle exits cleanly', posix, () => {
  const childSource = 'setInterval(() => {}, 1000); console.log("ready");';
  const setup = `import { spawn } from 'node:child_process'; import { once } from 'node:events';
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}]);`;
  const old = spawnSync(process.execPath, ['--input-type=module', '-e', `${setup}
    await once(child.stdout, 'data');
    const firstExit = once(child, 'exit'); child.kill('SIGTERM'); await firstExit;
    if (child.exitCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
  `], { encoding: 'utf8', timeout: 5000 });
  assert.equal(old.error, undefined);
  assert.equal(old.status, 13, old.stderr);
  const fixed = spawnSync(process.execPath, ['--input-type=module', '-e', `${setup}
    const { observeChild, stopChild } = await import(${JSON.stringify(moduleUrl)});
    const observed = observeChild(child); await once(child.stdout, 'data');
    await stopChild(child, observed); await stopChild(child, observed);
  `], { encoding: 'utf8', timeout: 5000 });
  assert.equal(fixed.error, undefined);
  assert.equal(fixed.status, 0, fixed.stderr);
});

test('integrated HTTP fixture observes immediately and reports only after cleanup', () => {
  const source = readFileSync(new URL('./http.mjs', import.meta.url), 'utf8');
  assert.match(source, /stdio: \['ignore', 'pipe', 'pipe'\] \}\);\s+observed = observeChild\(server\);/);
  assert.match(source, /assert.equal\(server.signalCode, null, logs\)/);
  assert.match(source, /primaryError = error/);
  assert.ok(source.indexOf('await cleanupFixture(') < source.indexOf('console.log(JSON.stringify(result))'));
  assert.doesNotMatch(source, /server\.once\('exit'/);
});
