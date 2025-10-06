import { contextBridge, ipcRenderer } from 'electron';

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('player', {
  // --- Methods (Renderer -> Main) ---
  getNowPlaying: () => ipcRenderer.invoke('player:getNowPlaying'),
  playPause: () => ipcRenderer.invoke('player:playPause'),
  next: () => ipcRenderer.invoke('player:next'),
  prev: () => ipcRenderer.invoke('player:prev'),
  authorize: () => ipcRenderer.invoke('player:authorize'),
  logout: () => ipcRenderer.invoke('player:logout'),

  // --- Listeners (Main -> Renderer) ---
  onAuthSuccess: (callback) => ipcRenderer.on('auth-success', (_event, ...args) => callback(...args)),
  onAuthRequired: (callback) => ipcRenderer.on('auth-required', (_event, ...args) => callback(...args)),

  // --- Cleanup ---
  cleanupListeners: () => {
      ipcRenderer.removeAllListeners('auth-success');
      ipcRenderer.removeAllListeners('auth-required');
  }
});