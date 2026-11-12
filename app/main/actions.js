'use strict';

// 打开应用、以管理员身份运行、打开所在位置、添加文件 / 文件夹
const { app, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ctx = require('./context');
const store = require('./store');
const icons = require('./icons');
const panel = require('./window');

function openAppsFolder(appId) {
  spawn('explorer.exe', ['shell:AppsFolder\\' + appId], { detached: true, stdio: 'ignore' }).unref();
}

function launch(key) {
  store.touchUsage(key);
  panel.hidePanel();
  if (key.startsWith('app:')) {
    const a = ctx.catalogMap.get(key);
    if (!a) return;
    if (a.path && !a.uwp) shell.openPath(a.path).then((err) => { if (err) openAppsFolder(a.appId); });
    else openAppsFolder(a.appId);
    return;
  }
  const c = ctx.state.custom[key];
  if (!c) return;
  if (c.kind === 'url') shell.openExternal(c.target);
  else shell.openPath(c.target);
}

// 应用对应的文件路径（Store 应用和网址没有）
function targetPath(key) {
  if (key.startsWith('app:')) {
    const a = ctx.catalogMap.get(key);
    return a && a.path && !a.uwp ? a.path : null;
  }
  const c = ctx.state.custom[key];
  return c && c.kind !== 'url' ? c.target : null;
}

function runAsAdmin(key) {
  const p = targetPath(key);
  if (!p) return;
  store.touchUsage(key);
  panel.hidePanel();
  // 路径通过环境变量传给 PowerShell，不拼进命令里，任何特殊字符都不会出问题
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    'Start-Process -FilePath $env:NL_TARGET -Verb RunAs'],
  { windowsHide: true, detached: true, stdio: 'ignore', env: Object.assign({}, process.env, { NL_TARGET: p }) }).unref();
}

function openLocation(key) {
  const p = targetPath(key);
  if (!p) return;
  panel.hidePanel();
  shell.showItemInFolder(p);
}

// 添加一个文件或文件夹（拖进面板 / 文件选择框 / 拖到「更多应用」图标上）
// 返回 { status: 'added' | 'exists' | 'invalid', name }
async function addPath(p) {
  if (typeof p !== 'string' || !p) return { status: 'invalid' };
  let st;
  try { st = fs.statSync(p); } catch (_) { return { status: 'invalid' }; }
  const isDir = st.isDirectory();
  const key = (isDir ? 'dir:' : 'file:') + p.toLowerCase();
  const name = path.basename(p).replace(/\.(lnk|url|exe|bat|cmd)$/i, '') || p;
  if (ctx.state.order.includes(key)) return { status: 'exists', name: (ctx.state.custom[key] || {}).name || name };
  let icon = null;
  let iconScale = null;
  try {
    const img = await app.getFileIcon(p, { size: 'large' });
    const n = icons.trimImage(img);
    icon = (n ? n.img : img).toDataURL();
    iconScale = n ? n.scale : null;
  } catch (_) { icon = null; }
  ctx.state.custom[key] = { name, kind: isDir ? 'folder' : 'file', target: p, icon, iconScale };
  ctx.state.order.push(key);
  store.saveState();
  return { status: 'added', name };
}

/* 拖进来的如果就是某个已安装的应用（桌面快捷方式、程序本身），直接用扫描到的那个应用：
   名字是开始菜单里的正式名字，图标也是统一处理过的高清图标。 */
const norm = (p) => String(p || '').toLowerCase().replace(/\//g, '\\');
function linkTarget(p) {
  if (!/\.lnk$/i.test(p)) return '';
  try { return shell.readShortcutLink(p).target || ''; } catch (_) { return ''; }
}

function findCatalogApp(p) {
  if (!/\.(lnk|url|exe)$/i.test(p)) return null;
  const np = norm(p);
  const target = norm(linkTarget(p) || p);
  // 1. 路径一样，或者指向同一个程序
  for (const a of ctx.catalog) {
    if (norm(a.path) === np || norm(a.path) === target || norm(a.appId) === target) return a;
  }
  // 2. 开始菜单里的快捷方式也指向同一个程序
  if (/\.exe$/i.test(target)) {
    for (const a of ctx.catalog) {
      if (a.path && /\.lnk$/i.test(a.path) && norm(linkTarget(a.path)) === target) return a;
    }
  }
  // 3. 名字一样（Microsoft Store 应用的桌面快捷方式没有程序路径，只能按名字认）
  const base = path.basename(p).replace(/\.(lnk|url|exe)$/i, '').trim().toLowerCase();
  return ctx.catalog.find((a) => a.name.trim().toLowerCase() === base) || null;
}

// 一次添加多个拖进来的东西，返回 { added: [名字], exists: [名字] }
async function addDropped(paths) {
  const res = { added: [], exists: [] };
  for (const p of Array.isArray(paths) ? paths : []) {
    if (typeof p !== 'string' || !p) continue;
    const a = findCatalogApp(p);
    if (a) {
      if (ctx.state.order.includes(a.key)) res.exists.push(a.name);
      else { ctx.state.order.push(a.key); res.added.push(a.name); store.saveState(); }
      continue;
    }
    const r = await addPath(p);
    if (r.status === 'added') res.added.push(r.name);
    else if (r.status === 'exists') res.exists.push(r.name);
  }
  return res;
}

// 添加网址：只接受 http / https
function addUrl(url, name) {
  let u = String(url || '').trim();
  if (!u) return false;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  if (!/^https?:/i.test(u)) return false;
  let host;
  try { host = new URL(u).hostname; } catch (_) { return false; }
  if (!host) return false;
  const key = 'url:' + u;
  if (ctx.state.order.includes(key)) return false;
  ctx.state.custom[key] = { name: String(name || '').trim() || host, kind: 'url', target: u, icon: null };
  ctx.state.order.push(key);
  store.saveState();
  return true;
}

module.exports = { launch, runAsAdmin, openLocation, targetPath, addPath, addDropped, addUrl };
