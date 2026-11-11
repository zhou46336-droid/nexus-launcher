'use strict';

// 界面（渲染进程）能调用的接口。界面只传应用的 key，具体打开什么由这里决定。
const { app, ipcMain, dialog, shell } = require('electron');
const ctx = require('./context');
const config = require('./config');
const store = require('./store');
const scanner = require('./scanner');
const actions = require('./actions');
const panel = require('./window');
const system = require('./system');
const { exportHdIcon } = require('./export-icon');
const { diag } = require('./log');

const str = (v) => String(v == null ? '' : v);

// 「外观」面板里的设置：校验后实时生效
function setSetting(key, value) {
  const s = ctx.state.settings;
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  switch (key) {
    case 'blur': s.blur = Math.round(num(value, 0, 40)); break;
    case 'panelAlpha': s.panelAlpha = Math.round(num(value, 0.1, 0.95) * 100) / 100; break;
    case 'panelWidth': s.panelWidth = config.PANEL_WIDTHS.includes(Number(value)) ? Number(value) : 800; break;
    case 'bottomOffset': s.bottomOffset = Math.round(num(value, 0, 600)); break;
    case 'accent': if (/^#[0-9a-f]{6}$/i.test(str(value))) s.accent = str(value); break;
    case 'glass': s.glass = !!value; break;
    case 'glassStrength': s.glassStrength = Math.round(num(value, 0, 60)); break;
    case 'reset': Object.assign(s, config.DEFAULT_LOOK); break;
    default: return;
  }
  store.saveState();
  system.refreshTray();
  if (key === 'panelWidth' || key === 'bottomOffset' || key === 'reset') panel.reposition();
}

function register() {
  const st = () => ctx.state;

  ipcMain.handle('data:get', () => store.buildData());
  ipcMain.handle('catalog:get', () => store.catalogView(true));

  ipcMain.handle('app:launch', (_e, key) => { actions.launch(str(key)); });

  ipcMain.handle('app:remove', (_e, key) => {
    const i = st().order.indexOf(key);
    if (i >= 0) { st().order.splice(i, 1); store.saveState(); }
    return i;
  });

  // 撤销移除：放回原来的位置
  ipcMain.handle('app:restore', (_e, key, index) => {
    if (typeof key === 'string' && !st().order.includes(key) && (ctx.catalogMap.has(key) || st().custom[key])) {
      const i = Math.min(Math.max(Number(index) || 0, 0), st().order.length);
      st().order.splice(i, 0, key);
      store.saveState();
    }
    return store.buildData();
  });

  // 拖动排序：把 src 挪到 dst 的位置；dst 为 '__end__' 时挪到最后
  ipcMain.handle('app:move', (_e, src, dst) => {
    const order = st().order;
    const from = order.indexOf(src);
    if (from >= 0 && src !== dst) {
      order.splice(from, 1);
      const to = dst === '__end__' ? -1 : order.indexOf(dst);
      if (to < 0) order.push(src);
      else order.splice(to + (from <= to ? 1 : 0), 0, src);
      store.saveState();
    }
    return store.buildData();
  });

  ipcMain.handle('app:add', (_e, keys) => {
    if (Array.isArray(keys)) {
      for (const k of keys) if (ctx.catalogMap.has(k) && !st().order.includes(k)) st().order.push(k);
      store.saveState();
    }
    return store.buildData();
  });

  ipcMain.handle('app:addPaths', async (_e, paths) => {
    let n = 0;
    if (Array.isArray(paths)) for (const p of paths) if (await actions.addPath(p)) n++;
    return { added: n, data: store.buildData() };
  });

  ipcMain.handle('app:addUrl', (_e, url, name) => {
    const ok = actions.addUrl(url, name);
    return { added: ok ? 1 : 0, data: store.buildData() };
  });

  const pick = async (properties, filters) => {
    ctx.suppressBlur = true;
    let n = 0;
    try {
      const r = await dialog.showOpenDialog(ctx.win, { properties, filters });
      if (!r.canceled) for (const p of r.filePaths) if (await actions.addPath(p)) n++;
    } finally {
      ctx.suppressBlur = false;
      if (ctx.win && ctx.win.isVisible()) ctx.win.focus();
    }
    return { added: n, data: store.buildData() };
  };
  ipcMain.handle('app:pickFiles', () => pick(['openFile', 'multiSelections'], [
    { name: '程序或快捷方式', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] },
    { name: '所有文件', extensions: ['*'] }
  ]));
  ipcMain.handle('app:pickFolder', () => pick(['openDirectory'], []));

  ipcMain.handle('app:togglePin', (_e, key) => {
    const pinned = st().pinned;
    const i = pinned.indexOf(key);
    if (i >= 0) pinned.splice(i, 1);
    else if (st().order.includes(key)) pinned.unshift(key);
    store.saveState();
    return store.buildData();
  });

  ipcMain.handle('app:runAsAdmin', (_e, key) => { actions.runAsAdmin(str(key)); });
  ipcMain.handle('app:openLocation', (_e, key) => { actions.openLocation(str(key)); });

  ipcMain.handle('app:exportIcon', async (_e, key) => {
    const r = await exportHdIcon(str(key));
    if (r.ok) { panel.hidePanel(); shell.showItemInFolder(r.png); }
    return r;
  });

  ipcMain.handle('app:uninstall', () => {
    panel.hidePanel();
    shell.openExternal('ms-settings:appsfeatures');
  });

  ipcMain.handle('app:rescan', async () => {
    const added = await scanner.rescanAndReport();
    return { added, data: store.buildData() };
  });

  ipcMain.handle('settings:set', (_e, key, value) => {
    setSetting(str(key), value);
    return store.buildData();
  });

  ipcMain.on('panel:hide', () => panel.hidePanel());
  ipcMain.on('ui:log', (_e, msg) => diag(str(msg).slice(0, 300)));
  app.on('child-process-gone', (_e, d) => diag('child gone: ' + (d && d.type) + ' ' + (d && d.reason)));
}

module.exports = { register, setSetting };
