'use strict';

// 各模块共享的运行时状态（整个程序只有这一份）
module.exports = {
  dev: false,              // 开发模式：文件变动自动重启、额外的排查日志
  paths: { userDir: '', statePath: '', catalogPath: '', iconDir: '' },
  state: null,             // 用户数据（state.json）
  catalog: [],             // 扫描到的已安装应用
  catalogMap: new Map(),
  win: null,
  tray: null,
  scanning: false,
  rescanPending: false,
  lastScan: 0,
  quitting: false,
  suppressBlur: false,     // 弹出文件选择框时不要因为失焦而收起面板
  lastBlurHide: 0,
  lastDropAt: 0            // 最近一次有东西拖进面板的时间
};
