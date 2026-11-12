'use strict';

/* 点击面板外面自动收起 —— 但从桌面拖东西过来时不收起。

   面板失去焦点时，启动小助手 bin/mousewatch.exe 看鼠标主键的状态：
   - 主键没按着（比如按了 Alt+Tab）           → 立刻收起
   - 很快松开、指针没怎么动（普通点击）        → 收起
   - 按住超过 0.2 秒或按住拖动了（拖动）      → 先不收起，等松手：
       · 松手时东西放进了面板 → 保持打开，直到下一次点在面板外面
       · 放到了别处          → 收起
   找不到小助手（比如开发时没编译）就退回原来的做法：失去焦点马上收起。 */
const { screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ctx = require('./context');
const config = require('./config');

const HELPER = path.join(config.APP_ROOT, 'bin', 'mousewatch.exe');
const HOLD_MS = 200;        // 按住超过这么久就当作拖动
const DROP_WAIT_MS = 350;   // 松手后等界面报告「放进来了」的时间

let spawnHelper = () => spawn(HELPER, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
let helperAvailable = () => process.platform === 'win32' && fs.existsSync(HELPER);
let proc = null;
let mode = null;            // pending（刚失去焦点）| drag（正在拖）| stay（放进来了，保持打开）
let holdTimer = null;
let hide = () => {};

function stop() {
  clearTimeout(holdTimer);
  mode = null;
  if (proc) {
    const p = proc;
    proc = null;
    try { p.stdin.end(); } catch (_) {}
    try { p.kill(); } catch (_) {}
  }
}

function hideNow() {
  stop();
  ctx.lastBlurHide = Date.now();
  hide();
}

function outsideWindow() {
  if (!ctx.win) return true;
  const p = screen.getCursorScreenPoint();
  const b = ctx.win.getBounds();
  return p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height;
}

function handle(line, since) {
  const ev = line.split(' ')[0];
  if (ev === 'init') {
    if (/^init up/.test(line)) hideNow(); // 不是鼠标点出去的（键盘切走了）
    return;
  }
  if (ev === 'move') {
    if (mode === 'pending') mode = 'drag';
    return;
  }
  if (ev === 'up') {
    if (mode === 'pending') { hideNow(); return; }
    if (mode === 'drag') {
      setTimeout(() => {
        if (mode !== 'drag') return;
        if (ctx.lastDropAt >= since) mode = 'stay'; // 放进了面板：保持打开
        else hideNow();
      }, DROP_WAIT_MS);
    }
    return;
  }
  if (ev === 'down' && mode === 'stay' && outsideWindow()) hideNow();
}

// 面板失去焦点
function onBlur() {
  stop();
  if (!helperAvailable()) { hideNow(); return; }
  let child;
  try { child = spawnHelper(); } catch (_) { hideNow(); return; }
  proc = child;
  mode = 'pending';
  const since = Date.now();
  holdTimer = setTimeout(() => { if (mode === 'pending' && proc === child) mode = 'drag'; }, HOLD_MS);
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    if (proc !== child) return;
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) handle(line, since);
      if (proc !== child) return;
    }
  });
  child.on('error', () => { if (proc === child) hideNow(); });
  child.on('exit', () => {
    if (proc !== child) return;
    proc = null;
    if (mode === 'pending' || mode === 'drag') hideNow();
  });
}

function init(hideFn) { hide = hideFn; }

// 测试用：换掉小助手
function _setHelper(spawnFn, available) {
  spawnHelper = spawnFn;
  helperAvailable = () => available;
}

module.exports = { init, onBlur, stop, _setHelper, _mode: () => mode };
