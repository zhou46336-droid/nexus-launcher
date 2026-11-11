'use strict';

// 启动台窗口：透明无边框、始终置顶，显示在停靠栏上方居中
const { BrowserWindow, screen, desktopCapturer } = require('electron');
const os = require('os');
const ctx = require('./context');
const config = require('./config');
const store = require('./store');
const scanner = require('./scanner');
const { diag } = require('./log');

let currentDisplay = null;
let openSeq = 0;           // 每次打开面板的编号：晚到的截图只认最近一次打开

// Windows 10 2004（内部版本 19041）起可以把窗口排除在截图之外，
// 这样面板可以先显示出来，再同时去截它后面的画面
const CAN_EXCLUDE_FROM_CAPTURE = process.platform === 'win32' && Number(String(os.release()).split('.')[2] || 0) >= 19041;
// 截图最多等这么久；偶尔系统截图接口卡住时，不能让面板跟着打不开
const CAPTURE_TIMEOUT_MS = 1500;

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

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); })
  ]);
}

/* 打开面板：
   1. 立刻显示窗口，界面先保持透明（等背景截图，最多等一小会儿），按快捷键马上有反应；
   2. 同时截取面板后方的画面，到了就交给界面做模糊和液态玻璃；
   3. 截图慢或失败时，界面先用不透明一点的底色显示，不会卡在“打不开”。 */
async function showPanel() {
  const win = ctx.win;
  if (!win) return;
  const seq = ++openSeq;
  const t0 = Date.now();
  const { display, panelRect } = positionWindow();
  const data = store.buildData();
  const st = ctx.state;
  if (st.notice.length) { data.notice = st.notice.slice(); st.notice = []; store.saveState(); }
  win.webContents.send('panel:open', data, panelRect, {
    maxWait: CAN_EXCLUDE_FROM_CAPTURE ? 300 : CAPTURE_TIMEOUT_MS,
    lateBgOk: CAN_EXCLUDE_FROM_CAPTURE
  });
  if (CAN_EXCLUDE_FROM_CAPTURE) { try { win.setContentProtection(true); } catch (_) {} }
  win.show();
  win.moveTop();
  win.focus();

  const bg = await withTimeout(captureBehind(display), CAPTURE_TIMEOUT_MS);
  if (CAN_EXCLUDE_FROM_CAPTURE && seq === openSeq) { try { win.setContentProtection(false); } catch (_) {} }
  if (ctx.dev) diag('open capture=' + (Date.now() - t0) + 'ms bg=' + (bg ? bg.width + 'x' + bg.height : 'none') + ' scale=' + display.scaleFactor);
  if (seq === openSeq && win.isVisible()) win.webContents.send('panel:bg', bg, panelRect);
  if (Date.now() - ctx.lastScan > config.RESCAN_ON_OPEN_MS) scanner.runScan();
}

function hidePanel() {
  if (!ctx.win || !ctx.win.isVisible()) return;
  ctx.win.hide();
}

function toggle() {
  if (!ctx.win) return;
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
