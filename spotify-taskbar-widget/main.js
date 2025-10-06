import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';

import { loadTokens, clearTokens } from './tokenStore.js';
import { startAuthFlow, refreshTokens } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_WIDTH = 380;
const APP_HEIGHT = 80;
const REFRESH_SKEW_SECONDS = 30;

let mainWindow;
let tray;
let config;
let currentTokens;

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

function createWindow() {
    mainWindow = new BrowserWindow({
        width: APP_WIDTH,
        height: APP_HEIGHT,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile('renderer/index.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createTray() {
    // A simple 16x16 icon to avoid needing a file asset.
    const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACJSURBVDhPY/z//z8DNwAAmf8zMDEYJshgYGBgYPh/ZkYGBgYGRgYQfwbiPSCfDMRBHdDw/w8wApB5gRifgQYY/v9XJABmnzD8//+zMAZGBoYoXMLx/0IaQFVANwOk/AeyARtYz8DAwMbAxMDFQMJ/wJ2A6j9JN8DUAvX/gfg/OP3/D0wQNmAnoNaBhAADAFp8T8h9Lp+lAAAAAElFTkSuQmCC');
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show / Hide', click: () => mainWindow?.isVisible() ? mainWindow.hide() : mainWindow.show() },
        { label: 'Reconnect / Login', click: () => startAuthFlow(config, () => mainWindow?.webContents.send('auth-success')) },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
    ]);

    tray.setToolTip('Spotify Mini Player');
    tray.setContextMenu(contextMenu);
}

app.on('ready', async () => {
    await loadConfig();
    currentTokens = await loadTokens();
    createWindow();
    createTray();

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// --- Spotify API Helpers ---

async function spotifyFetch(endpoint, method = 'GET', body = null) {
    const accessToken = await ensureAccessToken();
    if (!accessToken) {
        console.log('No access token available for API call.');
        return { error: { status: 401, message: 'Not authorized' } };
    }

    const url = `https://api.spotify.com/v1${endpoint}`;
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    };
    if (body) {
        options.body = JSON.stringify(body);
        options.headers['Content-Type'] = 'application/json';
    }

    try {
        const response = await fetch(url, options);

        if (response.status === 204) {
            return { data: null, status: 204 };
        }
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({ message: 'Failed to parse error body' }));
            return { error: { status: response.status, message: errorBody.error?.message || 'Unknown API error' } };
        }

        return { data: await response.json(), status: response.status };

    } catch (error) {
        console.error(`Error fetching ${url}:`, error);
        return { error: { status: 500, message: 'Network request failed' } };
    }
}

async function ensureAccessToken() {
    if (!currentTokens) {
        currentTokens = await loadTokens();
        if (!currentTokens) return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const tokenExpiresAt = currentTokens.obtained_at + currentTokens.expires_in;

    if (now >= tokenExpiresAt - REFRESH_SKEW_SECONDS) {
        console.log('Access token expired or about to expire, refreshing...');
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
            title: item.name,
            artists: item.artists.map(a => a.name).join(', '),
            albumArtUrl: item.album.images[0]?.url,
        }
    };
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
    startAuthFlow(config, () => {
        currentTokens = null; // Force re-load of tokens
        mainWindow?.webContents.send('auth-success');
    });
});

ipcMain.handle('player:logout', async () => {
    await clearTokens();
    currentTokens = null;
    return { status: 'logged-out' };
});