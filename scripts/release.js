// 一键发版脚本：改版本号 → 跑测试 → 提交 → 推送 → 打标签并推送
// 用法：双击项目根目录的 release.cmd，或在项目根目录运行 node scripts/release.js
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'app', 'package.json');
const REPO_URL = 'https://github.com/zhou46336-droid/nexus-launcher';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q) => {
  process.stdout.write(q);
  const { value } = await lines.next();
  return (value || '').trim();
};

// 运行命令；inherit 表示把输出直接显示在窗口里，capture 表示只取结果
function run(cmd, args, capture = false) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32' && cmd === 'npm', // npm 在 Windows 上是 npm.cmd
  });
  return { ok: r.status === 0, out: (r.stdout || '').trim() };
}

function fail(msg) {
  console.error('\n❌ ' + msg);
  rl.close();
  process.exit(1);
}

// 版本号比较：a 比 b 大返回 1，小返回 -1，相同返回 0
function compare(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (x[i] > y[i]) return 1;
    if (x[i] < y[i]) return -1;
  }
  return 0;
}

async function main() {
  const original = fs.readFileSync(PKG, 'utf8');
  const match = original.match(/"version"\s*:\s*"(\d+\.\d+\.\d+)"/);
  if (!match) fail('没在 app/package.json 里找到版本号');
  const current = match[1];

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], true).out;
  if (branch !== 'main') fail(`当前在 ${branch} 分支，请先切回 main 再发版`);

  console.log(`\n当前版本：${current}`);
  const [maj, min, pat] = current.split('.').map(Number);
  console.log(`  小改动（修 bug）建议：${maj}.${min}.${pat + 1}`);
  console.log(`  新功能建议：${maj}.${min + 1}.0\n`);

  const version = await ask('请输入新版本号（例如 1.2.0）：');
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail('版本号格式不对，要像 1.2.0 这样，三段数字');
  if (compare(version, current) <= 0) fail(`新版本号必须比当前的 ${current} 大`);

  const tag = 'v' + version;
  if (run('git', ['tag', '-l', tag], true).out) fail(`本地已经有 ${tag} 标签了`);
  const remoteTag = run('git', ['ls-remote', '--tags', 'origin', tag], true);
  if (!remoteTag.ok) fail('连不上 GitHub，请检查网络后重试');
  if (remoteTag.out) fail(`GitHub 上已经有 ${tag} 标签了`);

  const desc = await ask('用一句话写这次更新了什么（例如 新增动态壁纸实时背景选项）：');
  if (!desc) fail('更新说明不能为空');
  const message = `${tag}：${desc}`;

  console.log('\n当前有改动的文件：');
  const status = run('git', ['status', '-s'], true).out;
  console.log(status || '（没有）');
  console.log('\n提示：只会提交"已经被 git 管理的文件"的改动，新建的文件不会被自动提交。');
  const readme = await ask('README 里功能说明改好了吗？(y/n) ');
  if (readme.toLowerCase() !== 'y') fail('请先更新 README 再发版');
  const ok = await ask(`\n确认发布 ${tag} 吗？提交说明：${message} (y/n) `);
  if (ok.toLowerCase() !== 'y') fail('已取消，什么都没有改');

  // 1. 改版本号（只替换版本号这一处，其它格式不变）
  fs.writeFileSync(PKG, original.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${version}$2`));
  console.log(`\n① 版本号已改为 ${version}`);

  // 2. 跑测试；失败就把版本号改回去，不提交
  console.log('② 正在跑测试……');
  if (!run('npm', ['test']).ok) {
    fs.writeFileSync(PKG, original);
    fail('测试没通过，版本号已改回去，没有提交。请先修好问题。');
  }

  // 3. 提交（-u：只加入已被 git 管理的文件的改动）
  console.log('③ 正在提交……');
  if (!run('git', ['add', '-u']).ok) fail('git add 失败');
  if (!run('git', ['commit', '-m', message]).ok) fail('git commit 失败');

  // 4. 推送代码，再打标签并推送；每一步失败都告诉你接下来手动做什么
  console.log('④ 正在推送到 GitHub……');
  if (!run('git', ['push']).ok) {
    fail(`推送失败。提交已经存在本地，网络好了以后手动运行：\n   git push && git tag ${tag} && git push origin ${tag}`);
  }
  if (!run('git', ['tag', tag]).ok) fail(`打标签失败，请手动运行：git tag ${tag} && git push origin ${tag}`);
  if (!run('git', ['push', 'origin', tag]).ok) {
    fail(`标签推送失败，请手动运行：git push origin ${tag}`);
  }

  console.log(`\n✅ 完成！代码和标签 ${tag} 都已经推送到 GitHub。`);
  console.log('\n还差最后一步：发布 Release（让别人能下载安装包）');
  console.log('  1. 运行 scripts/build.sh 打包，得到 dist/NexusLauncher-Setup-' + version + '.exe');
  console.log(`  2. 打开 ${REPO_URL}/releases/new?tag=${tag}`);
  console.log('  3. 写几句更新说明，把 exe 拖进去，点 Publish release\n');
  rl.close();
}

main().catch((e) => fail(String(e && e.message ? e.message : e)));
