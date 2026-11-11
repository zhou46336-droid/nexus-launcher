'use strict';

// 图标处理：兜底取图标、裁掉透明边统一大小、生成 256px PNG 和多尺寸 ICO
const { app, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ctx = require('./context');
const { log } = require('./log');

function expandEnv(p) {
  return String(p || '').replace(/%([^%]+)%/g, (m, k) => process.env[k] || process.env[k.toUpperCase()] || m);
}

function iconFileFor(appId) {
  return path.join(ctx.paths.iconDir, crypto.createHash('sha1').update(appId, 'utf8').digest('hex') + '.png');
}

// PowerShell 没拿到高清图标的应用，用系统给的文件图标兜底（来自程序本身，清晰度略低）
async function fillMissingIcons(list) {
  let n = 0;
  for (const a of list) {
    if (a.icon && fs.existsSync(a.icon)) continue;
    if (!a.path) continue;
    // 快捷方式本身只能拿到通用图标，要顺着它找到真正的程序或图标文件
    let src = a.path;
    if (/\.lnk$/i.test(src)) {
      try {
        const l = shell.readShortcutLink(src);
        const ic = expandEnv(l.icon);
        src = /\.(exe|ico)$/i.test(ic) && fs.existsSync(ic) ? ic : expandEnv(l.target);
      } catch (_) { src = null; }
    }
    if (!src || !/\.(exe|ico)$/i.test(src) || !fs.existsSync(src)) continue;
    try {
      const img = await app.getFileIcon(src, { size: 'large' });
      if (!img || img.isEmpty()) continue;
      const out = iconFileFor(a.appId);
      fs.writeFileSync(out, img.toPNG());
      a.icon = out;
      n++;
    } catch (_) {}
  }
  log('fallback icons=' + n + ' total=' + list.length + ' withIcon=' + list.filter((a) => a.icon).length);
  normalizeIcons(list);
}

/* 图标统一大小：
   很多图标四周自带一圈透明留白（比如微信输入法），直接显示会比别的小一圈。
   这里把透明边裁掉，再按图标形状算一个显示比例：方形图标 86%，
   圆形或不规则图标稍大一些（最多 96%），让它们看起来一样大。 */
function trimImage(img) {
  if (!img || img.isEmpty()) return null;
  const { width: w, height: h } = img.getSize();
  const buf = img.toBitmap();
  if (!w || !h || buf.length < w * h * 4) return null;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[(y * w + x) * 4 + 3] > 24) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const coverage = count / (bw * bh);
  const scale = Math.min(0.96, Math.max(0.86, 0.86 * Math.sqrt(0.95 / Math.max(coverage, 0.3))));
  const cropped = (bw === w && bh === h) ? img : img.crop({ x: x0, y: y0, width: bw, height: bh });
  return { img: cropped, scale: Math.round(scale * 100) / 100 };
}

// 裁好的图标存成 <hash>.t<比例>.png，下次直接复用
function normalizeIcons(list) {
  const dir = ctx.paths.iconDir;
  const index = new Map();
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = /^([0-9a-f]{40})\.t(\d+)\.png$/.exec(f);
      if (m) index.set(m[1], { file: path.join(dir, f), scale: Number(m[2]) / 100 });
    }
  } catch (_) {}
  let made = 0;
  for (const a of list) {
    if (!a.icon) continue;
    const base = path.basename(a.icon, '.png');
    let r = index.get(base);
    if (!r) {
      try {
        const n = trimImage(nativeImage.createFromPath(a.icon));
        if (n) {
          const pct = Math.round(n.scale * 100);
          r = { file: path.join(dir, base + '.t' + pct + '.png'), scale: pct / 100 };
          fs.writeFileSync(r.file, n.img.toPNG());
          index.set(base, r);
          made++;
        }
      } catch (_) { r = null; }
    }
    if (r) { a.iconT = r.file; a.iconScale = r.scale; }
  }
  log('normalized icons=' + made + ' withTrim=' + list.filter((a) => a.iconT).length);
}

// 把裁好的图标按统一比例居中放进 size×size 的透明画布
function squareCanvas(trimmed, size) {
  const { img, scale } = trimmed;
  const { width: cw, height: ch } = img.getSize();
  const k = (size * scale) / Math.max(cw, ch);
  const tw = Math.max(1, Math.round(cw * k));
  const th = Math.max(1, Math.round(ch * k));
  const src = img.resize({ width: tw, height: th, quality: 'best' }).toBitmap();
  const out = Buffer.alloc(size * size * 4);
  const ox = Math.floor((size - tw) / 2);
  const oy = Math.floor((size - th) / 2);
  for (let y = 0; y < th; y++) {
    src.copy(out, ((oy + y) * size + ox) * 4, y * tw * 4, (y + 1) * tw * 4);
  }
  return nativeImage.createFromBitmap(out, { width: size, height: size });
}

// 多尺寸 ICO（每个尺寸都用 PNG 压缩存储，Windows Vista 起都支持）
function makeIco(img256) {
  const sizes = [256, 128, 64, 48, 32, 24, 16];
  const pngs = sizes.map((s) => (s === 256 ? img256 : img256.resize({ width: s, height: s, quality: 'best' })).toPNG());
  return buildIco(sizes, pngs);
}

function buildIco(sizes, pngs) {
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(s >= 256 ? 0 : s, e);
    head.writeUInt8(s >= 256 ? 0 : s, e + 1);
    head.writeUInt8(0, e + 2);
    head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(pngs[i].length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([head].concat(pngs));
}

module.exports = { fillMissingIcons, trimImage, normalizeIcons, squareCanvas, makeIco, buildIco };
