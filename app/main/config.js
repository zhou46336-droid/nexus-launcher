'use strict';

// 固定配置：尺寸、默认设置、文件位置
const path = require('path');
const os = require('os');

const APP_ROOT = path.join(__dirname, '..');

// 面板尺寸，窗口四周留出透明区域放阴影和撤销提示
const PANEL_H = 500;
const TOP_SPACE = 76;
const PAD = 20;

// 配色方案（仿 Android Material You「壁纸与风格」里的拼色主题）：
// 每套由一个 Google 色当种子，按 Tonal Spot 规则得到三种颜色，都取深色模式用的色调 80：
//   primary 主色（按钮、开关、滑杆、焦点）
//   secondary 次要色（同色相、低饱和；选中的行、标签）
//   tertiary 第三色（色相转 60°；新应用圆点、提示条）
//   onPrimary 主色按钮上的文字（同色相的深色，色调 20）
//   swatch 设置里拼色圆的三块：上半主色、左下次要色（色调 35）、右下第三色（色调 70）
const SCHEMES = [
  { id: 'blue', name: '谷歌蓝', primary: '#A8C7FA', secondary: '#BAC7E0', tertiary: '#E8B8DD', onPrimary: '#062E6F', swatch: ['#A8C7FA', '#465368', '#CB9DC1'] },
  { id: 'green', name: '谷歌绿', primary: '#6DD58C', secondary: '#B4CDB9', tertiary: '#81D3DD', onPrimary: '#073A1A', swatch: ['#6DD58C', '#425747', '#65B8C2'] },
  { id: 'yellow', name: '谷歌黄', primary: '#F5C658', secondary: '#D3C5AD', tertiary: '#A7D1AA', onPrimary: '#3F2E01', swatch: ['#F5C658', '#5C513C', '#8CB58F'] },
  { id: 'red', name: '谷歌红', primary: '#F2B8B5', secondary: '#E2BEBC', tertiary: '#DCC396', onPrimary: '#601410', swatch: ['#F2B8B5', '#694B49', '#C0A87C'] },
  { id: 'purple', name: '紫', primary: '#E0B7FD', secondary: '#D0C1D9', tertiary: '#F8B5BC', onPrimary: '#41215B', swatch: ['#E0B7FD', '#5A4E63', '#DB9AA1'] },
  { id: 'cyan', name: '青', primary: '#50D7EE', secondary: '#A6CDD6', tertiary: '#B1C7F6', onPrimary: '#02363E', swatch: ['#50D7EE', '#32585F', '#95ABDA'] },
  { id: 'pink', name: '粉', primary: '#FFB0D1', secondary: '#DFBECB', tertiary: '#F1BBA1', onPrimary: '#5C1135', swatch: ['#FFB0D1', '#674B56', '#D4A087'] },
  { id: 'orange', name: '橙', primary: '#FFB689', secondary: '#DDC1B1', tertiary: '#C1CC9B', onPrimary: '#4D2600', swatch: ['#FFB689', '#654E40', '#A5B081'] }
];
const SCHEME_IDS = SCHEMES.map((s) => s.id);

// 旧版「强调色」→ 最接近的配色方案（升级时自动换过去）
const OLD_ACCENT_TO_SCHEME = {
  '#7cc7ff': 'blue', '#a5b4ff': 'purple', '#7ee0c3': 'green', '#ffb86b': 'orange', '#ff9ec0': 'pink', '#e8ecf3': 'blue'
};

const DEFAULT_LOOK = {
  blur: 14, panelAlpha: 0.6, panelWidth: 800, bottomOffset: 180,
  scheme: 'blue', glass: true, glassStrength: 40,
  textHalo: true,           // 文字光晕：字边缘一圈向外渐淡的黑色，透明度高时也看得清
  bgMode: 'static',         // 背景渲染：static 打开时截一张图；live 面板开着时实时捕获后面的画面
  liveFps: 60               // 实时渲染的刷新率（帧/秒），只能是 LIVE_FPS_CHOICES 里的值
};

module.exports = {
  APP_ROOT,
  // Windows 10 2004（内部版本 19041）起可以把窗口排除在截图 / 录屏之外：
  // 静态截图时面板可以先显示；实时渲染靠它避免把面板自己录进去
  CAN_EXCLUDE_FROM_CAPTURE: process.platform === 'win32' && Number(String(os.release()).split('.')[2] || 0) >= 19041,
  LIVE_FPS_CHOICES: [30, 60, 120],
  APP_NAME: 'NexusLauncher',
  AUMID: 'NexusLauncher.MoreApps',
  SHORTCUT_NAME: '更多应用.lnk',
  APP_ICON: path.join(APP_ROOT, 'assets', 'app-icon.ico'),
  TRAY_ICON: path.join(APP_ROOT, 'assets', 'tray.png'),
  SCRIPTS_DIR: path.join(APP_ROOT, 'scripts'),
  RENDERER_HTML: path.join(APP_ROOT, 'renderer', 'index.html'),
  PRELOAD: path.join(APP_ROOT, 'preload.js'),
  // 图标设计换新时加 1：桌面和开始菜单的快捷方式会自动换成新图标
  ICON_VERSION: 6,

  PANEL_H,
  TOP_SPACE,
  PAD,
  WIN_H: PANEL_H + TOP_SPACE + PAD,
  PANEL_WIDTHS: [720, 800, 960],
  WIDTHS: [['窄', 720], ['适中', 800], ['宽', 960]],
  BLURS: [['关闭（直接透出桌面）', 0], ['轻', 6], ['中', 14], ['强', 24]],

  DEFAULT_LOOK,
  // cleanDesktop：桌面快捷方式拖进来后，把桌面上那个移到回收站（托盘菜单里可关）
  DEFAULT_SETTINGS: Object.assign({ hotkey: 'Alt+Q', autostart: true, autoAdd: true, cleanDesktop: true }, DEFAULT_LOOK),
  SETTINGS_VERSION: 3,
  SCHEMES,
  SCHEME_IDS,
  OLD_ACCENT_TO_SCHEME,

  // 卸载程序、说明文档之类不算「应用」
  JUNK: /(卸载|uninstall|readme|read me|help|帮助|support center|支持中心|website|官网|license|许可|release notes|documentation|手册|translator helper)/i,
  // 首次启动时不自动放进启动台的系统工具目录（之后可以在「添加应用」里手动加）
  SYS_DIRS: /\\(administrative tools|accessibility|maintenance|startup|system tools|windows powershell)\\/i,
  SELF: /nexuslauncher/i,

  // 打开面板时，距离上次扫描超过这么久才顺带再扫一次（平时靠监听开始菜单变化）
  RESCAN_ON_OPEN_MS: 10 * 60 * 1000,
  // Microsoft Store 应用不在开始菜单文件夹里，定时检查一次
  RESCAN_INTERVAL_MS: 30 * 60 * 1000
};
