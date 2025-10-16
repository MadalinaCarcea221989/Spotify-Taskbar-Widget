const { contextBridge, ipcRenderer } = require('electron');

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('player', {
  // --- Methods (Renderer -> Main) ---
  getNowPlaying: () => ipcRenderer.invoke('player:getNowPlaying'),
  playPause: () => ipcRenderer.invoke('player:playPause'),
  next: () => ipcRenderer.invoke('player:next'),
  prev: () => ipcRenderer.invoke('player:prev'),
  authorize: () => ipcRenderer.invoke('player:authorize'),
  isLiked: () => ipcRenderer.invoke('player:isLiked'),
  toggleLike: () => ipcRenderer.invoke('player:toggleLike'),
  logout: () => ipcRenderer.invoke('player:logout'),

  // --- Listeners (Main -> Renderer) ---
  onAuthSuccess: (callback) => ipcRenderer.on('auth-success', (_event, ...args) => callback(...args)),
  onAuthRequired: (callback) => ipcRenderer.on('auth-required', (_event, ...args) => callback(...args)),
  // Dock state
  getDockState: () => ipcRenderer.invoke('get-dock-state'),
  onDockChanged: (callback) => ipcRenderer.on('docked-changed', (_event, ...args) => callback(...args)),
  requestDockAt: (coords) => ipcRenderer.invoke('request-dock-at', coords),

  // --- Cleanup ---
  cleanupListeners: () => {
      ipcRenderer.removeAllListeners('auth-success');
      ipcRenderer.removeAllListeners('auth-required');
  }
});

// preload executed (debug sends removed to keep terminal quiet)