'use strict';

// 「添加应用」页：从已安装的应用里勾选、浏览文件、添加网址或文件夹
(function (NL) {
  const { api, S, h, svg, tileIcon, showToast, pageCount } = NL;

  function openAdd() {
    NL.closeMenu();
    S.view = 'add';
    S.addTab = 'installed';
    S.addSel.clear();
    S.addQuery = '';
    NL.render();
    const s = document.getElementById('add-search');
    if (s) s.focus();
    loadCatalogIcons();
  }

  // 已安装应用的图标比较多，只在进入「添加应用」时向主进程要一次
  async function loadCatalogIcons() {
    if (S.catalogIcons || !api.getCatalog) return;
    let list = [];
    try { list = await api.getCatalog(); } catch (_) { list = []; }
    S.catalogIcons = new Map(list.filter((c) => c.icon).map((c) => [c.key, c.icon]));
    const el = document.querySelector('.list');
    if (el && S.view === 'add' && S.addTab === 'installed') fillList(el);
  }

  function closeAdd() {
    S.view = 'main';
    S.addSel.clear();
    NL.render();
  }

  function addTabBtn(id, icon, label) {
    return h('button', {
      class: 'seg-btn' + (S.addTab === id ? ' on' : ''),
      role: 'tab',
      'aria-selected': S.addTab === id ? 'true' : 'false',
      onclick: () => { S.addTab = id; NL.render(); }
    }, svg(icon, 14), label);
  }

  function renderAdd() {
    const frag = document.createDocumentFragment();
    frag.append(h('div', { class: 'add-head' },
      h('button', { class: 'icon-btn', 'aria-label': '返回启动台', onclick: closeAdd }, svg('back', 16)),
      h('h2', { class: 'add-title', text: '添加应用' }),
      h('div', { class: 'seg', role: 'tablist', 'aria-label': '添加来源' },
        addTabBtn('installed', 'grid', '已安装的应用'),
        addTabBtn('file', 'file', '浏览文件'),
        addTabBtn('url', 'link', '网址或文件夹'))));

    if (S.addTab === 'installed') frag.append(installedPane());
    else if (S.addTab === 'file') frag.append(filePane());
    else frag.append(urlPane());
    return frag;
  }

  function installedPane() {
    const frag = document.createDocumentFragment();
    const list = h('div', { class: 'list' });
    const input = h('input', {
      id: 'add-search', type: 'search', placeholder: '搜索已安装的应用',
      'aria-label': '搜索已安装的应用', autocomplete: 'off', spellcheck: 'false'
    });
    input.value = S.addQuery;
    input.addEventListener('input', () => { S.addQuery = input.value; fillList(list); });
    frag.append(h('label', { class: 'search' }, svg('search', 18), input));
    fillList(list);
    frag.append(list);
    const confirm = h('button', { class: 'btn primary', id: 'add-confirm', onclick: confirmAdd });
    frag.append(h('div', { class: 'foot' },
      h('span', { class: 'foot-hint' }, svg('upload', 16), h('span', { text: '也可以把桌面图标拖到「更多应用」图标上，或直接拖进面板' })),
      h('div', { class: 'foot-btns' }, h('button', { class: 'btn', onclick: closeAdd }, '取消'), confirm)));
    updateConfirm(confirm);
    return frag;
  }

  function filePane() {
    return h('div', { class: 'pane' },
      h('div', { class: 'drop-zone' },
        svg('upload', 28),
        h('p', { class: 'dz-title', text: '把 .exe、.lnk 或文件夹拖到这里' }),
        h('p', { class: 'dz-sub', text: '面板关着时，把桌面图标拖到「更多应用」图标上也能直接添加' }),
        h('p', { class: 'dz-sub', text: '也可以手动选择，支持一次选多个文件' }),
        h('div', { class: 'dz-btns' },
          h('button', { class: 'btn primary', onclick: async () => afterAdd(await api.pickFiles()) }, svg('file', 16), '选择文件…'),
          h('button', { class: 'btn', onclick: async () => afterAdd(await api.pickFolder()) }, svg('folder', 16), '选择文件夹…'))));
  }

  function urlPane() {
    const url = h('input', { id: 'url-input', type: 'text', placeholder: '例如 bilibili.com 或 https://…', autocomplete: 'off', spellcheck: 'false' });
    const name = h('input', { id: 'url-name', type: 'text', placeholder: '不填就用网站域名', autocomplete: 'off', spellcheck: 'false' });
    const submit = async () => afterAdd(await api.addUrl(url.value, name.value), '没有添加：网址格式不对，或者已经在启动台里了');
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => url.focus(), 0);
    return h('div', { class: 'pane' },
      h('div', { class: 'form' },
        h('label', { class: 'field' }, h('span', { text: '网址' }), url),
        h('label', { class: 'field' }, h('span', { text: '名称（可选）' }), name),
        h('div', { class: 'form-btns' }, h('button', { class: 'btn primary', onclick: submit }, svg('plus', 16), '添加网址'))),
      h('div', { class: 'or', text: '或者' }),
      h('button', { class: 'btn wide', onclick: async () => afterAdd(await api.pickFolder()) }, svg('folder', 16), '添加一个文件夹…'));
  }

  function updateConfirm(btn) {
    btn = btn || document.getElementById('add-confirm');
    if (!btn) return;
    const n = S.addSel.size;
    btn.textContent = n ? '添加 ' + n + ' 个应用' : '添加应用';
    btn.disabled = n === 0;
  }

  function fillList(list) {
    list.replaceChildren();
    if (S.data.loading && S.data.catalog.length === 0) {
      list.append(h('div', { class: 'list-empty', text: '正在读取开始菜单里的应用…' }));
      return;
    }
    const q = S.addQuery.trim().toLowerCase();
    const rows = S.data.catalog
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.path || '').toLowerCase().includes(q))
      .sort((a, b) => (Number(a.added) - Number(b.added)) || a.name.localeCompare(b.name, 'zh-CN'));
    if (rows.length === 0) {
      list.append(h('div', { class: 'list-empty', text: q ? '没有找到匹配的应用' : '没有读取到已安装的应用' }));
      return;
    }
    for (const c of rows) {
      const cb = h('input', { type: 'checkbox', 'aria-label': c.name });
      cb.checked = c.added || S.addSel.has(c.key);
      cb.disabled = c.added;
      const row = h('label', {
        class: 'row' + (c.added ? ' added' : '') + (S.addSel.has(c.key) ? ' sel' : ''),
        title: c.path || ''
      },
      cb,
      tileIcon({ name: c.name, icon: c.icon || (S.catalogIcons && S.catalogIcons.get(c.key)), iconScale: c.iconScale, kind: 'app' }, 34),
      h('span', { class: 'row-text' },
        h('span', { class: 'row-name', text: c.name }),
        h('span', { class: 'row-path', text: c.path || '' })),
      c.added ? h('span', { class: 'tag', text: '已在启动台' }) : null);
      cb.addEventListener('change', () => {
        if (cb.checked) S.addSel.add(c.key); else S.addSel.delete(c.key);
        row.classList.toggle('sel', cb.checked);
        updateConfirm();
      });
      list.append(row);
    }
  }

  async function confirmAdd() {
    const keys = Array.from(S.addSel);
    if (!keys.length) return;
    const d = await api.add(keys);
    S.addSel.clear();
    S.data = d;
    S.view = 'main';
    S.page = pageCount() - 1;
    NL.render();
    showToast({ text: '已添加 ' + keys.length + ' 个应用', ms: 2500 });
  }

  // 添加文件 / 文件夹 / 网址之后：成功就回到主界面最后一页
  function afterAdd(res, failMsg) {
    if (!res) return;
    S.data = res.data;
    const names = (list) => list.slice(0, 3).map((n) => '「' + n + '」').join('、') + (list.length > 3 ? ' 等 ' + list.length + ' 个' : '');
    if (res.added > 0) {
      S.view = 'main';
      S.page = pageCount() - 1;
      NL.render();
      showToast({ text: Array.isArray(res.names) && res.names.length ? '已添加 ' + names(res.names) : '已添加 ' + res.added + ' 项', ms: 2500 });
    } else {
      NL.render();
      if (Array.isArray(res.exists) && res.exists.length) showToast({ text: names(res.exists) + ' 已经在启动台里了', ms: 3000 });
      else if (failMsg) showToast({ text: failMsg, ms: 3000 });
    }
  }

  Object.assign(NL, { openAdd, closeAdd, renderAdd, afterAdd });
})(window.NL);
