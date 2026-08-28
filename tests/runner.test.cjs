'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runCommand, runDetachedCommand } = require('../electron/lib/runner.cjs');

test('runCommand captures output and complete lines', async () => {
  const lines = [];
  const result = await runCommand(process.execPath, ['-e', 'console.log("ready")'], {
    onLine: (stream, line) => lines.push([stream, line]),
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /ready/);
  assert.deepEqual(lines, [['stdout', 'ready']]);
});

test('runCommand rejects non-zero exits', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.stderr.write("failed"); process.exit(2)']), /failed/);
});

test('detached run rejects when the executable cannot spawn', async () => {
  await assert.rejects(runCommand('steambridge-missing-executable', [], { detached: true, wait: false }), /ENOENT/);
});

test('runCommand caps captured output', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(5 * 1024 * 1024))']);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.length <= 4 * 1024 * 1024, true);
  assert.equal(result.stdoutTruncated, true);
});

test('runDetachedCommand reports an early non-zero exit', async () => {
  await assert.rejects(
    runDetachedCommand(process.execPath, ['-e', 'process.stderr.write("missing vcruntime140.dll"); process.exit(3)'], { startupProbe: 100 }),
    /missing vcruntime140\.dll/,
  );
});

test('runDetachedCommand releases a long-running process after the startup probe', async () => {
  const result = await runDetachedCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { startupProbe: 50 });
  assert.equal(result.code, 0);
  assert.ok(result.pid > 0);
  process.kill(result.pid);
});

test('runCommand terminates a process when the safety guard trips', async () => {
  let checks = 0;
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      guard: () => { checks += 1; if (checks > 1) throw new Error('unsafe Bottle'); },
      guardInterval: 50,
    }),
    (error) => error.code === 'STEAMBRIDGE_SAFETY_STOP' && /unsafe Bottle/.test(error.message),
  );
  assert.ok(checks > 1);
});

test('runDetachedCommand reports a safety stop after releasing the process', async () => {
  let checks = 0;
  let safetyStop;
  const reported = new Promise((resolve) => { safetyStop = resolve; });
  const result = await runDetachedCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
    startupProbe: 20,
    guard: () => { checks += 1; if (checks > 1) throw new Error('runtime changed'); },
    guardInterval: 50,
    onSafetyFailure: safetyStop,
  });
  assert.ok(result.pid > 0);
  const error = await Promise.race([reported, new Promise((_, reject) => setTimeout(() => reject(new Error('guard timeout')), 1000))]);
  assert.equal(error.code, 'STEAMBRIDGE_SAFETY_STOP');
  assert.match(error.message, /runtime changed/);
});
