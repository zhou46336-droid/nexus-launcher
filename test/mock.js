(function () {
  // 通用的常见应用名，只用于测试和截图
  const names = ['Access','Blender','Discord','Excel','Firefox','GIMP','Google Chrome','Microsoft Edge','Microsoft Store','Notion','OBS Studio','OneDrive','OneNote','Outlook','PowerPoint','Spotify','Steam','VLC','Visual Studio Code','Word','Zoom','便笺','画图','计算器','记事本','截图工具','控制面板','任务管理器','设置','时钟','文件资源管理器','网易云音乐','相机','照片','命令提示符','远程桌面连接','Windows PowerShell','媒体播放器','磁盘清理','注册表编辑器'];
  const colors = ['#3E83EA','#1FA0AE','#D9A23A','#CF7650','#5468E0','#2FB18A','#2E6BD1','#2F9E5F','#D9603C','#8457D9','#B8394F','#1E8C82','#D9497E','#3A4A66','#9B4FD0','#5E9E2E'];
  function fakeIcon(i, n) {
    const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d');
    g.fillStyle = colors[i % colors.length];
    const r = 22; g.beginPath(); g.moveTo(8 + r, 8); g.arcTo(88, 8, 88, 88, r); g.arcTo(88, 88, 8, 88, r); g.arcTo(8, 88, 8, 8, r); g.arcTo(8, 8, 88, 8, r); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n[0], 48, 52);
    return c.toDataURL();
  }
  const catalog = names.map((n, i) => ({ key: 'app:' + i, name: n, icon: i % 7 === 3 ? null : fakeIcon(i, n), path: 'C:\\Program Files\\' + n + '\\app.exe', added: false }));
  let order = catalog.slice(0, 30).map(c => c.key);
  const custom = {};
  let usage = { 'app:2': { count: 9, last: 9 }, 'app:5': { count: 5, last: 8 }, 'app:28': { count: 3, last: 7 }, 'app:15': { count: 2, last: 6 }, 'app:14': { count: 6, last: 5 }, 'app:29': { count: 1, last: 4 }, 'app:16': { count: 4, last: 3 }, 'app:8': { count: 1, last: 2 } };
  let pinned = [];
  const byKey = () => new Map(catalog.map(c => [c.key, c]));
  function data() {
    const m = byKey();
    const items = order.map(k => { const c = m.get(k) || custom[k]; return c ? { key: k, name: c.name, icon: c.icon, kind: custom[k] ? custom[k].kind : 'app', hasPath: true, pinned: pinned.includes(k) } : null; }).filter(Boolean);
    const shown = new Set(order);
    const used = Object.keys(usage).filter(k => shown.has(k));
    const recent = used.slice().sort((a, b) => usage[b].last - usage[a].last).slice(0, 8);
    const freq = pinned.concat(used.filter(k => !pinned.includes(k)).sort((a, b) => usage[b].count - usage[a].count)).slice(0, 8);
    return { items, recent, frequent: freq, catalog: catalog.map(c => Object.assign({}, c, { icon: null, added: shown.has(c.key) })), loading: false, settings: Object.assign({ hotkey: 'Alt+Q', panelAlpha: 0.6, blur: window.__blur || 14, panelWidth: window.__w || 800, bottomOffset: 180, accent: '#7CC7FF', glass: true, glassStrength: 30, bgMode: 'static', liveSupported: true, liveFps: 60, cols: (window.__w || 800) < 780 ? 7 : 8 }, window.__set || {}) };
  }
  window.__mock = { data, setOrder: (o) => { order = o; } };
  window.launcher = {
    getData: async () => data(),
    launch: async (k) => { window.__launched = k; },
    remove: async (k) => { const i = order.indexOf(k); if (i >= 0) order.splice(i, 1); return i; },
    restore: async (k, i) => { if (!order.includes(k)) order.splice(i, 0, k); return data(); },
    move: async (s, d) => { const f = order.indexOf(s); order.splice(f, 1); const t = d === '__end__' ? -1 : order.indexOf(d); if (t < 0) order.push(s); else order.splice(t + (f <= t ? 1 : 0), 0, s); return data(); },
    add: async (keys) => { keys.forEach(k => { if (!order.includes(k)) order.push(k); }); return data(); },
    addPaths: async () => ({ added: 0, data: data() }),
    addUrl: async (u, n) => { const k = 'url:' + u; custom[k] = { name: n || u, kind: 'url', icon: null }; order.push(k); return { added: 1, data: data() }; },
    pickFiles: async () => ({ added: 0, data: data() }),
    pickFolder: async () => ({ added: 0, data: data() }),
    togglePin: async (k) => { const i = pinned.indexOf(k); if (i >= 0) pinned.splice(i, 1); else pinned.unshift(k); return data(); },
    runAsAdmin: async () => {}, openLocation: async () => {}, uninstall: async () => {},
    hide: () => { window.__hidden = true; },
    setSetting: async (k, v) => { window.__set = Object.assign(window.__set || {}, k === 'reset' ? {} : { [k]: v }); if (k === 'panelWidth') { window.__w = v; } return data(); },
    onMoved: (cb) => { window.__moved = cb; },
    rescan: () => new Promise(r => setTimeout(() => r({ added: ['Blender'], data: data() }), 800)),
    pathForFile: () => '',
    onOpen: (cb) => { window.__open = cb; },
    onBg: (cb) => { window.__bg = cb; },
    onToast: (cb) => { window.__toast = cb; },
    onClear: (cb) => { window.__clear = cb; },
    cleared: (t) => { window.__cleared = t; },
    getCatalog: async () => { const shown = new Set(order); return catalog.map(c => Object.assign({}, c, { added: shown.has(c.key) })); },
    log: (m) => (/^live fps/.test(m) ? console.log : console.error)('[uilog] ' + m),
    // 主进程只在实时模式下给屏幕编号
    captureSource: async () => ((window.__set || {}).bgMode === 'live' ? { id: 'screen:0:0' } : null),
    exportIcon: async () => ({ ok: true }),
    onData: (cb) => { window.__onData = cb; }
  };
})();
