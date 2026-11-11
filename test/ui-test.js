'use strict';

/* 界面测试：用 Playwright 打开真正的 app/renderer/index.html，
   把主进程接口换成 test/mock.js 里的假数据，走一遍主要操作并检查结果。
   运行：node test/ui-test.js            （截图存到 test/out/）
         node test/ui-test.js --docs     （另外生成 README 用的高清截图到 docs/images/） */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const DOCS = process.argv.includes('--docs');
const PAGE = 'file://' + path.join(ROOT, 'app', 'renderer', 'index.html');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock.js'), 'utf8');

// 模拟一张桌面壁纸：给液态玻璃和模糊效果当背景
const WALLPAPER = `
  const c = document.createElement('canvas'); c.width = 1600; c.height = 900; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 1600, 900);
  gr.addColorStop(0, '#1d2b64'); gr.addColorStop(0.5, '#6a3093'); gr.addColorStop(1, '#f8b26a');
  g.fillStyle = gr; g.fillRect(0, 0, 1600, 900);
  for (const [x, y, r, col] of [[520, 330, 260, '#4fc3f7'], [1150, 640, 320, '#ff6f91'], [860, 860, 240, '#ffc75f'], [1260, 250, 180, '#845ec2']]) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 1600, 900);
  }
  c.toDataURL('image/jpeg', 0.92);`;

