'use strict';

// 用户数据：启动台里的应用顺序、使用记录、设置；以及发给界面的数据
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const ctx = require('./context');
const config = require('./config');

function initPaths() {
  const userDir = app.getPath('userData');
  fs.mkdirSync(userDir, { recursive: true });
  ctx.paths = {
    userDir,
    statePath: path.join(userDir, 'state.json'),
    catalogPath: path.join(userDir, 'catalog.json'),
    iconDir: path.join(userDir, 'icons3')
  };
  fs.mkdirSync(ctx.paths.iconDir, { recursive: true });
}

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function loadState() {
  const s = loadJSON(ctx.paths.statePath, {}) || {};
  ctx.state = {
    initialized: !!s.initialized,
    order: Array.isArray(s.order) ? s.order.filter((k) => typeof k === 'string') : [],
    custom: isObj(s.custom) ? s.custom : {},
    usage: isObj(s.usage) ? s.usage : {},
    pinned: Array.isArray(s.pinned) ? s.pinned.filter((k) => typeof k === 'string') : [],
    shortcutsCreated: !!s.shortcutsCreated,
    iconVersion: s.iconVersion || 1,
    known: Array.isArray(s.known) ? s.known : null,   // 扫描到过的应用，用来认出「新安装」的
    fresh: isObj(s.fresh) ? s.fresh : {},              // 自动加进来、还没打开过的
    notice: Array.isArray(s.notice) ? s.notice : [],
    settingsVersion: config.SETTINGS_VERSION,
    settings: Object.assign({}, config.DEFAULT_SETTINGS, isObj(s.settings) ? s.settings : {})
  };
  // 旧版本默认离底部 120，升级后默认改高到 180
  if ((s.settingsVersion || 1) < 2 && ctx.state.settings.bottomOffset === 120) ctx.state.settings.bottomOffset = 180;

  const cached = loadJSON(ctx.paths.catalogPath, null);
  if (Array.isArray(cached)) setCatalog(cached);
}

// 先写临时文件再改名：写到一半断电也不会把数据弄坏
let saveTimer = null;
function writeState() {
  clearTimeout(saveTimer);
  if (!ctx.state) return;
  try {
    fs.writeFileSync(ctx.paths.statePath + '.tmp', JSON.stringify(ctx.state, null, 1));
    fs.renameSync(ctx.paths.statePath + '.tmp', ctx.paths.statePath);
  } catch (e) { console.error('save failed', e); }
}
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeState, 200);
}

function setCatalog(list) {
  ctx.catalog = list;
  ctx.catalogMap = new Map(list.map((a) => [a.key, a]));
}

function panelWidth() { return Number(ctx.state.settings.panelWidth) || 800; }
function columns() { return panelWidth() < 780 ? 7 : 8; }

// 图标文件读成 data URL 后缓存起来，每次打开面板不用重新读盘
const iconCache = new Map();
function iconData(p) {
  if (!p) return null;
  if (iconCache.has(p)) return iconCache.get(p);
  let d = null;
  try { d = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64'); } catch (_) { d = null; }
  iconCache.set(p, d);
  return d;
}
function clearIconCache() { iconCache.clear(); }

function itemView(key) {
  const st = ctx.state;
  const pinned = st.pinned.includes(key);
  if (key.startsWith('app:')) {
    const a = ctx.catalogMap.get(key);
    if (!a) return null;
    return {
      key, name: a.name, icon: iconData(a.iconT || a.icon), iconScale: a.iconScale || null,
      kind: 'app', hasPath: !!a.path && !a.uwp, pinned, isNew: !!st.fresh[key]
    };
  }
  const c = st.custom[key];
  if (!c) return null;
  return { key, name: c.name, icon: c.icon || null, iconScale: c.iconScale || null, kind: c.kind, hasPath: c.kind !== 'url', pinned };
}

// 界面需要的全部数据：启动台列表、最近/常用、可添加的应用、外观设置
function buildData() {
  const st = ctx.state;
  const items = st.order.map(itemView).filter(Boolean);
  const shown = new Set(items.map((i) => i.key));
  const used = Object.keys(st.usage).filter((k) => shown.has(k));
  const recent = used.slice().sort((a, b) => st.usage[b].last - st.usage[a].last).slice(0, 8);
  const pinned = st.pinned.filter((k) => shown.has(k));
  const byCount = used.filter((k) => !pinned.includes(k)).sort((a, b) => st.usage[b].count - st.usage[a].count);
  const frequent = pinned.concat(byCount).slice(0, 8);
  const inOrder = new Set(st.order);
  const catalog = ctx.catalog.map((a) => ({
    key: a.key,
    name: a.name,
    icon: iconData(a.iconT || a.icon),
    iconScale: a.iconScale || null,
    path: a.path || (a.uwp ? 'Microsoft Store 应用' : a.appId),
    added: inOrder.has(a.key)
  }));
  const s = st.settings;
  return {
    items, recent, frequent, catalog,
    loading: ctx.catalog.length === 0 && ctx.scanning,
    settings: {
      hotkey: s.hotkey,
      panelAlpha: s.panelAlpha,
      blur: s.blur,
      panelWidth: panelWidth(),
      bottomOffset: s.bottomOffset,
      accent: s.accent,
      glass: s.glass !== false,
      glassStrength: s.glassStrength,
      cols: columns()
    }
  };
}

function pushData() {
  if (ctx.win && !ctx.win.isDestroyed()) ctx.win.webContents.send('data:changed', buildData());
}

function touchUsage(key) {
  const st = ctx.state;
  if (st.fresh[key]) delete st.fresh[key];
  const u = st.usage[key] || { count: 0, last: 0 };
  u.count += 1;
  u.last = Date.now();
  st.usage[key] = u;
  saveState();
}

module.exports = {
  initPaths, loadState, writeState, saveState, setCatalog,
  panelWidth, columns, clearIconCache, buildData, pushData, touchUsage
};
