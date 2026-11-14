'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  getData: () => ipcRenderer.invoke('data:get'),
  launch: (key) => ipcRenderer.invoke('app:launch', key),
  remove: (key) => ipcRenderer.invoke('app:remove', key),
  restore: (key, index) => ipcRenderer.invoke('app:restore', key, index),
  move: (src, dst) => ipcRenderer.invoke('app:move', src, dst),
  add: (keys) => ipcRenderer.invoke('app:add', keys),
  addPaths: (paths) => ipcRenderer.invoke('app:addPaths', paths),
  addUrl: (url, name) => ipcRenderer.invoke('app:addUrl', url, name),
  pickFiles: () => ipcRenderer.invoke('app:pickFiles'),
  pickFolder: () => ipcRenderer.invoke('app:pickFolder'),
  togglePin: (key) => ipcRenderer.invoke('app:togglePin', key),
  runAsAdmin: (key) => ipcRenderer.invoke('app:runAsAdmin', key),
  openLocation: (key) => ipcRenderer.invoke('app:openLocation', key),
  uninstall: (key) => ipcRenderer.invoke('app:uninstall', key),
  exportIcon: (key) => ipcRenderer.invoke('app:exportIcon', key),
  rescan: () => ipcRenderer.invoke('app:rescan'),
  hide: () => ipcRenderer.send('panel:hide'),
  log: (msg) => ipcRenderer.send('ui:log', String(msg)),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  onMoved: (cb) => ipcRenderer.on('panel:moved', (_e, rect) => cb(rect)),
  getCatalog: () => ipcRenderer.invoke('catalog:get'),
  captureSource: () => ipcRenderer.invoke('capture:source'),
  onOpen: (cb) => ipcRenderer.on('panel:open', (_e, data, rect, opts) => cb(data, rect, opts)),
  onBg: (cb) => ipcRenderer.on('panel:bg', (_e, bg, rect) => cb(bg, rect)),
  onToast: (cb) => ipcRenderer.on('panel:toast', (_e, text, jumpToEnd) => cb(text, jumpToEnd)),
  onClear: (cb) => ipcRenderer.on('panel:clear', (_e, token) => cb(token)),
  cleared: (token) => ipcRenderer.send('panel:cleared', token),
  onData: (cb) => ipcRenderer.on('data:changed', (_e, data) => cb(data))
});
