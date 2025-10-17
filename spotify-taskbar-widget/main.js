import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import os from 'os';
import fetch from 'node-fetch';
import sharp from 'sharp';

import { loadTokens, clearTokens } from './tokenStore.js';
import { startAuthFlow, refreshTokens } from './auth.js';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Performance: Disable hardware acceleration for lower GPU/RAM usage (small widget doesn't need it)
app.disableHardwareAcceleration();

// Ensure a writable userData path early to avoid Chrome/Electron cache errors
// on Windows when the default profile location is not usable. We set the
// userData to %APPDATA%/Spotify-Taskbar-Widget and create the dir if needed.
try {
    const appDataBase = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const forcedUserData = path.join(appDataBase, 'Spotify-Taskbar-Widget');
    try { fsSync.mkdirSync(forcedUserData, { recursive: true }); } catch (e) { /* ignore */ }
    try { app.setPath('userData', forcedUserData); console.log('[main] userData set to', forcedUserData); } catch (e) { console.warn('[main] setPath(userData) failed:', e); }
    try {
        // Use the OS temp dir for Chromium's cache to avoid permission issues
        const forcedCache = path.join(os.tmpdir(), 'Spotify-Taskbar-Widget', 'Cache');
        try { fsSync.mkdirSync(forcedCache, { recursive: true }); } catch (e) { /* ignore */ }
        try { app.setPath('cache', forcedCache); console.log('[main] cache set to', forcedCache); } catch (e) { console.warn('[main] setPath(cache) failed:', e); }
    } catch (e) {
        // ignore
    }
} catch (e) {
    // non-fatal; continue with defaults
}

const APP_WIDTH = 380;
const APP_HEIGHT = 80;
const COMPACT_HEIGHT = 48; // Height when docked - matches Windows 11 taskbar exactly
const REFRESH_SKEW_SECONDS = 30;

let mainWindow;
let tray;
let config;
let currentTokens;
let settings = { 
    dockToTaskbar: true, 
    keepTopAlways: false, 
    verboseLogging: false, 
    appbarEdge: 'left', 
    appbarThickness: 48, 
    attachToTaskbar: false, 
    disableAppBar: false,
    autoHideOnBlur: false, // Widget-style auto-hide
    slideAnimation: true, // Slide animations
};
let appbarRegistered = false;

function maybeLog(...args) {
    try {
        if (settings && settings.verboseLogging) console.log(...args);
    } catch (e) {}
}

// Window state persistence (position & size)
const WINDOW_STATE_FILE = path.join(app.getPath ? app.getPath('userData') : __dirname, 'window-state.json');
const SETTINGS_FILE = path.join(app.getPath ? app.getPath('userData') : __dirname, 'settings.json');

async function loadSettings() {
    try {
        const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
        settings = JSON.parse(raw);
    } catch (err) {
        // ignore, use defaults
    }
}

async function saveSettings() {
    try {
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (err) {
        console.error('Failed to save settings:', err);
    }
}

// Provide the dock state to the renderer on request
ipcMain.handle('get-dock-state', async () => {
    return !!settings?.dockToTaskbar;
});

ipcMain.handle('request-dock-at', async (_event, coords) => {
    try {
        if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number') return { ok: false };
        const displays = screen.getAllDisplays();
        // Find display that contains the point
        const disp = displays.find(d => coords.x >= d.bounds.x && coords.x <= d.bounds.x + d.bounds.width && coords.y >= d.bounds.y && coords.y <= d.bounds.y + d.bounds.height) || screen.getPrimaryDisplay();
        const work = disp.workArea;
        // Threshold in pixels to detect near-edge drags
        const THRESH = 96;
        let shouldDock = false;
        if (Math.abs(coords.y - (work.y + work.height)) <= THRESH) shouldDock = true; // near bottom
        if (Math.abs(coords.y - work.y) <= THRESH) shouldDock = true; // near top
        if (Math.abs(coords.x - work.x) <= THRESH) shouldDock = true; // near left
        if (Math.abs(coords.x - (work.x + work.width)) <= THRESH) shouldDock = true; // near right

        settings.dockToTaskbar = !!shouldDock;
        await saveSettings();
        if (mainWindow) positionWindowAroundTaskbar(mainWindow);
        try { mainWindow?.webContents.send('docked-changed', !!settings.dockToTaskbar); } catch (e) {}
        return { ok: true, docked: !!settings.dockToTaskbar };
    } catch (err) {
        return { ok: false };
    }
});

async function loadWindowState() {
    try {
        const data = await fs.readFile(WINDOW_STATE_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        return null; // no previous state
    }
}

async function saveWindowState(state) {
    try {
        await fs.writeFile(WINDOW_STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
        console.error('Failed to save window state:', err);
    }
}

// Positioning helper moved to module scope so both window creation and tray
// handlers can call it (helps keep the widget above the taskbar on any edge).
function positionWindowAroundTaskbar(win) {
    try {
        // Prefer the tray's display when possible so the widget appears
        // on the same monitor as the tray.
        let display;
        try {
            const trayBounds = tray?.getBounds();
            if (trayBounds) {
                display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
            }
        } catch (err) {
            // ignore
        }
        if (!display) display = screen.getPrimaryDisplay();

        const bounds = display.bounds;
        const workArea = display.workArea;

        // Determine taskbar edge and size by comparing bounds and workArea
        let edge = 'bottom';
        let taskbarSize = bounds.height - workArea.height;
        if (workArea.x > bounds.x) { edge = 'left'; taskbarSize = workArea.x - bounds.x; }
        else if (workArea.y > bounds.y) { edge = 'top'; taskbarSize = workArea.y - bounds.y; }
        else if (workArea.width < bounds.width) { edge = 'right'; taskbarSize = bounds.width - workArea.width; }
        else { edge = 'bottom'; taskbarSize = bounds.height - workArea.height; }

        const margin = 4; // Small margin to sit just above taskbar
        let x, y, width, height;

        if (settings?.dockToTaskbar) {
            // Widget mode: sit just above/beside taskbar like Windows 11 widgets
            width = APP_WIDTH;
            height = COMPACT_HEIGHT;
            
            if (edge === 'bottom') {
                // Position at bottom-left corner, just above taskbar
                x = bounds.x + margin;
                y = workArea.y + workArea.height - height - margin;
            } else if (edge === 'top') {
                x = bounds.x + margin;
                y = workArea.y + margin;
            } else if (edge === 'left') {
                // Position at top-left, just to the right of taskbar
                x = workArea.x + margin;
                y = workArea.y + margin;
            } else if (edge === 'right') {
                // Position at top-right, just to the left of taskbar
                x = workArea.x + workArea.width - width - margin;
                y = workArea.y + margin;
            }
            
            try { win.setSize(width, height); } catch (e) {}
        } else {
            // Floating mode: center above taskbar
            width = APP_WIDTH;
            height = APP_HEIGHT;
            x = Math.round(workArea.x + (workArea.width - width) / 2);
            
            if (edge === 'bottom') {
                y = Math.round(workArea.y + workArea.height - height - 8);
            } else if (edge === 'top') {
                y = Math.round(workArea.y + 8);
            } else if (edge === 'left') {
                x = Math.round(workArea.x + 8);
                y = Math.round(workArea.y + workArea.height - height - 8);
            } else if (edge === 'right') {
                x = Math.round(workArea.x + workArea.width - width - 8);
                y = Math.round(workArea.y + workArea.height - height - 8);
            }
            
            try { win.setSize(width, height); } catch (e) {}
        }

        win.setPosition(x, y);

        // Keep window above taskbar using appropriate level
        try {
            if (settings?.dockToTaskbar) {
                // In widget mode, use screen-saver level to stay above taskbar
                win.setAlwaysOnTop(true, 'screen-saver', 1);
            } else {
                // In floating mode, use pop-up-menu level
                win.setAlwaysOnTop(true, 'pop-up-menu');
            }
            win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        } catch (err) {
            // non-fatal
        }
    } catch (err) {
        console.error('Error positioning window:', err);
    }
}// Ensure the given window remains top-most with strong level hints.
function ensureTopMost(win) {
    if (!win) return;
    try {
        // Try multiple levels to reduce chance of being covered by explorer/taskbar
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setAlwaysOnTop(true, 'pop-up-menu');
        // Ensure visible across workspaces
        if (win.setVisibleOnAllWorkspaces) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        // Also re-show if somehow hidden under other windows
        if (!win.isVisible()) win.showInactive ? win.showInactive() : win.show();
    } catch (err) {
        // non-fatal
    }
}

async function loadConfig() {
    try {
        const configPath = path.join(app.getAppPath(), 'config.json');
        const data = await fs.readFile(configPath, 'utf-8');
        config = JSON.parse(data);
    } catch (error) {
        console.error('FATAL: Could not load config.json.', error);
        console.error('Please copy config.example.json to config.json and fill in your client_id.');
        app.quit();
    }
}

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: APP_WIDTH,
        height: APP_HEIGHT,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false, // Widgets don't resize
        movable: false, // Lock position to prevent accidental moves
        minWidth: 300,
        minHeight: 60,
        hasShadow: true, // Native shadow like widgets
        roundedCorners: true, // Rounded like W11 widgets
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: true, // Enable DevTools for live design editing
        },
    });

    // Widget-like behavior: hide when clicking outside (optional)
    mainWindow.on('blur', () => {
        if (settings?.autoHideOnBlur && settings?.dockToTaskbar) {
            setTimeout(() => {
                if (!mainWindow.isFocused()) {
                    mainWindow.hide();
                }
            }, 200);
        }
    });

    // DevTools keyboard shortcut (Ctrl+Shift+I or F12)
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.shift && input.key.toLowerCase() === 'i') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
        if (input.key === 'F12') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });

    // Restore last size/position if available
    try {
        const prev = await loadWindowState();
        if (prev) {
            // Use previous width/height if present
            if (prev.width && prev.height) {
                try { mainWindow.setSize(Math.max(prev.width, 300), Math.max(prev.height, 60)); } catch (e) {}
            }
            // If previous x/y present, use them; we'll validate they are within a display
            if (typeof prev.x === 'number' && typeof prev.y === 'number') {
                // Find a display that contains the saved point; otherwise use primary
                const displays = screen.getAllDisplays();
                const found = displays.find(d => {
                    const b = d.bounds;
                    return prev.x >= b.x && prev.x <= b.x + b.width && prev.y >= b.y && prev.y <= b.y + b.height;
                });
                if (found) {
                    try { mainWindow.setPosition(prev.x, prev.y); } catch (e) {}
                } else {
                    // place relative to primary workArea
                    positionWindowAroundTaskbar(mainWindow);
                    ensureTopMost(mainWindow);
                }
            } else {
                positionWindowAroundTaskbar(mainWindow);
            }
        } else {
            positionWindowAroundTaskbar(mainWindow);
        }
    } catch (err) {
        console.warn('Error restoring window state:', err);
        positionWindowAroundTaskbar(mainWindow);
    }

    mainWindow.loadFile('renderer/index.html');

    mainWindow.on('closed', () => {
        // Clean up intervals when window closes
        stopContinuousKeepTop();
        stopAppBarReregister();
        if (keepTopInterval) { clearInterval(keepTopInterval); keepTopInterval = null; }
        mainWindow = null;
    });

    // Persist window bounds on move/resize (debounced)
    let saveTimeout = null;
    const persistBounds = () => {
        if (!mainWindow) return;
        try {
            const bounds = mainWindow.getBounds();
            // Debounce writes
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                saveWindowState(bounds);
                saveTimeout = null;
            }, 500);
        } catch (err) {
            console.error('Failed to persist bounds:', err);
        }
    };

    mainWindow.on('move', persistBounds);
    mainWindow.on('resize', persistBounds);
    mainWindow.on('close', () => {
        // Write immediately on close
        if (!mainWindow) return;
        try {
            const bounds = mainWindow.getBounds();
            if (saveTimeout) clearTimeout(saveTimeout);
            saveWindowState(bounds);
        } catch (err) {
            // ignore
        }
    });
}

