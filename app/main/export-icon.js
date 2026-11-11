'use strict';

/* 导出高清图标（给 Nexus 等停靠栏用）
   Nexus 显示 Microsoft Store / MSIX 应用时只拿到 44px 的小图再放大，所以发糊。
   这里取系统 256px 图标和安装包里最大的原图，挑清楚的那张，
   裁掉透明边、按统一比例居中到 256×256，存成 PNG 和多尺寸 ICO。 */
const { nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ctx = require('./context');
const icons = require('./icons');
const ps = require('./powershell');
const { diag } = require('./log');

function exportDir() {
  const d = path.join(ctx.paths.userDir, '高清图标');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function exportHdIcon(key) {
  let name, appId = '', exe = '';
  if (key.startsWith('app:')) {
    const a = ctx.catalogMap.get(key);
    if (!a) return { ok: false, error: '找不到这个应用' };
    name = a.name; appId = a.appId; exe = a.path && !a.uwp ? a.path : '';
  } else {
    const c = ctx.state.custom[key];
    if (!c || c.kind === 'url') return { ok: false, error: '网址没有图标文件可以导出' };
    name = c.name; exe = c.target;
  }
  const safe = String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'icon';
  const dir = exportDir();
  const tmpBase = path.join(dir, '.tmp-' + crypto.randomBytes(4).toString('hex'));
  const script = '$AppId = ' + ps.quote(appId) + '\n$ExePath = ' + ps.quote(exe) + '\n$OutBase = ' + ps.quote(tmpBase) +
    "\n$Code = @'\n" + ps.iconGrabSource() + "\n'@\n" + ps.readScript('export-icon.ps1');
  const res = ps.parseJsonTail((await ps.run(script, 60000)).stdout) || {};

  // 两个来源都试，裁掉透明边后哪张像素多就用哪张（一样大时优先安装包原图）
  const cands = [];
  for (const [kind, p] of [['pkg', res.pkg], ['shell', res.shell]]) {
    if (!p) continue;
    const t = icons.trimImage(nativeImage.createFromPath(p));
    if (t) { const z = t.img.getSize(); cands.push({ kind, t, px: Math.max(z.width, z.height) }); }
  }
  for (const p of [res.pkg, res.shell]) { if (p) try { fs.unlinkSync(p); } catch (_) {} }
  if (!cands.length) {
    diag('export fail ' + name + ': ' + (res.err || 'no output'));
    return { ok: false, error: '没能取到这个应用的图标' };
  }
  cands.sort((a, b) => b.px - a.px || (a.kind === 'pkg' ? -1 : 1));
  const best = cands[0];
  const img = icons.squareCanvas(best.t, 256);
  const png = path.join(dir, safe + '.png');
  const ico = path.join(dir, safe + '.ico');
  fs.writeFileSync(png, img.toPNG());
  fs.writeFileSync(ico, icons.makeIco(img));
  diag('export ok ' + name + ' from=' + best.kind + ' src=' + best.px + 'px' + (res.pkgSrc ? ' ' + path.basename(res.pkgSrc) : ''));
  return { ok: true, png, ico, srcPx: best.px };
}

// 开发模式：userData 里放一个 export-request.txt（每行一个应用名），启动时自动导出
async function handleExportRequests() {
  const f = path.join(ctx.paths.userDir, 'export-request.txt');
  let names = [];
  try { names = fs.readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean); } catch (_) { return; }
  try { fs.unlinkSync(f); } catch (_) {}
  for (const n of names) {
    const lower = n.toLowerCase();
    const a = ctx.catalog.find((x) => x.name.toLowerCase() === lower) ||
      ctx.catalog.find((x) => x.name.toLowerCase().includes(lower));
    if (!a) { diag('export: not found ' + n); continue; }
    await exportHdIcon(a.key);
  }
}

module.exports = { exportHdIcon, handleExportRequests };
