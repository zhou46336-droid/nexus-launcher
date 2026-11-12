'use strict';

/* 开发模式（满足任一条件就开启）：
   - 启动参数带 --dev
   - %APPDATA%\NexusLauncher 里有一个名为 dev.flag 的文件
   开启后：程序文件有改动会自动重启；排查日志同时写成文件名；处理 export-request.txt。
   正式使用时不需要开。 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const ctx = require('./context');
const config = require('./config');
const store = require('./store');

function detect() {
  return process.argv.includes('--dev') || fs.existsSync(path.join(ctx.paths.userDir, 'dev.flag'));
}

function relaunch() {
  ctx.quitting = true;
  store.writeState();
  app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden').concat('--hidden') });
  app.exit(0);
}

// 记下每个程序文件的修改时间和大小
function snapshot(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) snapshot(full, base, out);
    else {
      try { const st = fs.statSync(full); out.set(path.relative(base, full), st.mtimeMs + ':' + st.size); } catch (_) {}
    }
  }
  return out;
}

// 程序文件被更新时自动重启（改界面不用手动退出再打开）。
// Windows 读取文件也会触发「变化」通知（访问时间变了），所以要比对修改时间和大小，确实改了才重启。
function watchForUpdates() {
  let snap;
  try { snap = snapshot(config.APP_ROOT, config.APP_ROOT, new Map()); } catch (_) { return; }
  let t = null;
  try {
    fs.watch(config.APP_ROOT, { recursive: true }, (_ev, filename) => {
      if (!filename) return;
      const rel = String(filename);
      let sig = null;
      try {
        const st = fs.statSync(path.join(config.APP_ROOT, rel));
        if (st.isDirectory()) return;
        sig = st.mtimeMs + ':' + st.size;
      } catch (_) { sig = null; }
      if (snap.get(rel) === sig) return;
      snap.set(rel, sig);
      clearTimeout(t);
      t = setTimeout(relaunch, 2000);
    });
  } catch (_) {}
}

module.exports = { detect, watchForUpdates };
