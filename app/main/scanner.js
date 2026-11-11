'use strict';

// 扫描已安装的应用（PowerShell：Get-StartApps + 高清图标），并把新装的应用自动加进启动台
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const ctx = require('./context');
const config = require('./config');
const store = require('./store');
const icons = require('./icons');
const ps = require('./powershell');
const { log, scanDiag } = require('./log');

function isJunk(a) {
  return config.JUNK.test(a.name) || /^https?:/i.test(a.appId) || config.SELF.test(a.appId) || (a.path && config.SELF.test(a.path));
}
function isDefaultPick(a) {
  return !(a.path && config.SYS_DIRS.test(a.path));
}

async function runScan() {
  if (ctx.scanning) { ctx.rescanPending = true; return; }
  ctx.scanning = true;
  ctx.lastScan = Date.now();
  const wasEmpty = ctx.catalog.length === 0;
  let changed = false;
  try {
    const script = '$IconDir = ' + ps.quote(ctx.paths.iconDir) + '\n' + ps.readScript('scan.ps1');
    const res = await ps.run(script, 180000);
    if (res.error) log('scan spawn error: ' + res.error);
    if (res.stderr) log('scan stderr: ' + res.stderr.slice(0, 2000));
    let raw = ps.parseJsonTail(res.stdout);
    if (raw === undefined) { log('scan: no json output'); return; }
    if (!Array.isArray(raw)) raw = raw ? [raw] : [];
    const seen = new Set();
    const list = [];
    for (const r of raw) {
      if (!r || !r.appId || !r.name) continue;
      const a = {
        key: 'app:' + r.appId,
        name: String(r.name),
        appId: String(r.appId),
        path: r.path ? String(r.path) : null,
        icon: r.icon ? String(r.icon) : null,
        uwp: !!r.uwp
      };
      if (seen.has(a.key) || isJunk(a)) continue;
      seen.add(a.key);
      list.push(a);
    }
    list.sort((x, y) => x.name.localeCompare(y.name, 'zh-CN'));
    await icons.fillMissingIcons(list);
    scanDiag();
    changed = applyScan(list);
  } catch (e) {
    log('scan failed: ' + (e && e.stack || e));
  } finally {
    ctx.scanning = false;
    // 扫描结果和上次一样就不打扰界面（面板开着时不会重绘、不会闪）
    if (changed || wasEmpty) store.pushData();
    if (ctx.rescanPending) { ctx.rescanPending = false; setTimeout(runScan, 1000); }
  }
}

// 用来判断两次扫描结果是否一样
function signature(list) {
  return JSON.stringify(list.map((a) => [a.key, a.name, a.path, a.iconT || a.icon, a.iconScale]));
}

// 返回 true 表示应用列表有变化
function applyScan(list) {
  if (list.length < 3) return false; // 扫描异常时不动现有数据
  const st = ctx.state;
  if (st.initialized && signature(list) === signature(ctx.catalog)) return false;
  store.clearIconCache();
  store.setCatalog(list);
  try { fs.writeFileSync(ctx.paths.catalogPath, JSON.stringify(list)); } catch (_) {}
  const added = [];
  if (!st.initialized) {
    st.order = list.filter(isDefaultPick).map((a) => a.key);
    st.initialized = true;
  } else {
    st.order = st.order.filter((k) => !k.startsWith('app:') || ctx.catalogMap.has(k));
    // 新安装的应用：以前没扫描到过的，自动放到启动台最后
    // （以前见过、被你移除的不会再加回来；系统工具类不自动加）
    if (st.known && st.settings.autoAdd) {
      const known = new Set(st.known);
      for (const a of list) {
        if (known.has(a.key) || st.order.includes(a.key) || !isDefaultPick(a)) continue;
        st.order.push(a.key);
        st.fresh[a.key] = Date.now();
        added.push(a.name);
      }
    }
  }
  const knownSet = new Set(st.known || []);
  for (const a of list) knownSet.add(a.key);
  st.known = Array.from(knownSet);
  // 「新」标记最多保留 7 天
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  for (const k of Object.keys(st.fresh)) {
    if (st.fresh[k] < weekAgo || !st.order.includes(k)) delete st.fresh[k];
  }
  if (added.length) {
    st.notice = st.notice.concat(added).slice(-20);
    log('auto added: ' + added.join(', '));
  }
  store.saveState();
  return true;
}

// 面板上的「刷新」：重新扫描，等结束后返回新增了哪些
async function rescanAndReport() {
  const st = ctx.state;
  const before = new Set(st.order);
  runScan();
  const until = Date.now() + 120000;
  await new Promise((r) => setTimeout(r, 300));
  while ((ctx.scanning || ctx.rescanPending) && Date.now() < until) await new Promise((r) => setTimeout(r, 300));
  const added = st.order.filter((k) => !before.has(k)).map((k) => (ctx.catalogMap.get(k) || {}).name).filter(Boolean);
  if (added.length) { st.notice = st.notice.filter((n) => !added.includes(n)); store.saveState(); }
  return added;
}

// 开始菜单有变化（装了新软件）时自动重新扫描；Store 应用另外定时检查
function watchStartMenu() {
  const dirs = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ];
  let t = null;
  const kick = () => { clearTimeout(t); t = setTimeout(runScan, 8000); };
  for (const d of dirs) {
    try { fs.watch(d, { recursive: true }, kick); } catch (e) { log('watch failed: ' + d + ' ' + e.message); }
  }
  setInterval(runScan, config.RESCAN_INTERVAL_MS);
}

module.exports = { runScan, rescanAndReport, watchStartMenu };
