const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('voiceforgeDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: '0.2.0'
});
