'use strict';

/* 界面的公共部分：状态、DOM 小工具、图标、提示条。
   界面脚本按 index.html 里的顺序加载，彼此通过 window.NL 共享函数。 */
(function () {
  const NL = (window.NL = {});
  const api = window.launcher;

  // 界面出错时把错误交给主进程记日志
  const uiLog = (msg) => { try { if (api.log) api.log(String(msg).slice(0, 300)); } catch (_) {} };
  window.addEventListener('error', (e) => uiLog('error: ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', (e) => uiLog('promise: ' + (e.reason && (e.reason.message || e.reason))));

  const S = {
    data: { items: [], recent: [], frequent: [], catalog: [], loading: true, settings: { hotkey: 'Alt+Q', panelAlpha: 0.6 } },
    view: 'main',        // main | add | settings
    edit: false,
    tab: 'recent',       // recent | frequent
    page: 0,
    addTab: 'installed', // installed | file | url
    addSel: new Set(),
    addQuery: '',
    toast: null,
    menu: null,
    dragKey: null,
    wheelAt: 0,
    refreshing: false,
    bg: null,            // 面板后方的截图
    panelRect: null      // 面板在屏幕上的位置
  };

  const cols = () => (S.data.settings && S.data.settings.cols) || 8;
  const perPage = () => cols() * 3;
  const pageCount = () => Math.max(1, Math.ceil(S.data.items.length / perPage()));

  /* ---------- DOM 小工具 ---------- */

  // h('button', { class: 'btn', onclick: fn }, '文字', child…)
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      for (const c of [].concat(arguments[i])) {
        if (c === null || c === undefined || c === false) continue;
        el.append(c.nodeType ? c : document.createTextNode(String(c)));
      }
    }
    return el;
  }

  const ICONS = {
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="9" r="1.8"/><path d="m21 15-4.5-4.5L6 21"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v4M8 3h8l-1 6 3 4H6l3-4z"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
    folderWhite: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
  };

  function svg(name, size) {
    const t = document.createElement('template');
    t.innerHTML = ICONS[name];
    const el = t.content.firstElementChild;
    el.setAttribute('width', String(size || 16));
    el.setAttribute('height', String(size || 16));
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  /* ---------- 应用图标 ---------- */

  const PALETTE = ['#3E83EA', '#1FA0AE', '#C98A1F', '#CF7650', '#5468E0', '#23A07C', '#2E6BD1', '#2F9E5F',
    '#D9603C', '#8457D9', '#B8394F', '#1E8C82', '#D9497E', '#3A4A66', '#9B4FD0', '#5E9E2E'];
  function colorFor(s) {
    let x = 0;
    for (const ch of String(s)) x = (x * 31 + ch.codePointAt(0)) >>> 0;
    return PALETTE[x % PALETTE.length];
  }
  function firstChar(s) {
    const m = String(s).trim().match(/[\p{L}\p{N}]/u);
    return m ? m[0].toUpperCase() : '?';
  }

  function tileIcon(item, size) {
    const box = h('span', { class: 'tile-ic', style: 'width:' + size + 'px;height:' + size + 'px' });
    if (item.icon) {
      const pct = item.iconScale ? Math.round(item.iconScale * 100) : 100;
      box.append(h('img', { src: item.icon, alt: '', draggable: 'false', style: 'width:' + pct + '%;height:' + pct + '%' }));
    } else {
      // 没有图标时画一个和真实图标差不多大的色块
      const face = h('span', { class: 'face' });
      if (item.kind === 'url' || item.kind === 'folder') {
        face.style.background = item.kind === 'url' ? 'linear-gradient(180deg,#3E83EA,#2560C9)' : 'linear-gradient(180deg,#D9A23A,#B07A16)';
        face.append(svg(item.kind === 'url' ? 'globe' : 'folderWhite', Math.round(size * 0.46)));
      } else {
        face.style.background = colorFor(item.name);
        face.append(h('span', { class: 'letter', style: 'font-size:' + Math.round(size * 0.38) + 'px', text: firstChar(item.name) }));
      }
      box.append(face);
    }
    return box;
  }

  /* ---------- 提示条（可带「撤销」） ---------- */

  const toastLayer = document.getElementById('toast-layer');

  function showToast(t) {
    if (S.toast && S.toast.timer) clearTimeout(S.toast.timer);
    S.toast = t;
    t.timer = setTimeout(() => { if (S.toast === t) { S.toast = null; renderToast(); } }, t.ms || 4000);
    renderToast();
  }

  function renderToast() {
    toastLayer.replaceChildren();
    const t = S.toast;
    if (!t) return;
    const el = h('div', { class: 'toast', role: 'status' });
    if (t.item) el.append(tileIcon(t.item, 30));
    el.append(h('span', { text: t.text }));
    if (t.undo) el.append(h('button', { class: 'tbtn', onclick: doUndo }, '撤销'));
    el.append(h('button', {
      class: 'tclose', 'aria-label': '关闭提示',
      onclick: () => { clearTimeout(t.timer); S.toast = null; renderToast(); }
    }, svg('close', 14)));
    if (t.undo) el.append(h('span', { class: 'tbar', style: 'animation-duration:' + (t.ms || 5000) + 'ms' }));
    toastLayer.append(el);
  }

  async function doUndo() {
    const t = S.toast;
    if (!t || !t.undo) return;
    clearTimeout(t.timer);
    S.toast = null;
    renderToast();
    NL.setData(await api.restore(t.undo.key, t.undo.index));
  }

  Object.assign(NL, {
    api, uiLog, S, cols, perPage, pageCount, h, svg, tileIcon, showToast,
    panel: document.getElementById('panel'),
    content: document.getElementById('content'),
    panelBg: document.getElementById('panel-bg'),
    backdrop: document.getElementById('backdrop')
  });
})();
