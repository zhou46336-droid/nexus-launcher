'use strict';

// 主界面：最近 / 常用、全部应用（分页）、编辑模式，以及右键菜单
(function (NL) {
  const { api, S, h, svg, tileIcon, showToast, cols, perPage, pageCount, panel, content } = NL;

  function setData(d) {
    if (d) S.data = d;
    if (S.page >= pageCount()) S.page = pageCount() - 1;
    render();
  }

  function render() {
    const st = S.data.settings || {};
    panel.style.setProperty('--w', (Number(st.panelWidth) || 800) + 'px');
    panel.style.setProperty('--cols', String(cols()));
    NL.applyLook();
    const searchFocused = document.activeElement && document.activeElement.id === 'add-search';
    content.replaceChildren(S.view === 'add' ? NL.renderAdd() : S.view === 'settings' ? NL.renderSettings() : renderMain());
    if (searchFocused) {
      const s = document.getElementById('add-search');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }
  }

  function segBtn(id, label) {
    return h('button', {
      class: 'seg-btn' + (S.tab === id ? ' on' : ''),
      'aria-pressed': S.tab === id ? 'true' : 'false',
      onclick: () => { S.tab = id; render(); }
    }, label);
  }

  function renderMain() {
    const d = S.data;
    const frag = document.createDocumentFragment();

    const left = S.edit
      ? h('div', { class: 'hl' },
        h('span', { class: 'chip', text: '编辑模式' }),
        h('span', { class: 'hint', text: '点 − 移除（不会卸载）· 拖动排序' }))
      : h('div', { class: 'seg', role: 'group', 'aria-label': '最近与常用' },
        segBtn('recent', '最近使用'), segBtn('frequent', '最常用'));
    const right = h('div', { class: 'hr' },
      S.edit ? null : h('span', { class: 'esc' }, h('kbd', { text: 'Esc' }), '关闭'),
      S.edit ? null : h('button', {
        class: 'icon-btn' + (S.refreshing ? ' spinning' : ''),
        'aria-label': '刷新应用列表', title: '刷新应用列表（F5）',
        disabled: S.refreshing ? true : null,
        onclick: refresh
      }, svg('refresh', 16)),
      S.edit ? h('button', { class: 'btn', onclick: NL.openSettings }, svg('sliders', 16), '外观') : null,
      h('button', { class: 'btn', onclick: NL.openAdd }, svg('plus', 16), '添加应用'),
      S.edit
        ? h('button', { class: 'btn primary', onclick: () => setEdit(false) }, '完成')
        : h('button', { class: 'btn', onclick: () => setEdit(true) }, svg('edit', 16), '编辑'));
    frag.append(h('header', { class: 'head' }, left, right));

    // 最近使用 / 最常用
    const byKey = new Map(d.items.map((i) => [i.key, i]));
    const keys = (S.tab === 'recent' ? d.recent : d.frequent).slice(0, cols());
    const stripItems = keys.map((k) => byKey.get(k)).filter(Boolean);
    const strip = h('div', { class: 'strip' + (S.edit ? ' dim' : '') });
    if (stripItems.length === 0) {
      strip.append(h('div', {
        class: 'strip-empty',
        text: S.tab === 'recent'
          ? '从启动台打开过的应用会显示在这里'
          : '打开次数多的应用会自动排在这里，也可以右键图标「固定到最常用」'
      }));
    } else {
      for (const it of stripItems) strip.append(tile(it, 44, 'strip'));
    }
    frag.append(strip);

    // 全部应用
    const pages = pageCount();
    if (S.page >= pages) S.page = pages - 1;
    frag.append(h('div', { class: 'row-title' },
      h('h2', { text: '全部应用' }),
      h('span', { class: 'count', text: d.loading ? '正在读取开始菜单里的应用…' : d.items.length + ' 个' })));

    const grid = h('div', { class: 'grid' });
    const slice = d.items.slice(S.page * perPage(), (S.page + 1) * perPage());
    for (const it of slice) grid.append(tile(it, 52, 'grid'));
    if (S.edit && S.page === pages - 1 && slice.length < perPage()) {
      grid.append(h('button', { class: 'tile add-slot', onclick: NL.openAdd },
        h('span', { class: 'tile-ic', style: 'width:52px;height:52px' }, svg('plus', 22)),
        h('span', { class: 'name', text: '添加' })));
    }
    if (!d.loading && d.items.length === 0) {
      grid.append(h('div', { class: 'grid-empty', text: '启动台是空的，点右上角「添加应用」把常用软件放进来' }));
    }
    frag.append(grid);

    // 分页圆点（编辑时可以把图标拖到圆点上翻页）
    const dots = h('div', { class: 'dots' });
    if (pages > 1) {
      for (let i = 0; i < pages; i++) {
        const dot = h('button', {
          class: 'dot' + (i === S.page ? ' on' : ''),
          'aria-label': '第 ' + (i + 1) + ' 页',
          'aria-current': i === S.page ? 'page' : null,
          onclick: () => goPage(i)
        }, h('span'));
        dot.addEventListener('dragover', (e) => {
          if (!S.dragKey) return;
          e.preventDefault();
          if (S.page !== i) goPage(i);
        });
        dot.addEventListener('drop', (e) => {
          if (!S.dragKey) return;
          e.preventDefault();
          const first = d.items[i * perPage()];
          moveItem(S.dragKey, first ? first.key : '__end__');
        });
        dots.append(dot);
      }
    }
    frag.append(dots);
    return frag;
  }

  function tile(it, size, where) {
    const editing = S.edit && where === 'grid';
    const el = h(editing ? 'div' : 'button', {
      class: 'tile' + (editing ? ' editing' : ''),
      'data-key': it.key,
      title: it.name,
      tabindex: editing ? '0' : null
    });
    const ic = tileIcon(it, size);
    el.append(ic, h('span', { class: 'name' + (it.isNew ? ' new' : ''), text: it.name, title: it.isNew ? '新安装' : null }));

    if (editing) {
      ic.append(h('button', {
        class: 'minus',
        'aria-label': '从启动台移除 ' + it.name,
        onclick: (e) => { e.stopPropagation(); removeItem(it.key); }
      }, svg('minus', 10)));
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        S.dragKey = it.key;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', it.key);
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => { S.dragKey = null; el.classList.remove('dragging'); });
      el.addEventListener('dragover', (e) => {
        if (S.dragKey && S.dragKey !== it.key) { e.preventDefault(); el.classList.add('drop-target'); }
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
      el.addEventListener('drop', (e) => {
        el.classList.remove('drop-target');
        if (!S.dragKey) return;
        e.preventDefault();
        if (S.dragKey !== it.key) moveItem(S.dragKey, it.key);
      });
    } else {
      el.addEventListener('click', () => api.launch(it.key));
    }
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(it, e.clientX, e.clientY); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Delete') { e.preventDefault(); removeItem(it.key); }
      else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        openMenu(it, r.left + r.width / 2, r.top + r.height / 2);
      }
    });
    return el;
  }

  /* ---------- 操作 ---------- */

  async function refresh() {
    if (S.refreshing) return;
    S.refreshing = true;
    render();
    let res = null;
    try { res = await api.rescan(); } catch (_) { res = null; }
    S.refreshing = false;
    if (res && res.data) S.data = res.data;
    if (S.page >= pageCount()) S.page = pageCount() - 1;
    render();
    if (!res) { showToast({ text: '刷新失败，请稍后再试', ms: 3000 }); return; }
    if (res.added && res.added.length) {
      const names = res.added.slice(0, 3).join('、') + (res.added.length > 3 ? ' 等 ' + res.added.length + ' 个' : '');
      showToast({ text: '已刷新，新增：' + names, ms: 4000 });
    } else {
      showToast({ text: '已刷新，没有发现新安装的应用', ms: 2500 });
    }
  }

  function goPage(p) {
    if (p < 0 || p >= pageCount() || p === S.page) return false;
    S.page = p;
    render();
    return true;
  }

  function setEdit(v) {
    S.edit = v;
    closeMenu();
    render();
  }

  async function moveItem(src, dst) {
    S.dragKey = null;
    setData(await api.move(src, dst));
  }

  async function removeItem(key) {
    const it = S.data.items.find((i) => i.key === key);
    if (!it) return;
    closeMenu();
    const index = await api.remove(key);
    S.data.items = S.data.items.filter((i) => i.key !== key);
    S.data.recent = S.data.recent.filter((k) => k !== key);
    S.data.frequent = S.data.frequent.filter((k) => k !== key);
    for (const c of S.data.catalog) if (c.key === key) c.added = false;
    setData();
    showToast({ item: it, text: '已从启动台移除「' + it.name + '」', undo: { key, index }, ms: 5000 });
  }

  /* ---------- 右键菜单 ---------- */

  function openMenu(it, x, y) {
    closeMenu();
    const m = h('div', { class: 'menu', role: 'menu', 'aria-label': it.name });
    const add = (icon, label, fn, opt) => {
      opt = opt || {};
      m.append(h('button', {
        class: 'mi' + (opt.danger ? ' danger' : ''),
        role: 'menuitem',
        disabled: opt.disabled ? true : null,
        onclick: () => { closeMenu(); fn(); }
      }, svg(icon, 16), h('span', { class: 'ml', text: label }), opt.key ? h('span', { class: 'mk', text: opt.key }) : null));
    };
    add('open', '打开', () => api.launch(it.key), { key: 'Enter' });
    add('shield', '以管理员身份运行', () => api.runAsAdmin(it.key), { disabled: !it.hasPath });
    add('folder', '打开文件所在位置', () => api.openLocation(it.key), { disabled: !it.hasPath });
    add('pin', it.pinned ? '从「最常用」取消固定' : '固定到「最常用」', async () => setData(await api.togglePin(it.key)));
    add('image', '导出高清图标（给 Nexus 用）', async () => {
      showToast({ text: '正在导出「' + it.name + '」的高清图标…', ms: 3000 });
      const r = await api.exportIcon(it.key);
      if (!r || !r.ok) showToast({ text: (r && r.error) || '导出失败', ms: 4000 });
    }, { disabled: it.kind === 'url' });
    m.append(h('div', { class: 'sep' }));
    add('remove', '从启动台移除', () => removeItem(it.key), { danger: true, key: 'Delete' });
    if (it.kind === 'app') add('trash', '卸载应用…', () => api.uninstall(it.key));
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    S.menu = m;
    const first = m.querySelector('button:not([disabled])');
    if (first) first.focus();
  }

  function closeMenu() {
    if (S.menu) { S.menu.remove(); S.menu = null; }
  }

  Object.assign(NL, { setData, render, refresh, goPage, setEdit, closeMenu });
})(window.NL);
