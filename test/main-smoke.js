'use strict';

/* 主进程冒烟测试：不需要 Windows，也不需要 Electron。
   用一个假的 electron 模块把 app/main 整个跑起来，然后逐个调用界面会用到的接口，
   确认模块之间的连接、数据读写和设置校验都正常。
   运行：node test/main-smoke.js */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-smoke-'));
// 按 Windows 的分支跑（创建快捷方式之类只在 Windows 上做）
Object.defineProperty(process, 'platform', { value: 'win32' });
const handlers = new Map();
const sent = [];
let readyResolve;
const ready = new Promise((r) => { readyResolve = r; });

class FakeImage {
  isEmpty() { return true; }
  getSize() { return { width: 0, height: 0 }; }
  toBitmap() { return Buffer.alloc(0); }
  toPNG() { return Buffer.alloc(0); }
  toDataURL() { return ''; }
}
class FakeWebContents {
  constructor() { this.listeners = {}; }
  on(ev, fn) { this.listeners[ev] = fn; }
  once(ev, fn) { this.listeners[ev] = fn; }
  send(...args) { sent.push(args); }
  setWindowOpenHandler() {}
}
class FakeWindow {
  constructor(opts) { this.opts = opts; this.visible = false; this.webContents = new FakeWebContents(); this.events = {}; }
  setAlwaysOnTop() {}
  loadFile(f) { this.loaded = f; }
  on(ev, fn) { this.events[ev] = fn; }
  isVisible() { return this.visible; }
  isDestroyed() { return false; }
  setBounds(b) { this.bounds = b; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  moveTop() {}
  focus() {}
}
class FakeTray { setToolTip() {} on() {} setContextMenu(m) { this.menu = m; } }

const fakeElectron = {
  app: {
    setName() {}, setAppUserModelId() {},
    getVersion: () => '0.0.0-test',
    getPath: (n) => { const p = path.join(tmp, n); fs.mkdirSync(p, { recursive: true }); return p; },
    whenReady: () => { readyResolve(); return ready; },
    requestSingleInstanceLock: () => true,
    handlers: {},
    on(ev, fn) { this.handlers[ev] = fn; },
    quit() {}, exit() {}, relaunch() {},
    setLoginItemSettings(o) { this.login = o; },
    getFileIcon: async () => new FakeImage()
  },
  BrowserWindow: FakeWindow,
  Tray: FakeTray,
  Menu: { setApplicationMenu() {}, buildFromTemplate: (t) => ({ template: t }) },
  globalShortcut: { register: () => true, unregisterAll() {} },
  ipcMain: {
    handle: (ch, fn) => handlers.set(ch, fn),
    on: (ch, fn) => handlers.set(ch, fn)
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    getDisplayNearestPoint: () => ({ id: 1, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } })
  },
  nativeImage: { createFromPath: () => new FakeImage(), createFromBitmap: () => new FakeImage() },
  shell: {
    openPath: async () => '', openExternal: async () => {}, showItemInFolder() {},
    readShortcutLink: () => ({}), writeShortcutLink: () => true
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  desktopCapturer: { getSources: async () => [] }
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return 'electron';
  return origResolve.call(this, request, ...rest);
};
require.cache.electron = { id: 'electron', filename: 'electron', loaded: true, exports: fakeElectron };

// 先放一份扫描结果，模拟已经扫描过的电脑
const userData = fakeElectron.app.getPath('userData');
const catalog = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((n, i) => ({ key: 'app:id' + i, name: n, appId: 'id' + i, path: 'C:\\Apps\\' + n + '.lnk', icon: null }));
fs.writeFileSync(path.join(userData, 'catalog.json'), JSON.stringify(catalog));
fs.writeFileSync(path.join(userData, 'state.json'), JSON.stringify({ initialized: true, order: ['app:id0', 'app:id1', 'app:id2'], settings: { blur: 9 } }));

process.on('unhandledRejection', (e) => { console.error('unhandled', e); process.exitCode = 1; });

const call = (ch, ...args) => handlers.get(ch)({}, ...args);

(async () => {
  require('../app/main/index.js');
  await ready;
  await new Promise((r) => setTimeout(r, 50));
  const ctx = require('../app/main/context');

  // 启动后的状态
  assert.ok(ctx.win, 'window created');
  assert.ok(ctx.win.loaded.endsWith(path.join('renderer', 'index.html')), 'loads renderer/index.html');
  assert.ok(fs.existsSync(ctx.win.opts.webPreferences.preload), 'preload exists');
  assert.strictEqual(ctx.win.opts.webPreferences.contextIsolation, true);
  assert.strictEqual(ctx.win.opts.webPreferences.sandbox, true);
  assert.strictEqual(ctx.dev, false, 'dev mode off by default');
  assert.strictEqual(ctx.state.settings.blur, 9, 'saved settings kept');
  assert.strictEqual(ctx.state.settings.hotkey, 'Alt+Q', 'defaults filled in');

  // 数据
  let d = await call('data:get');
  assert.deepStrictEqual(d.items.map((i) => i.name), ['Alpha', 'Beta', 'Gamma']);
  assert.strictEqual(d.catalog.length, 4);
  assert.strictEqual(d.settings.cols, 8);

  // 添加 / 移除 / 撤销 / 排序 / 固定
  d = await call('app:add', ['app:id3', 'app:nope']);
  assert.deepStrictEqual(d.items.map((i) => i.key), ['app:id0', 'app:id1', 'app:id2', 'app:id3']);
  const idx = await call('app:remove', 'app:id1');
  assert.strictEqual(idx, 1);
  d = await call('app:restore', 'app:id1', idx);
  assert.deepStrictEqual(d.items.map((i) => i.key), ['app:id0', 'app:id1', 'app:id2', 'app:id3']);
  d = await call('app:restore', 'app:bogus', 0);
  assert.strictEqual(d.items.length, 4, 'unknown keys cannot be restored');
  d = await call('app:move', 'app:id0', '__end__');
  assert.deepStrictEqual(d.items.map((i) => i.key), ['app:id1', 'app:id2', 'app:id3', 'app:id0']);
  d = await call('app:move', 'app:id0', 'app:id1');
  assert.deepStrictEqual(d.items.map((i) => i.key), ['app:id0', 'app:id1', 'app:id2', 'app:id3']);
  d = await call('app:togglePin', 'app:id2');
  assert.deepStrictEqual(d.frequent, ['app:id2'], 'pinned apps lead the frequent list');
  assert.ok(d.items.find((i) => i.key === 'app:id2').pinned);

  // 网址：只收 http / https
  assert.strictEqual((await call('app:addUrl', 'bilibili.com', '')).added, 1);
  assert.strictEqual((await call('app:addUrl', 'bilibili.com', '')).added, 0, 'no duplicates');
  assert.strictEqual((await call('app:addUrl', 'javascript:alert(1)', '')).added, 0);
  assert.strictEqual((await call('app:addUrl', 'file:///C:/Windows', '')).added, 0);
  d = await call('data:get');
  const url = d.items.find((i) => i.kind === 'url');
  assert.strictEqual(url.name, 'bilibili.com');

  // 打开应用会记录使用次数
  await call('app:launch', 'app:id2');
  d = await call('data:get');
  assert.deepStrictEqual(d.recent, ['app:id2']);
  assert.deepStrictEqual(d.frequent, ['app:id2']);

  // 设置校验
  d = await call('settings:set', 'blur', 999);
  assert.strictEqual(d.settings.blur, 40);
  d = await call('settings:set', 'panelWidth', 123);
  assert.strictEqual(d.settings.panelWidth, 800);
  d = await call('settings:set', 'panelWidth', 720);
  assert.strictEqual(d.settings.cols, 7);
  d = await call('settings:set', 'accent', 'red; background:url(x)');
  assert.strictEqual(d.settings.accent, '#7CC7FF', 'bad colors ignored');
  d = await call('settings:set', 'glassStrength', 'abc');
  assert.strictEqual(d.settings.glassStrength, 0);
  d = await call('settings:set', 'reset', true);
  assert.strictEqual(d.settings.blur, 14);
  assert.strictEqual(d.settings.panelWidth, 800);

  // 打开面板：窗口位置、发给界面的数据
  const panel = require('../app/main/window');
  await panel.showPanel();
  const open = sent.find((m) => m[0] === 'panel:open');
  assert.ok(open, 'panel:open sent');
  assert.deepStrictEqual(open[2], { x: 560, y: 360, width: 800, height: 500 });
  assert.ok(open[1].catalog.every((c) => c.icon === null), 'catalog icons are not sent on open');
  assert.ok(sent.find((m) => m[0] === 'panel:bg'), 'panel:bg sent after capture');
  assert.strictEqual((await call('catalog:get')).length, 4);
  assert.ok(ctx.win.isVisible());
  panel.toggle();
  assert.ok(!ctx.win.isVisible());

  // 系统截图接口卡住时：面板照样立刻显示，1.5 秒后放弃截图，之后还能正常开关
  fakeElectron.desktopCapturer.getSources = () => new Promise(() => {});
  sent.length = 0;
  const pending = panel.showPanel();
  assert.ok(ctx.win.isVisible(), 'panel shows without waiting for the capture');
  panel.toggle();
  assert.ok(!ctx.win.isVisible(), 'can close while capture is pending');
  panel.toggle();
  assert.ok(ctx.win.isVisible(), 'can reopen while an earlier capture is still pending');
  await pending;
  await new Promise((r) => setTimeout(r, 1600));
  const bgs = sent.filter((m) => m[0] === 'panel:bg');
  assert.strictEqual(bgs.length, 1, 'only the latest open gets a background');
  assert.strictEqual(bgs[0][1], null, 'gives up on a stuck capture');
  panel.toggle();

  // 状态写盘
  require('../app/main/store').writeState();
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
  assert.ok(saved.order.includes('url:https://bilibili.com'));
  assert.strictEqual(saved.iconVersion, require('../app/main/config').ICON_VERSION);

  // 把桌面图标拖到「更多应用」图标上：Windows 带着文件路径再启动一次本程序
  const dropDir = fs.mkdtempSync(path.join(tmp, 'desktop-'));
  const mk = (n) => { const p = path.join(dropDir, n); fs.writeFileSync(p, 'x'); return p; };
  const deltaLnk = mk('Delta.lnk');   // 和已安装的应用同名 → 用扫描到的那个应用
  const toolExe = mk('tool.exe');     // 不认识的程序 → 作为文件添加
  const betaLnk = mk('Beta.lnk');     // 已经在启动台里
  await call('app:remove', 'app:id3');
  sent.length = 0;
  const appDir = require('../app/main/config').APP_ROOT;
  fakeElectron.app.handlers['second-instance']({}, [process.execPath, '--some-switch', deltaLnk, toolExe, betaLnk, path.join(dropDir, 'missing.lnk'), path.join(appDir, 'package.json')]);
  await new Promise((r) => setTimeout(r, 50));
  d = await call('data:get');
  assert.ok(d.items.some((i) => i.key === 'app:id3'), 'dropped shortcut matched to the installed app');
  const tool = d.items.find((i) => i.name === 'tool');
  assert.ok(tool && tool.kind === 'file', 'unknown program added as a file');
  assert.ok(!d.items.some((i) => i.name === 'missing' || i.name === 'package.json'), 'missing files and own files ignored');
  const opened = sent.find((m) => m[0] === 'panel:open');
  assert.ok(opened && /已添加 「Delta」、「tool」/.test(opened[3].toast), 'panel opens with a toast: ' + (opened && opened[3].toast));
  assert.strictEqual(opened[3].jumpToEnd, true);
  sent.length = 0;
  fakeElectron.app.handlers['second-instance']({}, [process.execPath, betaLnk]);
  await new Promise((r) => setTimeout(r, 50));
  const toast = sent.find((m) => m[0] === 'panel:toast');
  assert.ok(toast && /「Beta」 已经在启动台里了/.test(toast[1]), 'already-added message while panel is open');
  const dropRes = await call('app:addPaths', [toolExe]);
  assert.deepStrictEqual([dropRes.added, dropRes.exists], [0, ['tool']], 'dropping into the panel reports duplicates');
  panel.hidePanel();

  // 卸载清理
  require('../app/main/system').uninstallCleanup();
  assert.strictEqual(fakeElectron.app.login.openAtLogin, false);

  // 扫描（Linux 上没有 PowerShell，应该安静地失败，不影响现有数据）
  await require('../app/main/scanner').runScan();
  assert.strictEqual(ctx.scanning, false);
  assert.strictEqual(ctx.catalog.length, 4);

  console.log('main smoke test: all checks passed');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