async function openPanel(page, extra) {
  await page.evaluate(async ([wallpaper, extra]) => {
    const url = eval(wallpaper); // eslint-disable-line no-eval
    window.__set = Object.assign({}, extra || {});
    const d = await window.launcher.getData();
    const rect = { x: 380, y: 250, width: d.settings.panelWidth, height: 500 };
    window.__open(d, rect, { maxWait: 300, lateBgOk: true });
    setTimeout(() => window.__bg({ url, x: 0, y: 0, width: 1600, height: 900 }, rect), 50);
  }, [WALLPAPER, extra]);
  await page.waitForTimeout(400);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 840, height: 596 }, deviceScaleFactor: DOCS ? 2 : 1, bypassCSP: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(MOCK);
  await page.goto(PAGE);
  // 测试页没有真的桌面，给页面一个深色背景，截图好看一点
  await page.addStyleTag({ content: 'html, body { background: #101522 !important; }' });
  await page.waitForTimeout(200);
  await openPanel(page);
  const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png') });
  // README 用的截图：只截面板，圆角外面透明
  const docShot = async (name) => {
    if (!DOCS) return;
    await page.addStyleTag({ content: 'html, body { background: transparent !important; }' });
    await page.locator('#panel').screenshot({ path: path.join(ROOT, 'docs', 'images', name + '.png'), omitBackground: true });
    await page.addStyleTag({ content: 'html, body { background: #101522 !important; }' });
  };

  // 0. 打开流程：截图到之前面板透明；截图一直不来时 300ms 后用深一点的底色显示；晚到的截图淡入
  await page.evaluate(async () => {
    const d = await window.launcher.getData();
    window.__open(d, { x: 380, y: 250, width: 800, height: 500 }, { maxWait: 300, lateBgOk: true });
  });
  assert.ok(await page.locator('#panel.waiting').count(), 'panel waits for the background');
  await page.waitForTimeout(400);
  assert.strictEqual(await page.locator('#panel.waiting').count(), 0, 'panel shows after the wait');
  assert.ok(await page.locator('#panel.no-bg').count(), 'darker fallback tint without a background');
  await openPanel(page);
  assert.strictEqual(await page.locator('#panel.no-bg').count(), 0, 'glass background applied');

  // 1. 主界面：8 列 × 3 行，最近使用 8 个，两页
  assert.strictEqual(await page.locator('.grid .tile').count(), 24);
  assert.strictEqual(await page.locator('.strip .tile').count(), 8);
  assert.strictEqual(await page.locator('.dot').count(), 2);
  assert.match(await page.locator('#panel-bg').evaluate((el) => el.style.filter), /url\("?#lg"?\)/, 'liquid glass filter applied');
  await shot('main');
  await docShot('main');

  // 2. 最常用
  await page.click('text=最常用');
  assert.strictEqual(await page.locator('.seg-btn.on').innerText(), '最常用');

  // 3. 右键菜单
  await page.locator('.grid .tile').first().click({ button: 'right' });
  assert.strictEqual(await page.locator('.menu .mi').count(), 7);
  await shot('menu');
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.locator('.menu').count(), 0);

  // 4. 编辑模式：移除再撤销
  await page.click('.head >> text=编辑');
  assert.strictEqual(await page.locator('.tile.editing').count(), 24);
  const firstName = await page.locator('.grid .tile .name').first().innerText();
  await page.locator('.grid .tile .minus').first().click({ force: true });
  await page.waitForTimeout(100);
  assert.notStrictEqual(await page.locator('.grid .tile .name').first().innerText(), firstName);
  assert.match(await page.locator('.toast').innerText(), /已从启动台移除/);
  await shot('edit');
  await docShot('edit');
  await page.click('.tbtn');
  await page.waitForTimeout(100);
  assert.strictEqual(await page.locator('.grid .tile .name').first().innerText(), firstName, 'undo restores the app');

  // 5. 外观设置
  await page.click('text=外观');
  assert.strictEqual(await page.locator('.set-row').count(), 6);
  await page.locator('.switch').click();
  assert.strictEqual(await page.locator('.switch').getAttribute('aria-checked'), 'false');
  assert.doesNotMatch(await page.locator('#panel-bg').evaluate((el) => el.style.filter), /url\("?#lg"?\)/, 'glass can be turned off');
  await page.locator('.switch').click();
  await shot('settings');
  await docShot('settings');
  await page.keyboard.press('Escape');
  await page.click('text=完成');

  // 6. 翻页
  await page.locator('.dot').nth(1).click();
  assert.strictEqual(await page.locator('.dot.on').getAttribute('aria-label'), '第 2 页');
  await page.keyboard.press('PageUp');
  assert.strictEqual(await page.locator('.dot.on').getAttribute('aria-label'), '第 1 页');

  // 7. 添加应用：图标进入时才加载；勾选两个
  await page.click('.head >> text=添加应用');
  await page.waitForTimeout(150);
  assert.ok(await page.locator('.list .row img').count() > 10, 'catalog icons loaded lazily');
  await page.locator('.row:not(.added)').nth(0).click();
  await page.locator('.row:not(.added)').nth(1).click();
  assert.strictEqual(await page.locator('#add-confirm').innerText(), '添加 2 个应用');
  await page.fill('#add-search', '注册');
  assert.strictEqual(await page.locator('.row').count(), 1);
  await page.fill('#add-search', '');
  await shot('add');
  await docShot('add');
  await page.click('#add-confirm');
  await page.waitForTimeout(100);
  assert.match(await page.locator('.toast').innerText(), /已添加 2 个应用/);

  // 8. 添加网址
  await page.click('.head >> text=添加应用');
  await page.click('text=网址或文件夹');
  await page.fill('#url-input', 'bilibili.com');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  assert.match(await page.locator('.toast').innerText(), /已添加 1 项/);
  await shot('after-url');

  // 9. 窄面板每行 7 个
  await openPanel(page, { panelWidth: 720 });
  await page.evaluate(() => { window.__w = 720; });
  await openPanel(page, { panelWidth: 720 });
  assert.strictEqual(await page.locator('.grid .tile').count(), 21);
  await shot('narrow');

  // 10. Esc 收起面板
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.evaluate(() => window.__hidden), true);

  await browser.close();
  assert.deepStrictEqual(errors, [], 'no errors in the page');
  console.log('ui test: all checks passed' + (DOCS ? ' (docs images updated)' : ''));
})().catch((e) => { console.error(e); process.exit(1); });
