'use strict';

/* 外观：面板深浅、模糊、强调色，以及液态玻璃效果。

   液态玻璃参考 kube.io《Liquid Glass in the Browser》：把面板边缘当成一圈凸起的玻璃，
   截面是苹果式的超椭圆曲线 y = (1-(1-x)^4)^(1/4)，折射率 1.5（普通玻璃），
   用斯涅尔定律算出每个位置光线偏折多少，得到一条「偏移量-离边距离」曲线：
   最外缘偏移最大、往里迅速衰减，面板中间完全不动。
   偏移量写进一张位移贴图（R/G 通道存横向/纵向），交给 SVG feDisplacementMap 去扭曲背景；
   红绿蓝三个通道的偏移量略有差别，边缘会有一点自然色散（liquid-glass-react 的做法）。 */
(function (NL) {
  const { S, panel, panelBg, uiLog } = NL;

  const lgMap = document.getElementById('lg-map');
  const lgR = document.getElementById('lg-r');
  const lgG = document.getElementById('lg-g');
  const lgB = document.getElementById('lg-b');

  function applyLook() {
    const st = S.data.settings || {};
    const blur = Number(st.blur) || 0;
    const glass = st.glass !== false;
    panel.style.setProperty('--alpha', String(typeof st.panelAlpha === 'number' ? st.panelAlpha : 0.6));
    panel.style.setProperty('--blur', blur + 'px');
    if (st.accent) document.documentElement.style.setProperty('--accent', st.accent);
    panel.classList.toggle('glass', glass);
    const hasBg = !!(S.bg && S.bg.url);
    const showBg = hasBg && (blur > 0 || glass);
    panelBg.style.display = showBg ? 'block' : 'none';
    panel.classList.toggle('no-bg', !showBg && blur > 0);
    try {
      const sc = (Number(st.glassStrength) || 0) * 0.9;
      lgR.setAttribute('scale', sc.toFixed(1));
      lgG.setAttribute('scale', (sc * 0.95).toFixed(1));
      lgB.setAttribute('scale', (sc * 0.9).toFixed(1));
      // 玻璃会让背后的颜色更鲜一点
      panelBg.style.filter = glass && hasBg
        ? 'blur(' + blur + 'px) url(#lg) saturate(1.45) brightness(1.04)'
        : 'blur(' + blur + 'px)';
      positionBg();
    } catch (e) {
      uiLog('glass: ' + (e && e.message));
      panelBg.style.filter = 'blur(' + blur + 'px)';
    }
  }

  /* ---------- 折射曲线 ---------- */

  const BEZEL = 30;      // 玻璃“厚边”的宽度（px）
  const LUT_N = 128;
  const refractLut = (() => {
    const n = 1.5, H = BEZEL, base = 6;
    const sq = (t) => Math.pow(1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 4), 0.25);
    const height = (x) => H * sq(x / BEZEL);
    const out = new Float32Array(LUT_N);
    let max = 0;
    for (let i = 0; i < LUT_N; i++) {
      const x = (BEZEL * i) / (LUT_N - 1);
      const dx = 0.001 * BEZEL;
      const a = Math.max(x - dx, 0), b = Math.min(x + dx, BEZEL);
      const slope = (height(b) - height(a)) / (b - a);
      const t1 = Math.atan(slope);
      const t2 = Math.asin(Math.sin(t1) / n);
      const v = (height(x) + base) * Math.tan(t1 - t2);
      out[i] = v;
      if (v > max) max = v;
    }
    for (let i = 0; i < LUT_N; i++) out[i] /= max || 1;
    // 最外缘不到 1px 的地方曲面接近垂直，算出来会突然变小，抹平它，免得边上出现一条细线
    let peak = 0;
    for (let i = 0; i < LUT_N; i++) if (out[i] >= 1) { peak = i; break; }
    for (let i = 0; i < peak; i++) out[i] = 1;
    return out;
  })();

  /* ---------- 位移贴图 ---------- */

  const glassMaps = new Map();
  function glassMapUrl(w, hgt) {
    const radius = getComputedStyle(panel).borderTopLeftRadius;
    const key = w + 'x' + hgt + 'r' + radius;
    if (glassMaps.has(key)) return glassMaps.get(key);
    // 面板圆角是 iOS 式的连续曲率（CSS corner-shape: squircle，即 |x|⁴+|y|⁴=1），
    // 贴图的边缘形状要和它一致，折射才贴着边走
    const r = parseFloat(radius) || 40;
    const c = document.createElement('canvas');
    c.width = w; c.height = hgt;
    const g = c.getContext('2d');
    const img = g.createImageData(w, hgt);
    const d = img.data;
    const hx = w / 2 - r;
    const hy = hgt / 2 - r;
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - w / 2;
        const py = y + 0.5 - hgt / 2;
        const qx = Math.abs(px) - hx;
        const qy = Math.abs(py) - hy;
        let inside, nx = 0, ny = 0, m = 0;
        if (qx > 0 && qy > 0) {
          // 角落：到超椭圆边界的距离 ≈ (r - ‖o‖₄) / |∇‖o‖₄|
          const n4 = Math.pow(qx ** 4 + qy ** 4, 0.25) || 1e-6;
          const gx = (qx / n4) ** 3, gy = (qy / n4) ** 3;
          const gl = Math.hypot(gx, gy) || 1;
          inside = (r - n4) / gl;
          nx = (gx / gl) * Math.sign(px);
          ny = (gy / gl) * Math.sign(py);
        } else if (qx > qy) {
          inside = r - qx;
          nx = Math.sign(px);
        } else {
          inside = r - qy;
          ny = Math.sign(py);
        }
        if (inside >= 0 && inside < BEZEL) {
          const f = (inside / BEZEL) * (LUT_N - 1);
          const i0 = Math.floor(f), i1 = Math.min(i0 + 1, LUT_N - 1);
          m = refractLut[i0] + (refractLut[i1] - refractLut[i0]) * (f - i0);
        }
        const i = (y * w + x) * 4;
        // 往面板里面取背景（凸透镜把光线往中心折）
        d[i] = 128 - nx * m * 127;
        d[i + 1] = 128 - ny * m * 127;
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const url = c.toDataURL('image/png');
    glassMaps.set(key, url);
    return url;
  }

  /* ---------- 背景层 ----------
     背景层不铺满整个屏幕，只取面板后面那一块（四周多留一圈给模糊用），
     滤镜要处理的像素少很多，大屏 / 高分屏上也不会因为显存不够画不出来。 */

  function bgMargin() {
    const blur = Number((S.data && S.data.settings && S.data.settings.blur) || 0);
    return Math.ceil(24 + blur * 2.5);
  }

  function updateGlassMap() {
    const st = S.data.settings || {};
    if (st.glass === false || !S.bg || !S.panelRect) return;
    const w = Number(st.panelWidth) || S.panelRect.width || 800;
    const hgt = S.panelRect.height || 500;
    const url = glassMapUrl(w, hgt);
    if (lgMap.getAttribute('href') !== url) lgMap.setAttribute('href', url);
    const M = bgMargin();
    lgMap.setAttribute('x', String(M));
    lgMap.setAttribute('y', String(M));
    lgMap.setAttribute('width', String(w));
    lgMap.setAttribute('height', String(hgt));
  }

  function positionBg() {
    const bg = S.bg;
    const r = S.panelRect;
    if (!bg || !bg.url || !r) { panelBg.style.backgroundImage = ''; return; }
    const M = bgMargin();
    const w = r.width || panel.offsetWidth;
    const hh = r.height || panel.offsetHeight;
    const url = 'url("' + bg.url + '")';
    if (panelBg.style.backgroundImage !== url) panelBg.style.backgroundImage = url;
    panelBg.style.left = -M + 'px';
    panelBg.style.top = -M + 'px';
    panelBg.style.width = (w + M * 2) + 'px';
    panelBg.style.height = (hh + M * 2) + 'px';
    panelBg.style.backgroundSize = bg.width + 'px ' + bg.height + 'px';
    panelBg.style.backgroundPosition = (bg.x - r.x + M) + 'px ' + (bg.y - r.y + M) + 'px';
    updateGlassMap();
  }

  Object.assign(NL, { applyLook, positionBg });
})(window.NL);
