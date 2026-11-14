'use strict';

// 固定配置：尺寸、默认设置、文件位置
const path = require('path');
const os = require('os');

const APP_ROOT = path.join(__dirname, '..');

// 面板尺寸，窗口四周留出透明区域放阴影和撤销提示
const PANEL_H = 500;
const TOP_SPACE = 76;
const PAD = 20;

const DEFAULT_LOOK = {
  blur: 14, panelAlpha: 0.6, panelWidth: 800, bottomOffset: 180,
  accent: '#7CC7FF', glass: true, glassStrength: 40,
  bgMode: 'static'          // 背景渲染：static 打开时截一张图；live 面板开着时实时捕获后面的画面
};

module.exports = {
  APP_ROOT,
  // Windows 10 2004（内部版本 19041）起可以把窗口排除在截图 / 录屏之外：
  // 静态截图时面板可以先显示；实时渲染靠它避免把面板自己录进去
  CAN_EXCLUDE_FROM_CAPTURE: process.platform === 'win32' && Number(String(os.release()).split('.')[2] || 0) >= 19041,
  LIVE_FPS: 60,
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
  DEFAULT_SETTINGS: Object.assign({ hotkey: 'Alt+Q', autostart: true, autoAdd: true }, DEFAULT_LOOK),
  SETTINGS_VERSION: 2,

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
