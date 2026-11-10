'use strict';

// 「外观」设置页（编辑模式里进入）：改动实时生效，并保存到主进程
(function (NL) {
  const { api, S, h, svg } = NL;

  const ACCENTS = [['天蓝', '#7CC7FF'], ['薰衣草', '#A5B4FF'], ['薄荷', '#7EE0C3'], ['橙', '#FFB86B'], ['樱粉', '#FF9EC0'], ['白', '#E8ECF3']];

  function openSettings() { NL.closeMenu(); S.view = 'settings'; NL.render(); }
  function closeSettings() { S.view = 'main'; NL.render(); }

  // 拖滑杆时频繁变化：稍微合并一下再发给主进程，而且不重绘（避免打断拖动）
  const pending = {};
  function sendSetting(key, value, rerender) {
    clearTimeout(pending[key]);
    pending[key] = setTimeout(async () => {
      const d = await api.setSetting(key, value);
      if (!d) return;
      if (rerender) NL.setData(d);
      else S.data.settings = d.settings;
    }, rerender ? 0 : 60);
  }

  function row(label, note, ...rest) {
    return h('div', { class: 'set-row' },
      h('div', { class: 'set-label' }, h('span', { text: label }), note ? h('span', { class: 'set-note', text: note }) : null),
      ...rest);
  }

  function rangeRow(label, key, min, max, step, fmt, note) {
    const st = S.data.settings;
    const val = h('span', { class: 'set-val', text: fmt(st[key]) });
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
    input.value = String(st[key]);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      S.data.settings[key] = v;
      val.textContent = fmt(v);
      NL.applyLook();
      sendSetting(key, v, false);
    });
    return row(label, note, input, val);
  }

  function glassRow() {
    const st = S.data.settings;
    const glassOn = st.glass !== false;
    const gVal = h('span', { class: 'set-val', text: glassOn ? String(st.glassStrength) : '关闭' });
    const gRange = h('input', { type: 'range', min: '0', max: '60', step: '1', 'aria-label': '折射强度' });
    gRange.value = String(st.glassStrength);
    gRange.disabled = !glassOn;
    gRange.addEventListener('input', () => {
      const v = Number(gRange.value);
      S.data.settings.glassStrength = v;
      gVal.textContent = String(v);
      NL.applyLook();
      sendSetting('glassStrength', v, false);
    });
    const gSwitch = h('button', {
      class: 'switch', role: 'switch', 'aria-checked': glassOn ? 'true' : 'false', 'aria-label': '液态玻璃',
      onclick: () => {
        const on = S.data.settings.glass === false;
        S.data.settings.glass = on;
        gSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
        gRange.disabled = !on;
        gVal.textContent = on ? String(S.data.settings.glassStrength) : '关闭';
        NL.applyLook();
        sendSetting('glass', on, false);
      }
    });
    return row('液态玻璃', '边缘真实折射，无描边', h('div', { class: 'set-ctl with-switch' }, gSwitch, gRange), gVal);
  }

  function widthRow() {
    const st = S.data.settings;
    const widths = h('div', { class: 'seg', role: 'group', 'aria-label': '面板宽度' });
    for (const [label, v] of [['窄', 720], ['适中', 800], ['宽', 960]]) {
      widths.append(h('button', {
        class: 'seg-btn' + (st.panelWidth === v ? ' on' : ''),
        'aria-pressed': st.panelWidth === v ? 'true' : 'false',
        onclick: () => sendSetting('panelWidth', v, true)
      }, label));
    }
    return row('面板宽度', '窄的每行 7 个', h('div', { class: 'set-ctl' }, widths), h('span', { class: 'set-val', text: st.panelWidth + ' px' }));
  }

  function accentRow() {
    const st = S.data.settings;
    const sw = h('div', { class: 'swatches', role: 'group', 'aria-label': '强调色' });
    for (const [label, c] of ACCENTS) {
      sw.append(h('button', {
        class: 'swatch' + ((st.accent || '').toLowerCase() === c.toLowerCase() ? ' on' : ''),
        style: 'background:' + c,
        'aria-label': label, title: label,
        onclick: () => { S.data.settings.accent = c; NL.applyLook(); sendSetting('accent', c, true); }
      }));
    }
    return row('强调色', '按钮和选中状态的颜色', h('div', { class: 'set-ctl' }, sw), h('span', { class: 'set-val' }));
  }

  function renderSettings() {
    const frag = document.createDocumentFragment();
    frag.append(h('div', { class: 'add-head' },
      h('button', { class: 'icon-btn', 'aria-label': '返回', onclick: closeSettings }, svg('back', 16)),
      h('h2', { class: 'add-title', text: '外观' }),
      h('button', { class: 'btn', onclick: () => sendSetting('reset', true, true) }, '恢复默认')));

    const body = h('div', { class: 'settings' });
    body.append(rangeRow('模糊程度', 'blur', 0, 30, 1, (v) => (Number(v) ? v + ' px' : '关闭'), '调到 0 直接透出桌面'));
    body.append(rangeRow('面板深浅', 'panelAlpha', 0.2, 0.9, 0.01, (v) => Math.round(Number(v) * 100) + '%', '越深字越清楚'));
    body.append(rangeRow('离屏幕底部', 'bottomOffset', 60, 400, 10, (v) => v + ' px', '面板的高度位置'));
    body.append(glassRow());
    body.append(widthRow());
    body.append(accentRow());
    frag.append(body);
    return frag;
  }

  Object.assign(NL, { openSettings, closeSettings, renderSettings });
})(window.NL);
