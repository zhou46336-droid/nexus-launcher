'use strict';

/* 实时渲染背景（外观设置里的「背景渲染 → 实时渲染」）
   面板开着时持续捕获它后面的屏幕画面（一半分辨率、60 帧），放进背景层，
   套上和静态截图一样的模糊和液态玻璃效果；动态壁纸、视频、移动的窗口都会实时透过玻璃。
   面板本身已被主进程排除在录屏之外，不会出现「画中画」。
   打开时先显示静态截图，实时画面第一帧到了再淡入；捕获失败就一直用静态截图。
   面板收起时立刻停止捕获，不占资源。 */
(function (NL) {
  const { api, S, panelBg, uiLog } = NL;

  let stream = null;
  let video = null;
  let starting = false;
  let token = 0;
  let again = false;       // 正在启动时又被要求启动（比如中途停过一次）
  let failed = false;      // 这次打开面板已经失败过，不反复重试
  let loggedOnce = false;
  let lastMargin = 0;

  function wanted() {
    const st = S.data.settings || {};
    return st.bgMode === 'live' && !!st.liveSupported && !!S.bg && !!S.panelRect &&
      !document.documentElement.classList.contains('cleared');
  }

  // 视频按整个屏幕的大小摆放，再按面板位置偏移，和静态截图完全对齐
  function position(margin) {
    if (typeof margin === 'number') lastMargin = margin;
    if (!video || !S.bg || !S.panelRect) return;
    const bg = S.bg;
    const r = S.panelRect;
    video.style.left = (bg.x - r.x + lastMargin) + 'px';
    video.style.top = (bg.y - r.y + lastMargin) + 'px';
    video.style.width = bg.width + 'px';
    video.style.height = bg.height + 'px';
  }

  async function openStream(width, height, fps) {
    // 主进程确认是实时模式才给屏幕编号；没给就不捕获
    const src = await api.captureSource();
    if (!src || !src.id) throw new Error('no source');
    // 方式一：用屏幕编号直接捕获（不弹选择框）
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: src.id,
            maxWidth: width,
            maxHeight: height,
            maxFrameRate: fps,
            minFrameRate: Math.min(30, fps)
          }
        }
      });
    } catch (e) {
      uiLog('live: getUserMedia failed ' + (e && (e.name || e.message)));
    }
    // 方式二：getDisplayMedia（主进程直接给面板所在的屏幕，也不弹选择框）
    return navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps, max: fps } }
    });
  }

  // 每次运行记一次实际帧率，方便判断电脑吃不吃得消
  function measure(v, s) {
    if (loggedOnce || !v.requestVideoFrameCallback) return;
    loggedOnce = true;
    let frames = 0;
    let t0 = 0;
    const count = (now) => {
      if (video !== v) return;
      if (!t0) t0 = now;
      frames++;
      if (now - t0 < 3000) { v.requestVideoFrameCallback(count); return; }
      const track = s.getVideoTracks()[0];
      const set = track && track.getSettings ? track.getSettings() : {};
      const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      uiLog('live fps=' + Math.round((frames - 1) / ((now - t0) / 1000)) +
        ' capture=' + (set.width || '?') + 'x' + (set.height || '?') + '@' + Math.round(set.frameRate || 0) +
        (q ? ' dropped=' + q.droppedVideoFrames + '/' + q.totalVideoFrames : ''));
    };
    v.requestVideoFrameCallback(count);
  }

  async function start() {
    if (starting) { again = true; return; }
    if (stream || failed || !wanted()) return;
    starting = true;
    const my = ++token;
    try {
      const fps = Number((S.data.settings || {}).liveFps) || 60;
      // 一半分辨率：反正要模糊，看不出差别，捕获和滤镜的开销都小很多
      const width = Math.max(320, Math.round(S.bg.width / 2));
      const height = Math.max(200, Math.round(S.bg.height / 2));
      const s = await openStream(width, height, fps);
      if (my !== token || !wanted()) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      const v = document.createElement('video');
      v.className = 'live-bg';
      v.muted = true;
      v.playsInline = true;
      v.disablePictureInPicture = true;
      v.srcObject = s;
      video = v;
      position();
      panelBg.append(v);
      // 第一帧画出来再淡入，盖住下面的静态截图
      const show = () => { if (video === v) v.classList.add('on'); };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(show);
      else v.addEventListener('playing', show, { once: true });
      // 捕获意外中断（比如显示器拔掉）：退回静态截图
      s.getVideoTracks().forEach((t) => t.addEventListener('ended', () => { if (stream === s) { uiLog('live: track ended'); stop(); } }));
      await v.play().catch(() => {});
      measure(v, s);
    } catch (e) {
      if (my === token) {
        failed = true;
        uiLog('live: unavailable ' + (e && (e.name || e.message)));
        stop();
      }
    } finally {
      starting = false;
      if (again) { again = false; sync(); }
    }
  }

  function stop() {
    token++;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (video) { video.srcObject = null; video.remove(); video = null; }
  }

  // 根据当前设置和面板状态，开始或停止实时渲染
  function sync() {
    if (wanted()) start();
    else {
      stop();
      // 切回静态后再切到实时，允许重新试一次
      if ((S.data.settings || {}).bgMode !== 'live') failed = false;
    }
  }

  // 每次打开面板：清掉上一次的画面和失败记录
  function reset() {
    stop();
    failed = false;
  }

  NL.live = { sync, stop, reset, position, isOn: () => !!(video && video.classList.contains('on')) };
})(window.NL);
