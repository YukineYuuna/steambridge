'use strict';

const { spawn } = require('node:child_process');

const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

function terminateProcessTree(child) {
  if (!child || child.killed) return;
  if (process.platform !== 'win32' && child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* process may have exited already */ }
  }
  try { child.kill('SIGTERM'); } catch { /* process may have exited already */ }
  const forceStop = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform !== 'win32' && child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* process may have exited already */ }
    }
    try { child.kill('SIGKILL'); } catch { /* process may have exited already */ }
  };
  const timer = setTimeout(forceStop, 500);
  timer.unref?.();
}

function createSafetyMonitor(child, guard, { interval = 100, onViolation = () => {} } = {}) {
  let timer;
  let stopped = false;
  let tripped = false;
  const check = () => {
    if (stopped || tripped || typeof guard !== 'function') return;
    try {
      guard();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      tripped = true;
      if (timer) clearInterval(timer);
      terminateProcessTree(child);
      onViolation(failure);
    }
  };
  return {
    start() {
      if (typeof guard !== 'function') return;
      check();
      if (!tripped) {
        timer = setInterval(check, Math.max(50, Number(interval) || 100));
        timer.unref?.();
      }
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}

function appendLimited(value, chunk) {
  const text = String(chunk);
  const currentBytes = Buffer.byteLength(value, 'utf8');
  if (currentBytes >= MAX_CAPTURE_BYTES) return { value, truncated: true };
  const remaining = MAX_CAPTURE_BYTES - currentBytes;
  const chunkBytes = Buffer.from(text, 'utf8');
  if (chunkBytes.length <= remaining) return { value: value + text, truncated: false };
  return {
    value: value + chunkBytes.subarray(0, remaining).toString('utf8'),
    truncated: true,
  };
}

function runDetachedCommand(command, args = [], options = {}) {
  const {
    cwd,
    env,
    onLine = () => {},
    startupProbe = 2_500,
    inheritEnv = true,
    guard,
    guardInterval = 100,
    onSafetyFailure = () => {},
  } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: inheritEnv ? (env ? { ...process.env, ...env } : process.env) : { ...env },
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timer;
    let stdoutPending = '';
    let stderrPending = '';
    let safetyMonitor;

    const flushLines = (type, chunk) => {
      let pending = type === 'stdout' ? stdoutPending : stderrPending;
      pending = appendLimited(pending, chunk).value;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      if (type === 'stdout') stdoutPending = pending;
      else stderrPending = pending;
      for (const line of lines) if (line.trim()) onLine(type, line);
    };
    const capture = (stream, type) => {
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk) => {
        if (type === 'stdout') {
          const result = appendLimited(stdout, chunk);
          stdout = result.value;
          stdoutTruncated ||= result.truncated;
        } else {
          const result = appendLimited(stderr, chunk);
          stderr = result.value;
          stderrTruncated ||= result.truncated;
        }
        flushLines(type, chunk);
      });
    };
    capture(child.stdout, 'stdout');
    capture(child.stderr, 'stderr');

    const result = () => ({
      code: 0,
      signal: null,
      stdout,
      stderr,
      stdoutTruncated,
      stderrTruncated,
      pid: child.pid,
    });
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      callback();
    };

    child.once('error', (error) => {
      safetyMonitor?.stop();
      finish(() => reject(error));
    });
    child.once('spawn', () => {
      safetyMonitor = createSafetyMonitor(child, guard, {
        interval: guardInterval,
        onViolation: (cause) => {
          cause.code = 'STEAMBRIDGE_SAFETY_STOP';
          cause.result = result();
          if (settled) onSafetyFailure(cause);
          else finish(() => reject(cause));
        },
      });
      safetyMonitor.start();
      if (settled) return;
      timer = setTimeout(() => finish(() => resolve(result())), Math.max(0, Number(startupProbe) || 0));
    });
    child.once('close', (code, signal) => {
      safetyMonitor?.stop();
      if (settled) return;
      const closeResult = { ...result(), code: code ?? -1, signal };
      if (code === 0) finish(() => resolve(closeResult));
      else {
        const error = new Error(stderr.trim() || `${command} exited with code ${code}`);
        error.result = closeResult;
        finish(() => reject(error));
      }
    });
  });
}

function runCommand(command, args = [], options = {}) {
  const {
    cwd,
    env,
    onLine = () => {},
    detached = false,
    wait = true,
    timeout = 0,
    inheritEnv = true,
    guard,
    guardInterval = 100,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: inheritEnv ? (env ? { ...process.env, ...env } : process.env) : { ...env },
      shell: false,
      windowsHide: true,
      detached,
      stdio: detached ? 'ignore' : ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let timer;
    let safetyMonitor;
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const result = () => ({
      code: 0,
      signal: null,
      stdout,
      stderr,
      stdoutTruncated,
      stderrTruncated,
      pid: child.pid,
    });
    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      safetyMonitor?.stop();
      reject(error);
    };

    child.once('error', fail);
    if (detached && !wait) {
      child.once('spawn', () => {
        if (settled) return;
        child.unref();
        settled = true;
        resolve({ code: 0, pid: child.pid });
      });
      return;
    }

    if (timeout > 0) {
      timer = setTimeout(() => {
        terminateProcessTree(child);
        fail(new Error(`${command} timed out after ${timeout} ms`));
      }, timeout);
    }

    const attach = (stream, type) => {
      let pending = '';
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk) => {
        if (type === 'stdout') {
          const result = appendLimited(stdout, chunk);
          stdout = result.value;
          stdoutTruncated ||= result.truncated;
        } else {
          const result = appendLimited(stderr, chunk);
          stderr = result.value;
          stderrTruncated ||= result.truncated;
        }
        pending = appendLimited(pending, chunk).value;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) onLine(type, line);
      });
      stream?.on('end', () => {
        if (pending.trim()) onLine(type, pending);
      });
    };
    attach(child.stdout, 'stdout');
    attach(child.stderr, 'stderr');

    child.once('spawn', () => {
      safetyMonitor = createSafetyMonitor(child, guard, {
        interval: guardInterval,
        onViolation: (cause) => {
          cause.code = 'STEAMBRIDGE_SAFETY_STOP';
          cause.result = result();
          fail(cause);
        },
      });
      safetyMonitor.start();
    });

    child.once('close', (code, signal) => {
      safetyMonitor?.stop();
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const closeResult = {
        code: code ?? -1,
        signal,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        pid: child.pid,
      };
      if (code === 0) resolve(closeResult);
      else {
        const error = new Error(stderr.trim() || `${command} exited with code ${code}`);
        error.result = closeResult;
        reject(error);
      }
    });
  });
}

module.exports = { MAX_CAPTURE_BYTES, runCommand, runDetachedCommand };
