'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 4096;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactLogMessage(value, homeDirectory = os.homedir()) {
  let message = String(value).replace(/[\r\n]+$/g, '').slice(0, MAX_MESSAGE_LENGTH);
  if (homeDirectory) message = message.replace(new RegExp(escapeRegExp(homeDirectory), 'gi'), '~');
  message = message.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]');
  message = message.replace(/\b(password|passwd|token|secret|authorization|cookie|sessionid)\b(\s*[:=]\s*)[^\s;]+/gi, '$1$2[REDACTED]');
  return message;
}

function assertRegularLogFile(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('日志文件路径不安全。');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
}

class AppLogger {
  constructor(filePath, onEntry = () => {}) {
    this.filePath = filePath;
    this.onEntry = onEntry;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    assertRegularLogFile(filePath);
    if (!fs.existsSync(filePath)) {
      const handle = fs.openSync(filePath, 'wx', 0o600);
      fs.closeSync(handle);
    } else fs.chmodSync(filePath, 0o600);
  }

  rotateIfNeeded(nextBytes) {
    let size = 0;
    try { size = fs.statSync(this.filePath).size; } catch { return; }
    if (size + nextBytes <= MAX_LOG_BYTES) return;
    const previous = `${this.filePath}.1`;
    fs.rmSync(previous, { force: true });
    fs.renameSync(this.filePath, previous);
    fs.chmodSync(previous, 0o600);
    fs.writeFileSync(this.filePath, '', { mode: 0o600 });
  }

  write(level, scope, message) {
    assertRegularLogFile(this.filePath);
    const entry = {
      time: new Date().toISOString(),
      level,
      scope,
      message: redactLogMessage(message),
    };
    const line = `${JSON.stringify(entry)}\n`;
    this.rotateIfNeeded(Buffer.byteLength(line));
    fs.appendFileSync(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
    this.onEntry(entry);
    return entry;
  }

  info(scope, message) { return this.write('info', scope, message); }
  warn(scope, message) { return this.write('warn', scope, message); }
  error(scope, message) { return this.write('error', scope, message); }

  read(limit = 400) {
    try {
      return fs.readFileSync(this.filePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-Math.max(1, Math.min(Number(limit) || 400, 2000)))
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return [];
    }
  }

  clear() {
    assertRegularLogFile(this.filePath);
    fs.writeFileSync(this.filePath, '', { encoding: 'utf8', mode: 0o600 });
  }
}

module.exports = { AppLogger, MAX_LOG_BYTES, MAX_MESSAGE_LENGTH, redactLogMessage };