async function createTray() {
    // Prefer using a shipped SVG asset if present (more detailed icon).
    // Path is relative to __dirname/renderer
    const svgPath = path.join(__dirname, 'renderer', 'Spotify_taskbar_overlay_icon.svg');
    let trayIcon;
    // We'll rasterize the provided SVG to a small PNG buffer and use that
    // as the tray icon. This avoids additional native ICO tool dependencies.
    let svgText = null;
    try {
        svgText = await fs.readFile(svgPath, 'utf-8');
    } catch (err) {
        // will fall back to embedded PNG below
        svgText = null;
    }
    try {
        if (svgText) {
            // sanitize common problematic constructs
            let sanitized = svgText.replace(/<defs[\s\S]*?<\/defs>/i, '');
            sanitized = sanitized.replace(/\sfilter="url\(#.*?\)"/gi, '');
            sanitized = sanitized.replace(/<svg([^>]*)width="[^"]*"/i, '<svg$1 width="24"');
            sanitized = sanitized.replace(/<svg([^>]*)height="[^"]*"/i, '<svg$1 height="24"');
            const pngBuffer = await sharp(Buffer.from(sanitized)).resize(16, 16).png().toBuffer();
            const img = nativeImage.createFromBuffer(pngBuffer);
            if (img && !(img.isEmpty && img.isEmpty())) {
                trayIcon = img;
            }
        }
    } catch (err) {
        console.warn('SVG -> PNG tray icon generation failed:', err);
    }
        // If we still don't have a trayIcon, use a tiny embedded PNG as a last resort
        if (!trayIcon) {
            const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJElEQVQ4T2NkoBAwUqifgYGB4T8DAwMDAwMDAwMDAwMDAwMDAwMAwCqUAeZ6wQyAAAAAElFTkSuQmCC';
            trayIcon = nativeImage.createFromDataURL(pngDataUrl).resize({ width: 16, height: 16 });
        }

    tray = new Tray(trayIcon);

    const loginSettings = app.getLoginItemSettings();
    const startAtLogin = !!loginSettings.openAtLogin;

    const contextMenu = Menu.buildFromTemplate(buildContextMenu());

    tray.setToolTip('Spotify Mini Player');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide(); else {
            positionWindowAroundTaskbar(mainWindow);
                ensureTopMost(mainWindow);
            mainWindow.show();
            startKeepTopBurst(mainWindow);
        }
    });
}

