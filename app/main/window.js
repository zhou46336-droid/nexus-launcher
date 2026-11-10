'use strict';

// 启动台窗口：透明无边框、始终置顶，显示在停靠栏上方居中
const { BrowserWindow, screen, desktopCapturer } = require('electron');
const ctx = require('./context');
const config = require('./config');
const store = require('./store');
const scanner = require('./scanner');
const { diag } = require('./log');

let currentDisplay = null;
let opening = false;

function createWindow() {
  const win = new BrowserWindow({
    width: store.panelWidth() + config.PAD * 2,
    height: config.WIN_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: '更多应用',
    webPreferences: {
      preload: config.PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  ctx.win = win;
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.loadFile(config.RENDERER_HTML);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 界面报错 / 渲染进程崩溃都记到日志里
  win.webContents.on('console-message', (e, level, message, line) => {
    const lv = e && e.level !== undefined ? e.level : level;
    const msg = e && e.message !== undefined ? e.message : message;
    if (lv === 'error' || lv === 3) diag('console: ' + msg + ' @' + String((e && e.lineNumber) || line || ''));
  });
  win.webContents.on('render-process-gone', (_e, d) => diag('render gone: ' + (d && d.reason)));
  win.webContents.on('unresponsive', () => diag('unresponsive'));
  win.webContents.on('did-fail-load', (_e, code, desc) => diag('load failed: ' + code + ' ' + desc));
  win.on('blur', () => {
    if (ctx.suppressBlur || !win.isVisible()) return;
    ctx.lastBlurHide = Date.now();
    hidePanel();
  });
  win.on('close', (e) => {
    if (!ctx.quitting) { e.preventDefault(); hidePanel(); }
  });
  return win;
}

// 放到鼠标所在屏幕的底部居中，离底部 bottomOffset 像素
function positionWindow(keepDisplay) {
  const display = (keepDisplay && currentDisplay) || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  currentDisplay = display;
  const wa = display.workArea;
  const pw = store.panelWidth();
  const winW = pw + config.PAD * 2;
  const x = Math.round(wa.x + (wa.width - winW) / 2);
  const y = Math.max(wa.y, Math.round(wa.y + wa.height - ctx.state.settings.bottomOffset - config.PANEL_H - config.TOP_SPACE));
  ctx.win.setBounds({ x, y, width: winW, height: config.WIN_H });
  const panelRect = { x: x + config.PAD, y: y + config.TOP_SPACE, width: pw, height: config.PANEL_H };
  return { display, panelRect };
}

// 打开前截取面板后方的画面（壁纸或窗口），交给界面做模糊和液态玻璃背景
async function captureBehind(display) {
  try {
    const db = display.bounds;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(db.width * 0.5), height: Math.round(db.height * 0.5) },
      fetchWindowIcons: false
    });
    const src = sources.find((s) => s.display_id && String(s.display_id) === String(display.id)) || sources[0];
    if (!src) return null;
    const img = src.thumbnail;
    const size = img.getSize();
    if (!size.width || !size.height) return null;
    return {
      url: 'data:image/jpeg;base64,' + img.toJPEG(80).toString('base64'),
      x: db.x, y: db.y, width: db.width, height: db.height
    };
  } catch (e) {
    diag('capture failed: ' + (e && e.message));
    return null;
  }
}

async function showPanel() {
  const win = ctx.win;
  if (!win || opening) return;
  opening = true;
  try {
    const { display, panelRect } = positionWindow();
    const bg = await captureBehind(display);
    const data = store.buildData();
    const st = ctx.state;
    if (st.notice.length) { data.notice = st.notice.slice(); st.notice = []; store.saveState(); }
    if (ctx.dev) diag('open bg=' + (bg ? bg.width + 'x' + bg.height : 'none') + ' panel=' + panelRect.width + 'x' + panelRect.height + ' scale=' + display.scaleFactor);
    win.webContents.send('panel:open', data, bg, panelRect);
    win.show();
    win.moveTop();
    win.focus();
  } finally {
    opening = false;
  }
  if (Date.now() - ctx.lastScan > config.RESCAN_ON_OPEN_MS) scanner.runScan();
}

function hidePanel() {
  if (!ctx.win || !ctx.win.isVisible()) return;
  ctx.win.hide();
}

function toggle() {
  if (!ctx.win || opening) return;
  if (ctx.win.isVisible()) hidePanel();
  else showPanel();
}

// 外观设置改了宽度 / 高度时，就地挪动窗口
function reposition() {
  if (!ctx.win || !ctx.win.isVisible()) return;
  const { panelRect } = positionWindow(true);
  ctx.win.webContents.send('panel:moved', panelRect);
}

module.exports = { createWindow, showPanel, hidePanel, toggle, reposition };
