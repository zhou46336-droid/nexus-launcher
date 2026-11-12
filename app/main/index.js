'use strict';

/* 更多应用（NexusLauncher）—— 主进程入口
   按 Alt+Q（或点托盘 / 停靠栏图标）在屏幕下方弹出一个应用启动台。

   模块：
     config.js       固定配置和默认设置
     context.js      各模块共享的运行时状态
     store.js        用户数据的读写，以及发给界面的数据
     scanner.js      扫描已安装应用、自动添加新装的应用
     icons.js        图标兜底、统一大小、生成 ICO
     export-icon.js  导出高清图标（给 Nexus 用）
     window.js       启动台窗口
     actions.js      打开应用、添加文件 / 网址
     system.js       托盘、快捷键、开机自启、快捷方式
     ipc.js          界面可以调用的接口
     dev.js          开发模式 */
const { app, Menu, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const ctx = require('./context');
const config = require('./config');
const store = require('./store');
const scanner = require('./scanner');
const panel = require('./window');
const system = require('./system');
const ipc = require('./ipc');
const dev = require('./dev');
const actions = require('./actions');
const { handleExportRequests } = require('./export-icon');
const { log, diag } = require('./log');

app.setName(config.APP_NAME);
app.setAppUserModelId(config.AUMID);

const startHidden = process.argv.includes('--hidden');

/* 把桌面上的图标拖到「更多应用」的图标上（桌面快捷方式、Nexus 停靠栏、开始菜单都行），
   Windows 会带着这些文件的路径启动本程序；这里把它们加进启动台。 */
function droppedFiles(argv) {
  const self = String(process.execPath).toLowerCase();
  const root = String(config.APP_ROOT).toLowerCase();
  return argv.slice(1).filter((a) => {
    if (!a || a.startsWith('-') || !path.isAbsolute(a)) return false;
    const low = a.toLowerCase();
    if (low === self || low.startsWith(root)) return false;
    try { return fs.existsSync(a); } catch (_) { return false; }
  });
}

function listNames(names) {
  return names.slice(0, 3).map((n) => '「' + n + '」').join('、') + (names.length > 3 ? ' 等 ' + names.length + ' 个' : '');
}

async function addDroppedOnIcon(files) {
  const r = await actions.addDropped(files);
  let text;
  if (r.added.length) text = '已添加 ' + listNames(r.added);
  else if (r.exists.length) text = listNames(r.exists) + ' 已经在启动台里了';
  else text = '没有添加：没认出这个文件';
  log('dropped on icon: ' + files.length + ' file(s), added ' + r.added.length);
  panel.notify(text, r.added.length > 0);
}

function init() {
  Menu.setApplicationMenu(null);
  store.initPaths();
  ctx.dev = dev.detect();
  store.loadState();
  log('start v' + app.getVersion() + (ctx.dev ? ' (dev)' : ''));
  ipc.register();
  panel.createWindow();
  system.createTray();
  system.registerHotkey();
  system.applyAutostart();
  system.ensureShortcuts();
  scanner.watchStartMenu();
  if (ctx.dev) {
    dev.watchForUpdates();
    diag('start v' + app.getVersion());
    setTimeout(() => { handleExportRequests().catch((e) => diag('export req: ' + e.message)); }, 3000);
  }
  const files = droppedFiles(process.argv);
  if (files.length) ctx.win.webContents.once('did-finish-load', () => addDroppedOnIcon(files));
  else if (!startHidden) ctx.win.webContents.once('did-finish-load', () => panel.showPanel());
  scanner.runScan();
}

if (process.argv.includes('--uninstall-cleanup')) {
  // 卸载程序调用：取消开机自启、删掉桌面和开始菜单里的快捷方式，然后退出
  app.whenReady().then(() => {
    system.uninstallCleanup();
    app.exit(0);
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 再次运行 exe（例如点击 Nexus 停靠栏图标）时切换面板
  app.on('second-instance', (_e, argv) => {
    if (!ctx.win || argv.includes('--hidden')) return;
    const files = droppedFiles(argv);
    if (files.length) { addDroppedOnIcon(files); return; }
    if (ctx.win.isVisible()) panel.hidePanel();
    else if (Date.now() - ctx.lastBlurHide > 500) panel.showPanel();
  });
  app.whenReady().then(init);
  app.on('window-all-closed', (e) => { if (!ctx.quitting) e.preventDefault(); });
  app.on('before-quit', () => { ctx.quitting = true; store.writeState(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
