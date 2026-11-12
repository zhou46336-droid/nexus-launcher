'use strict';

// 全局事件（键盘、滚轮翻页、拖入文件）和与主进程的同步。最后加载。
(function (NL) {
  const { api, S, panel, backdrop, cols, perPage, uiLog } = NL;

  backdrop.addEventListener('mousedown', () => {
    if (S.menu) NL.closeMenu();
    else api.hide();
  });

  document.addEventListener('mousedown', (e) => {
    if (S.menu && !S.menu.contains(e.target)) NL.closeMenu();
  }, true);

  // 滚轮翻页（一次滚动只翻一页）
  panel.addEventListener('wheel', (e) => {
    if (S.view !== 'main' || S.menu) return;
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 8) return;
    const now = Date.now();
    if (now - S.wheelAt < 350) return;
    S.wheelAt = now;
    NL.goPage(S.page + (d > 0 ? 1 : -1));
  }, { passive: true });

  function focusTile(i) {
    const tiles = Array.from(panel.querySelectorAll('.grid .tile:not(.add-slot)'));
    if (!tiles.length) return;
    tiles[Math.max(0, Math.min(i, tiles.length - 1))].focus();
  }

  // 键盘：Esc 逐级返回，方向键在图标间移动，PageUp/PageDown 翻页，F5 刷新
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (S.menu) NL.closeMenu();
      else if (S.view === 'add') NL.closeAdd();
      else if (S.view === 'settings') NL.closeSettings();
      else if (S.edit) NL.setEdit(false);
      else api.hide();
      return;
    }
    if (S.menu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = Array.from(S.menu.querySelectorAll('button:not([disabled])'));
        const i = items.indexOf(document.activeElement);
        const n = e.key === 'ArrowDown' ? i + 1 : i - 1;
        items[(n + items.length) % items.length].focus();
      }
      return;
    }
    if (S.view !== 'main') return;
    const t = e.target;
    if (t && t.matches && t.matches('input, textarea')) return;
    if (e.key === 'F5') { e.preventDefault(); NL.refresh(); return; }
    if (e.key === 'PageDown') { e.preventDefault(); NL.goPage(S.page + 1); return; }
    if (e.key === 'PageUp') { e.preventDefault(); NL.goPage(S.page - 1); return; }
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const tiles = Array.from(panel.querySelectorAll('.grid .tile:not(.add-slot)'));
    const idx = tiles.indexOf(document.activeElement);
    if (idx < 0) { focusTile(0); return; }
    if (e.key === 'ArrowRight') {
      if (idx + 1 < tiles.length) focusTile(idx + 1);
      else if (NL.goPage(S.page + 1)) focusTile(0);
    } else if (e.key === 'ArrowLeft') {
      if (idx > 0) focusTile(idx - 1);
      else if (NL.goPage(S.page - 1)) focusTile(perPage() - 1);
    } else if (e.key === 'ArrowDown') {
      focusTile(Math.min(idx + cols(), tiles.length - 1));
    } else {
      focusTile(Math.max(idx - cols(), 0));
    }
  });

  // 从资源管理器拖进来的文件 / 文件夹
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    panel.classList.add('dropping');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) panel.classList.remove('dropping');
  });
  document.addEventListener('drop', async (e) => {
    panel.classList.remove('dropping');
    if (!hasFiles(e)) { S.dragKey = null; return; }
    e.preventDefault();
    const paths = Array.from(e.dataTransfer.files).map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length) NL.afterAdd(await api.addPaths(paths), '没有添加：这些文件已经在启动台里了');
  });
  document.addEventListener('dragend', () => { S.dragKey = null; });

  // 悬停高光：把指针在按钮里的位置交给 CSS（每帧最多更新一次）
  const GLOW = '.btn, .icon-btn, .seg-btn, .mi, .tbtn, .tclose, .tile, .row';
  let glowEvent = null;
  document.addEventListener('pointermove', (e) => {
    if (!glowEvent) requestAnimationFrame(() => {
      const ev = glowEvent;
      glowEvent = null;
      const el = ev.target && ev.target.closest ? ev.target.closest(GLOW) : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', Math.round(ev.clientX - r.left) + 'px');
      el.style.setProperty('--my', Math.round(ev.clientY - r.top) + 'px');
    });
    glowEvent = e;
  }, { passive: true });

  /* ---------- 与主进程同步 ---------- */

  api.onMoved((rect) => { S.panelRect = rect; NL.positionBg(); });

  // 显示面板（播放弹出动画）
  function reveal() {
    clearTimeout(S.waitTimer);
    if (S.revealed) return;
    S.revealed = true;
    void panel.offsetWidth; // 先让底色在透明状态下变好，显示时不要再播一次渐变
    panel.classList.remove('waiting');
    panel.classList.remove('pop');
    void panel.offsetWidth;
    panel.classList.add('pop');
    panel.focus({ preventScroll: true });
  }

  // 打开面板：先渲染好内容但保持透明，等背景截图到了（或等待超时）再显示
  api.onOpen((data, rect, opts) => {
    opts = opts || {};
    S.bg = null;
    S.panelRect = rect || null;
    S.lateBgOk = opts.lateBgOk !== false;
    S.catalogIcons = null;
    if (data) S.data = data;
    S.view = 'main';
    S.edit = false;
    S.page = 0;
    S.addSel.clear();
    S.addQuery = '';
    NL.closeMenu();
    S.revealed = false;
    panel.classList.add('waiting');
    NL.render();
    clearTimeout(S.waitTimer);
    S.waitTimer = setTimeout(reveal, Number(opts.maxWait) || 300);
    if (opts.jumpToEnd) { S.page = NL.pageCount() - 1; NL.render(); }
    if (opts.toast) NL.showToast({ text: String(opts.toast), ms: 4000 });
    else if (data && Array.isArray(data.notice) && data.notice.length) {
      const names = data.notice.slice(0, 3).join('、') + (data.notice.length > 3 ? ' 等 ' + data.notice.length + ' 个' : '');
      NL.showToast({ text: '已自动添加新安装的应用：' + names, ms: 5000 });
    }
  });

  // 面板开着时，主进程发来的提示（例如把图标拖到「更多应用」上添加成功）
  api.onToast((text, jumpToEnd) => {
    if (jumpToEnd && S.view === 'main') { S.page = NL.pageCount() - 1; NL.render(); }
    NL.showToast({ text: String(text), ms: 4000 });
  });

  // 背景截图到了
  api.onBg((bg, rect) => {
    if (S.revealed && !S.lateBgOk) return; // 老系统上晚到的截图可能拍进了面板自己，不用
    const late = S.revealed;
    S.bg = bg || null;
    if (rect) S.panelRect = rect;
    try { NL.applyLook(); } catch (e) { uiLog('bg: ' + (e && e.message)); }
    if (late && S.bg) {
      const bgEl = document.getElementById('panel-bg');
      bgEl.classList.remove('fade-in');
      void bgEl.offsetWidth;
      bgEl.classList.add('fade-in');
    }
    reveal();
  });

  // 记录卡顿：界面一次忙超过 150ms 就写进日志，方便排查
  try {
    let lastLog = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < 150 || Date.now() - lastLog < 5000) continue;
        lastLog = Date.now();
        uiLog('long task ' + Math.round(e.duration) + 'ms view=' + S.view + (S.edit ? ' edit' : ''));
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch (_) {}

  api.onData((data) => { NL.setData(data); });

  api.getData().then(NL.setData);
})(window.NL);
