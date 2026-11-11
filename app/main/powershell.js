'use strict';

// 运行 PowerShell 脚本（用 -EncodedCommand 传入，不受脚本执行策略限制，也不用担心引号转义）
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

function run(script, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let ps;
    try {
      ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
    } catch (e) {
      resolve({ stdout: '', stderr: '', error: e.message });
      return;
    }
    const timer = setTimeout(() => { try { ps.kill(); } catch (_) {} }, timeoutMs || 60000);
    ps.stdout.setEncoding('utf8');
    ps.stderr.setEncoding('utf8');
    ps.stdout.on('data', (d) => { stdout += d; });
    ps.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d; });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, error: error || null });
    };
    ps.on('error', (e) => finish(e.message));
    ps.on('close', () => finish(null));
  });
}

// 脚本最后输出一行 '@@JSON@@' + JSON，前面可能夹杂别的输出
function parseJsonTail(stdout) {
  const i = stdout.indexOf('@@JSON@@');
  if (i < 0) return undefined;
  try { return JSON.parse(stdout.slice(i + 8).trim()); } catch (_) { return undefined; }
}

// PowerShell 单引号字符串
function quote(v) { return "'" + String(v || '').replace(/'/g, "''") + "'"; }

function readScript(name) {
  return fs.readFileSync(path.join(config.SCRIPTS_DIR, name), 'utf8');
}

// scan.ps1 里那段取图标的 C# 代码（导出高清图标时复用）
function iconGrabSource() {
  const m = readScript('scan.ps1').match(/\$code = @'\r?\n([\s\S]*?)\r?\n'@/);
  return m ? m[1] : '';
}

module.exports = { run, parseJsonTail, quote, readScript, iconGrabSource };
