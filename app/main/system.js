'use strict';

// 和系统打交道的部分：托盘图标、全局快捷键、开机自启、桌面 / 开始菜单快捷方式
const { app, Tray, Menu, globalShortcut, nativeImage, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const ctx = require('./context');
const config = require('./config');
const store = require('./store');
const scanner = require('./scanner');
const panel = require('./window');
const { log } = require('./log');

function applyAutostart() {
  try {
    app.setLoginItemSettings({ openAtLogin: !!ctx.state.settings.autostart, path: process.execPath, args: ['--hidden'] });
  } catch (_) {}
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  try {
    if (!globalShortcut.register(ctx.state.settings.hotkey, panel.toggle)) log('hotkey taken: ' + ctx.state.settings.hotkey);
  } catch (e) { log('hotkey failed: ' + e.message); }
}

function trayMenu() {
  const s = ctx.state.settings;
  const offsets = [100, 140, 180, 220, 260, 320];
  const alphas = [['浅（更通透）', 0.45], ['中', 0.6], ['深（字更清楚）', 0.75]];
  const setting = (key, value) => () => { s[key] = value; store.saveState(); store.pushData(); refreshTray(); };
  return Menu.buildFromTemplate([
    { label: '打开启动台（' + s.hotkey + '）', click: panel.showPanel },
    { label: '重新扫描应用', click: scanner.runScan },
    { type: 'separator' },
    {
      label: '模糊程度',
      submenu: config.BLURS.map(([label, v]) => ({ label, type: 'radio', checked: s.blur === v, click: setting('blur', v) }))
    },
    {
      label: '面板宽度',
      submenu: config.WIDTHS.map(([label, v]) => ({
        label: label + '（' + v + '）', type: 'radio', checked: store.panelWidth() === v, click: setting('panelWidth', v)
      }))
    },
    {
      label: '面板离屏幕底部',
      submenu: offsets.map((o) => ({ label: o + ' 像素', type: 'radio', checked: s.bottomOffset === o, click: setting('bottomOffset', o) }))
    },
    {
      label: '面板深浅',
      submenu: alphas.map(([label, a]) => ({ label, type: 'radio', checked: s.panelAlpha === a, click: setting('panelAlpha', a) }))
    },
    {
      label: '自动添加新安装的应用', type: 'checkbox', checked: !!s.autoAdd,
      click: (mi) => { s.autoAdd = mi.checked; store.saveState(); }
    },
    {
      label: '开机自动启动', type: 'checkbox', checked: !!s.autostart,
      click: (mi) => { s.autostart = mi.checked; applyAutostart(); store.saveState(); }
    },
    { type: 'separator' },
    { label: '退出', click: () => { ctx.quitting = true; app.quit(); } }
  ]);
}

function refreshTray() {
  try { if (ctx.tray) ctx.tray.setContextMenu(trayMenu()); } catch (_) {}
}

function createTray() {
  ctx.tray = new Tray(nativeImage.createFromPath(config.TRAY_ICON));
  ctx.tray.setToolTip('更多应用（' + ctx.state.settings.hotkey + '）');
  ctx.tray.on('click', panel.toggle);
  ctx.tray.setContextMenu(trayMenu());
}

function shortcutPaths() {
  return [
    path.join(app.getPath('desktop'), config.SHORTCUT_NAME),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', config.SHORTCUT_NAME)
  ];
}

// 第一次运行时在桌面和开始菜单放「更多应用」快捷方式（可以拖到 Nexus 等停靠栏上）；
// 图标换新后把已有的快捷方式也更新一遍
function ensureShortcuts() {
  if (process.platform !== 'win32') return;
  const st = ctx.state;
  if (st.shortcutsCreated && (st.iconVersion || 1) >= config.ICON_VERSION) return;
  const opts = {
    target: process.execPath,
    icon: config.APP_ICON,
    iconIndex: 0,
    description: '更多应用启动台（' + st.settings.hotkey + '）',
    appUserModelId: config.AUMID
  };
  const upgrading = st.shortcutsCreated;
  for (const p of shortcutPaths()) {
    try { if (upgrading || !fs.existsSync(p)) shell.writeShortcutLink(p, 'create', opts); } catch (_) {}
  }
  st.shortcutsCreated = true;
  st.iconVersion = config.ICON_VERSION;
  store.saveState();
}

// 卸载时调用：取消开机自启、删掉快捷方式
function uninstallCleanup() {
  try { app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: ['--hidden'] }); } catch (_) {}
  for (const p of shortcutPaths()) { try { fs.unlinkSync(p); } catch (_) {} }
}

module.exports = { applyAutostart, registerHotkey, createTray, refreshTray, ensureShortcuts, uninstallCleanup };