app.on('ready', async () => {
    // On Windows, set an explicit AppUserModelID so the app is registered
    // properly with the shell (this helps the tray icon appear correctly
    // in the notification area / show hidden icons area).
    try {
        if (process.platform === 'win32' && app.setAppUserModelId) {
            app.setAppUserModelId('com.madalina.spotify-taskbar-widget');
        }
    } catch (err) {
        console.warn('Could not set AppUserModelId:', err);
    }
    await loadConfig();
    await loadSettings();
    maybeLog('[main] Configured scopes:', config?.scopes);
    currentTokens = await loadTokens();
    createWindow();
    await createTray();

    // If user had dockToTaskbar enabled previously, try registering AppBar now
    if (settings?.dockToTaskbar && !settings?.disableAppBar) {
        try {
            // wait a tick for window to be created
            setTimeout(() => {
                try { registerAppBar(mainWindow, settings.appbarEdge, settings.appbarThickness).catch(e => console.warn('AppBar register failed at startup:', e)); } catch (e) {}
            }, 400);
        } catch (e) { console.warn('Failed scheduling AppBar register:', e); }
    }

    // Always show the widget when the app starts
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });
    // Re-assert topmost and reposition when displays change (taskbar moved, resolution change, etc.)
    screen.on('display-metrics-changed', () => {
        try {
            if (!mainWindow) return;
            const display = screen.getPrimaryDisplay();
            const workArea = display.workArea;
            const x = Math.round(workArea.x + (workArea.width - APP_WIDTH) / 2);
            const y = Math.round(workArea.y + workArea.height - APP_HEIGHT - 8);
            mainWindow.setPosition(x, y);
            mainWindow.setAlwaysOnTop(true, 'screen-saver');
            ensureTopMost(mainWindow);
        } catch (err) {
            console.error('Error re-positioning on display change:', err);
        }
    });

    // Reassert topmost on focus/blur/show events — help prevent being hidden under taskbar
    app.on('browser-window-focus', () => ensureTopMost(mainWindow));
    app.on('browser-window-blur', () => ensureTopMost(mainWindow));
    mainWindow.on('show', () => ensureTopMost(mainWindow));
    mainWindow.on('show', () => { if (settings.keepTopAlways) startContinuousKeepTop(mainWindow); });
    mainWindow.on('hide', () => { if (settings.keepTopAlways) stopContinuousKeepTop(); });
});

