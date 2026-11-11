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

// 程序文件被更新时自动重启（改界面不用手动退出再打开）
function watchForUpdates() {
  let t = null;
  try {
    fs.watch(config.APP_ROOT, { recursive: true }, () => {
      clearTimeout(t);
      t = setTimeout(relaunch, 2000);
    });
  } catch (_) {}
}

module.exports = { detect, watchForUpdates };
