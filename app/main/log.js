'use strict';

// 日志：写到 %APPDATA%\NexusLauncher\app.log（超过 1MB 自动轮换）
const fs = require('fs');
const path = require('path');
const ctx = require('./context');

const MAX_LOG = 1024 * 1024;

function log(line) {
  if (!ctx.paths.userDir) return;
  const f = path.join(ctx.paths.userDir, 'app.log');
  try {
    try { if (fs.statSync(f).size > MAX_LOG) fs.renameSync(f, f + '.1'); } catch (_) {}
    fs.appendFileSync(f, new Date().toISOString() + ' ' + line + '\r\n');
  } catch (_) {}
}

// 开发模式下，把最近的日志同时写成一串文件名：
// 远程排查时有时只能列出目录、读不了文件内容，看文件名就够了
function mirrorAsFileNames(dirName, lines) {
  try {
    const dir = path.join(ctx.paths.userDir, dirName);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    lines.forEach((ln, i) => {
      const name = String(i).padStart(2, '0') + ' ' + ln.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180) + '.txt';
      fs.writeFileSync(path.join(dir, name), ln);
    });
  } catch (_) {}
}

const recent = [];
// 界面报错、导出结果之类值得排查的事件
function diag(line) {
  log(line);
  if (!ctx.dev) return;
  recent.push(new Date().toTimeString().slice(0, 8) + ' ' + line);
  if (recent.length > 20) recent.shift();
  mirrorAsFileNames('diag-ui', recent);
}

// 扫描脚本自己写的 scan.log（开发模式下同样镜像成文件名）
function scanDiag() {
  if (!ctx.dev) return;
  try {
    const text = fs.readFileSync(path.join(ctx.paths.userDir, 'scan.log'), 'utf8').replace(/^﻿/, '');
    mirrorAsFileNames('diag', text.split(/\r?\n/).filter(Boolean).slice(0, 30));
  } catch (_) {}
}

module.exports = { log, diag, scanDiag };