app.on('window-all-closed', () => {
    // Do not quit the app when windows are closed; keep the tray running
    // so the app can act like a background widget/service.
    if (process.platform === 'darwin') {
        // On macOS keep the app running in dock as usual.
    } else {
        // On Windows/Linux we keep the process alive for the tray.
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('before-quit', async () => {
    try { if (settings.dockToTaskbar && mainWindow) await unregisterAppBar(mainWindow); } catch (e) {}
});

// --- Spotify API Helpers ---

async function ensureAccessToken() {
    // Load tokens if not already in memory
    currentTokens = currentTokens || await loadTokens();
    if (!currentTokens) return null;

    const now = Math.floor(Date.now() / 1000);
    const tokenExpiresAt = (currentTokens.obtained_at || 0) + (currentTokens.expires_in || 0);
    if (now >= tokenExpiresAt - REFRESH_SKEW_SECONDS) {
    maybeLog('Access token expired or about to expire, refreshing...');
        const newTokens = await refreshTokens(currentTokens.refresh_token, config);
        if (newTokens) {
            currentTokens = newTokens;
            return currentTokens.access_token;
        } else {
            console.error('Failed to refresh token. User needs to re-authenticate.');
            await clearTokens();
            currentTokens = null;
            mainWindow?.webContents.send('auth-required');
            return null;
        }
    }

    return currentTokens.access_token;
}

async function spotifyFetch(endpoint, method = 'GET', body = null) {
    const accessToken = await ensureAccessToken();
    if (!accessToken) {
        return { error: { status: 401, message: 'Not authorized' } };
    }

    const url = `https://api.spotify.com/v1${endpoint}`;
    const options = { method, headers: { 'Authorization': `Bearer ${accessToken}` } };
    if (body) {
        options.body = typeof body === 'string' ? body : JSON.stringify(body);
        options.headers['Content-Type'] = 'application/json';
    }

    try {
        const res = await fetch(url, options);
        const status = res.status;
        if (status === 204) return { status: 204 };
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            return { error: { status, message: (data && data.error && data.error.message) || res.statusText }, data };
        }
        return { status, data };
    } catch (err) {
        return { error: { status: 0, message: err.message } };
    }
}

// --- IPC Handlers ---

ipcMain.handle('player:getNowPlaying', async () => {
    if (!currentTokens) {
       currentTokens = await loadTokens();
       if (!currentTokens) return { status: 'unauthorized' };
    }

    const response = await spotifyFetch('/me/player/currently-playing');

    if (response.error) {
        if (response.error.status === 401) {
            await clearTokens();
            currentTokens = null;
            return { status: 'unauthorized' };
        }
        return { status: 'error', message: response.error.message };
    }

    if (response.status === 204 || !response.data || !response.data.item) {
        const deviceCheck = await spotifyFetch('/me/player');
        if (!deviceCheck.data) {
             return { status: 'no-device' };
        }
        return { status: 'idle' };
    }

    const item = response.data.item;
    return {
        status: 'playing',
        isPlaying: response.data.is_playing,
        track: {
            id: item.id,
            title: item.name,
            artists: item.artists.map(a => a.name).join(', '),
            albumArtUrl: item.album.images[0]?.url,
        }
    };
});

// Check whether the current track is saved (liked) by the user
ipcMain.handle('player:isLiked', async () => {
    // Get currently playing track
    const response = await spotifyFetch('/me/player/currently-playing');
    if (response.error) {
        return { error: response.error.message };
    }
    if (response.status === 204 || !response.data || !response.data.item) {
        return { error: 'No track playing' };
    }
    const id = response.data.item.id;
    const contains = await spotifyFetch(`/me/tracks/contains?ids=${encodeURIComponent(id)}`);
    if (contains.error) return { error: contains.error.message };
    if (!Array.isArray(contains.data)) return { error: 'Unexpected response' };
    return { liked: !!contains.data[0] };
});

// Toggle like (save/remove) for the currently playing track
ipcMain.handle('player:toggleLike', async () => {
    const response = await spotifyFetch('/me/player/currently-playing');
    if (response.error) return { error: response.error.message };
    if (response.status === 204 || !response.data || !response.data.item) return { error: 'No track playing' };
    const id = response.data.item.id;

    const contains = await spotifyFetch(`/me/tracks/contains?ids=${encodeURIComponent(id)}`);
    if (contains.error) return { error: contains.error.message };
    const isLiked = Array.isArray(contains.data) && contains.data[0];

    if (isLiked) {
        // remove
        const res = await spotifyFetch(`/me/tracks?ids=${encodeURIComponent(id)}`, 'DELETE');
        if (res.error) return { error: res.error.message };
        return { liked: false };
    } else {
        const res = await spotifyFetch(`/me/tracks?ids=${encodeURIComponent(id)}`, 'PUT');
        if (res.error) return { error: res.error.message };
        return { liked: true };
    }
});

async function sendPlaybackCommand(command) {
    const method = (command === 'next' || command === 'previous') ? 'POST' : 'PUT';
    const endpoint = `/me/player/${command}`;

    const response = await spotifyFetch(endpoint, method);

    if (response.error && response.error.status === 404) {
        return { error: 'No active device found. Start playing music on Spotify.' };
    }
    if (response.error) {
        return { error: response.error.message };
    }
    return { success: true };
}

ipcMain.handle('player:playPause', async () => {
    const stateResponse = await spotifyFetch('/me/player');

    if (stateResponse.error) {
        if (stateResponse.error.status === 401) {
            await clearTokens();
            currentTokens = null;
            mainWindow?.webContents.send('auth-required');
            return { error: 'Not authorized. Please reconnect.' };
        }
        return { error: stateResponse.error.message || 'Could not get player state.' };
    }

    if (stateResponse.status === 204 || !stateResponse.data) {
        return { error: 'No active device found. Start playing on Spotify.' };
    }

    const isPlaying = stateResponse.data.is_playing;
    return await sendPlaybackCommand(isPlaying ? 'pause' : 'play');
});

ipcMain.handle('player:next', () => sendPlaybackCommand('next'));
ipcMain.handle('player:prev', () => sendPlaybackCommand('previous'));

ipcMain.handle('player:authorize', () => {
    maybeLog('[main] authorize invoked from renderer');
    startAuthFlow(config, () => {
        currentTokens = null; // Force re-load of tokens
        mainWindow?.webContents.send('auth-success');
    });
    // Return a small ack so the renderer's invoke promise resolves.
    return { status: 'auth-started' };
});

ipcMain.handle('player:logout', async () => {
    await clearTokens();
    currentTokens = null;
    return { status: 'logged-out' };
});

// Remove noisy renderer debug bridge (leftover) to keep terminal quiet.

// Keep-top helper: when the window is shown, reassert topmost repeatedly
// for a short burst to avoid it slipping under the taskbar.
let keepTopInterval = null;
function startKeepTopBurst(win, durationMs = 8000, intervalMs = 800) {
    if (!win) return;
    // Clear any existing burst
    if (keepTopInterval) {
        clearInterval(keepTopInterval);
        keepTopInterval = null;
    }
    const start = Date.now();
    ensureTopMost(win);
    keepTopInterval = setInterval(() => {
        if (!win || win.isDestroyed()) {
            clearInterval(keepTopInterval);
            keepTopInterval = null;
            return;
        }
        ensureTopMost(win);
        if (Date.now() - start > durationMs) {
            clearInterval(keepTopInterval);
            keepTopInterval = null;
        }
    }, intervalMs);
}

let continuousKeepTopInterval = null;
function startContinuousKeepTop(win, intervalMs = 2000) { // Reduced from 1s to 2s
    stopContinuousKeepTop();
    if (!win) return;
    continuousKeepTopInterval = setInterval(() => {
        if (!win || win.isDestroyed()) { stopContinuousKeepTop(); return; }
        ensureTopMost(win);
    }, intervalMs);
}
function stopContinuousKeepTop() {
    if (continuousKeepTopInterval) { clearInterval(continuousKeepTopInterval); continuousKeepTopInterval = null; }
}

let appbarReregisterInterval = null;
function startAppBarReregister(win, edge, thickness, intervalMs = 60000) { // Increased from 30s to 60s
    stopAppBarReregister();
    appbarReregisterInterval = setInterval(() => {
        if (!win || win.isDestroyed()) { stopAppBarReregister(); return; }
        registerAppBar(win, edge, thickness).catch(e => console.warn('AppBar re-register failed:', e));
    }, intervalMs);
}
function stopAppBarReregister() { if (appbarReregisterInterval) { clearInterval(appbarReregisterInterval); appbarReregisterInterval = null; } }

// AppBar helper wrapper
function getHwndFromWindow(win) {
    if (!win) return null;
    try {
        const buf = win.getNativeWindowHandle();
        // Buffer is pointer-sized little-endian. For x64 read 64-bit, else 32-bit.
        if (process.arch === 'x64') return Number(buf.readBigUInt64LE(0));
        return buf.readUInt32LE(0);
    } catch (e) { return null; }
}

// Resolve AppBar helper executable or DLL. Returns { command, argsPrefix } or throws.
function resolveAppBarHelperInvocation() {
    const helperDir = path.join(__dirname, 'tools', 'appbar-helper');
    const candidates = [
        path.join(helperDir, 'publish', 'win-x64', 'AppBarHelper.exe'),
        path.join(helperDir, 'publish', 'win-x64', 'AppBarHelper.dll'),
        path.join(helperDir, 'AppBarHelper.exe'),
        path.join(helperDir, 'AppBarHelper.dll'),
        path.join(helperDir, 'bin', 'Release', 'net7.0-windows', 'win-x64', 'AppBarHelper.exe'),
        path.join(helperDir, 'bin', 'Release', 'net7.0-windows', 'win-x64', 'AppBarHelper.dll'),
    ];
    for (const p of candidates) {
        if (fsSync.existsSync(p)) {
            if (p.toLowerCase().endsWith('.exe')) return { command: p, argsPrefix: [] };
            if (p.toLowerCase().endsWith('.dll')) return { command: 'dotnet', argsPrefix: [p] };
        }
    }
    throw new Error(`AppBar helper not found. Expected AppBarHelper.exe or AppBarHelper.dll under ${helperDir}`);
}

async function registerAppBar(win, edge = 'bottom', thickness = 48) {
    const hwnd = getHwndFromWindow(win);
    if (!hwnd) throw new Error('no-hwnd');
    return new Promise((resolve, reject) => {
        let child;
        try {
            const inv = resolveAppBarHelperInvocation();
            child = spawn(inv.command, [...inv.argsPrefix, 'register', String(hwnd), edge, String(thickness)], { stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) { return reject(err); }
        let out = '';
        child.stdout.on('data', d => out += d.toString());
        child.stderr.on('data', d => console.warn('[appbar-helper] stderr:', d.toString()));
        child.on('close', (code) => {
            try {
                const parsed = out ? JSON.parse(out) : { ok: code === 0 };
                if (parsed.ok) {
                    // If helper returned a rect, apply it to the BrowserWindow
                    if (parsed.rect && win && !win.isDestroyed()) {
                        try {
                            const w = Math.max(100, parsed.rect.right - parsed.rect.left);
                            const h = Math.max(24, parsed.rect.bottom - parsed.rect.top);
                            win.setBounds({ x: parsed.rect.left, y: parsed.rect.top, width: w, height: h });
                        } catch (e) { console.warn('Failed to set bounds from AppBar rect:', e); }
                    }
                    // Start periodic re-register to handle Explorer restarts
                    try { startAppBarReregister(win, edge, thickness); } catch (e) {}
                    // mark registered and refresh tray menu
                    try { appbarRegistered = true; tray?.setContextMenu(buildContextMenu()); } catch (e) {}
                    resolve(parsed);
                } else reject(parsed.error || 'failed');
            } catch (e) { reject(e); }
        });
    });
}

async function unregisterAppBar(win) {
    const hwnd = getHwndFromWindow(win);
    if (!hwnd) throw new Error('no-hwnd');
    return new Promise((resolve, reject) => {
        let child;
        try {
            const inv = resolveAppBarHelperInvocation();
            child = spawn(inv.command, [...inv.argsPrefix, 'unregister', String(hwnd)], { stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) { return reject(err); }
        let out = '';
        child.stdout.on('data', d => out += d.toString());
        child.stderr.on('data', d => console.warn('[appbar-helper] stderr:', d.toString()));
        child.on('close', (code) => {
            try {
                const parsed = out ? JSON.parse(out) : { ok: code === 0 };
                if (parsed.ok) {
                    // Stop periodic re-register when unregistered
                    try { stopAppBarReregister(); } catch (e) {}
                    try { appbarRegistered = false; tray?.setContextMenu(buildContextMenu()); } catch (e) {}
                    resolve(parsed);
                } else reject(parsed.error || 'failed');
            } catch (e) { reject(e); }
        });
    });
}

async function attachToTaskbar(win) {
    const hwnd = getHwndFromWindow(win);
    if (!hwnd) throw new Error('no-hwnd');
    return new Promise((resolve, reject) => {
        let child;
        try {
            const inv = resolveAppBarHelperInvocation();
            child = spawn(inv.command, [...inv.argsPrefix, 'attach', String(hwnd)], { stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) { return reject(err); }
        let out = '';
        child.stdout.on('data', d => out += d.toString());
        child.stderr.on('data', d => console.warn('[appbar-helper] stderr:', d.toString()));
        child.on('close', (code) => {
            try {
                const parsed = out ? JSON.parse(out) : { ok: code === 0 };
                if (parsed.ok) resolve(parsed); else reject(parsed.error || 'failed');
            } catch (e) { reject(e); }
        });
    });
}

async function detachFromTaskbar(win) {
    const hwnd = getHwndFromWindow(win);
    if (!hwnd) throw new Error('no-hwnd');
    return new Promise((resolve, reject) => {
        let child;
        try {
            const inv = resolveAppBarHelperInvocation();
            child = spawn(inv.command, [...inv.argsPrefix, 'detach', String(hwnd)], { stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) { return reject(err); }
        let out = '';
        child.stdout.on('data', d => out += d.toString());
        child.stderr.on('data', d => console.warn('[appbar-helper] stderr:', d.toString()));
        child.on('close', (code) => {
            try {
                const parsed = out ? JSON.parse(out) : { ok: code === 0 };
                if (parsed.ok) resolve(parsed); else reject(parsed.error || 'failed');
            } catch (e) { reject(e); }
        });
    });
}

// Build the tray context menu template. Separated so other code can refresh it
function buildContextMenu() {
    const loginSettings = app.getLoginItemSettings();
    const startAtLogin = !!loginSettings.openAtLogin;

    return [
        { label: 'Show / Hide', click: () => {
            if (!mainWindow) return;
            if (mainWindow.isVisible()) mainWindow.hide(); else {
                positionWindowAroundTaskbar(mainWindow);
                mainWindow.show();
                startKeepTopBurst(mainWindow);
            }
        } },
        { label: 'Reconnect / Login', click: () => startAuthFlow(config, () => mainWindow?.webContents.send('auth-success')) },
        { label: settings.dockToTaskbar ? 'Floating Mode' : 'Widget Mode (Taskbar-style)', type: 'checkbox', checked: !!settings.dockToTaskbar, click: async () => {
            settings.dockToTaskbar = !settings.dockToTaskbar;
            await saveSettings();
            if (mainWindow) {
                positionWindowAroundTaskbar(mainWindow);
                ensureTopMost(mainWindow);
            }
            try { mainWindow?.webContents.send('docked-changed', !!settings.dockToTaskbar); } catch (e) {}
            try { tray?.setContextMenu(Menu.buildFromTemplate(buildContextMenu())); } catch (e) {}
        } },
        { label: 'Auto-hide on blur', type: 'checkbox', checked: !!settings.autoHideOnBlur, click: async (mi) => {
            settings.autoHideOnBlur = !!mi.checked;
            await saveSettings();
        } },
        //     settings.dockToTaskbar = !settings.dockToTaskbar;
        //     await saveSettings();
        //     if (mainWindow) positionWindowAroundTaskbar(mainWindow);
        //     try { mainWindow?.webContents.send('docked-changed', !!settings.dockToTaskbar); } catch (e) {}
        //     try {
        //         if (settings.dockToTaskbar) await registerAppBar(mainWindow, settings.appbarEdge, settings.appbarThickness);
        //         else await unregisterAppBar(mainWindow);
        //     } catch (e) { console.warn('AppBar helper call failed:', e); }
        //     try { tray?.setContextMenu(Menu.buildFromTemplate(buildContextMenu())); } catch (e) {}
        // } },
        { label: 'Keep on top (continuous)', type: 'checkbox', checked: !!settings?.keepTopAlways, click: async (mi) => {
            settings.keepTopAlways = !!mi.checked;
            await saveSettings();
            if (settings.keepTopAlways) {
                if (mainWindow && mainWindow.isVisible()) startContinuousKeepTop(mainWindow);
            } else {
                stopContinuousKeepTop();
            }
        } },
        { type: 'separator' },
        { label: '🎨 Open DevTools (Design Mode)', click: () => {
            if (mainWindow) {
                if (!mainWindow.isVisible()) mainWindow.show();
                mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
        } },
        { type: 'separator' },
        { label: 'Start at Login', type: 'checkbox', checked: startAtLogin, click: (menuItem) => {
            const enable = !!menuItem.checked;
            try {
                app.setLoginItemSettings({ openAtLogin: enable });
            } catch (err) {
                console.error('Failed to set login item settings:', err);
            }
        } },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
    ];
}