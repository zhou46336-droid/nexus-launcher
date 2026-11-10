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

  /* ---------- 与主进程同步 ---------- */

  api.onMoved((rect) => { S.panelRect = rect; NL.positionBg(); });

  api.onOpen((data, bg, rect) => {
    S.bg = bg || null;
    S.panelRect = rect || null;
    if (data) S.data = data;
    try { NL.positionBg(); } catch (e) { uiLog('positionBg: ' + (e && e.message)); }
    S.view = 'main';
    S.edit = false;
    S.page = 0;
    S.addSel.clear();
    S.addQuery = '';
    NL.closeMenu();
    NL.render();
    panel.classList.remove('pop');
    void panel.offsetWidth;
    panel.classList.add('pop');
    panel.focus({ preventScroll: true });
    if (data && Array.isArray(data.notice) && data.notice.length) {
      const names = data.notice.slice(0, 3).join('、') + (data.notice.length > 3 ? ' 等 ' + data.notice.length + ' 个' : '');
      NL.showToast({ text: '已自动添加新安装的应用：' + names, ms: 5000 });
    }
  });

  api.onData((data) => { NL.setData(data); });

  api.getData().then(NL.setData);
})(window.NL);
