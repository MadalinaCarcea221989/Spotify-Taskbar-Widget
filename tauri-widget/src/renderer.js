document.addEventListener('DOMContentLoaded', () => {
    const POLLING_INTERVAL_ACTIVE = 3000; // 3 seconds when playing
    const POLLING_INTERVAL_IDLE = 8000; // 8 seconds when idle/paused
    const POLLING_INTERVAL_HIDDEN = 15000; // 15 seconds when window hidden
    let pollTimeoutId = null;
    let refreshDebounceTimeout = null;
    let currentPollingInterval = POLLING_INTERVAL_ACTIVE;
    let isWindowVisible = true;
    let localDeviceId = null;
    let activeDeviceId = null;
    const ART_CACHE_KEY = 'spotify_last_art';
    const TRACK_CACHE_KEY = 'spotify_last_track';

    // State
    let currentStatus = 'idle';
    let globalSpotifyState = null;

    let isCurrentlyPlaying = false;
    let trackDurationMs = 0;
    let trackPositionMs = 0;
    let seekTickId = null;
    let isSeeking = false;

    // --- DOM Elements ---
    const views = {
        auth: document.getElementById('auth-view'),
        player: document.getElementById('player-view'),
        message: document.getElementById('message-view'),
    };
    const connectBtn = document.getElementById('connect-btn');
    const closeBtn = document.getElementById('close-btn');
    const albumArtEl = document.getElementById('album-art');
    const titleEl = document.getElementById('title');
    const artistEl = document.getElementById('artist');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const repeatBtn = document.getElementById('repeat-btn');
    const likeBtn = document.getElementById('like-btn');
    const reconnectBtn = document.getElementById('reconnect-btn');
    const devicesBtn = document.getElementById('devices-btn');
    const devicePanel = document.getElementById('device-panel');
    const playlistsBtn = document.getElementById('playlists-btn');
    const playlistPanel = document.getElementById('playlist-panel');
    const splitHandle = document.getElementById('split-handle');
    const messageTextEl = document.getElementById('message-text');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const likeIcon = document.getElementById('like-icon');
    const seekBar = document.getElementById('seek-bar');
    const seekFill = document.getElementById('seek-fill');
    const widgetContainer = document.getElementById('widget-container');

    // --- UI State Management ---
    function formatTime(ms) {
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}:${sec.toString().padStart(2, '0')}`;
    }

    function updateSeekBar(posMs, durMs) {
        if (isSeeking) return;
        trackPositionMs = posMs;
        trackDurationMs = durMs;
        seekBar.max = durMs;
        seekBar.value = posMs;
        
        const pct = durMs > 0 ? (posMs / durMs) * 100 : 0;
        if (seekFill) seekFill.style.width = `${pct}%`;
    }

    function startSeekTick() {
        if (seekTickId) clearInterval(seekTickId);
        seekTickId = setInterval(() => {
            if (!isCurrentlyPlaying || isSeeking) return;
            trackPositionMs = Math.min(trackPositionMs + 1000, trackDurationMs);
            updateSeekBar(trackPositionMs, trackDurationMs);
        }, 1000);
    }

    function stopSeekTick() {
        if (seekTickId) { clearInterval(seekTickId); seekTickId = null; }
    }

    const preloadedImages = new Set();
    function preloadImage(url) {
        if (!url || preloadedImages.has(url)) return;
        const img = new Image();
        img.src = url;
        preloadedImages.add(url);
        // Keep set size reasonable
        if (preloadedImages.size > 20) {
            const first = preloadedImages.values().next().value;
            preloadedImages.delete(first);
        }
    }

    // --- Auto-Focus on Hover ---
    if (widgetContainer) {
        widgetContainer.addEventListener('mouseenter', () => {
            window.__TAURI__.core.invoke('focus_window').catch(() => {});
        });
        // Also trigger on mousemove just in case mouseenter is missed due to window state
        widgetContainer.addEventListener('mousemove', () => {
            // Optional: Debounce if needed, but invoke is cheap
            window.__TAURI__.core.invoke('focus_window').catch(() => {});
        }, { once: true }); // Only once per entry
    }

    function showView(viewName) {
        Object.values(views).forEach(v => v.style.display = 'none');
        if (views[viewName]) {
            views[viewName].style.display = 'flex';
        }
    }

    // --- Startup Optimization: Load Cached State ---
    function loadCachedState() {
        const cachedTrack = localStorage.getItem(TRACK_CACHE_KEY);
        const cachedArt = localStorage.getItem(ART_CACHE_KEY);
        if (cachedTrack && cachedArt) {
            try {
                const track = JSON.parse(cachedTrack);
                updatePlayerUI({ track: { ...track, albumArtUrl: cachedArt }, isPlaying: false });
                updateAccentColor(cachedArt);
            } catch (e) { console.error('Cache load error:', e); }
        }
    }

    // --- Premium Visuals: Dynamic Color Extraction ---
    async function updateAccentColor(imageUrl) {
        if (!imageUrl) return;
        
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = imageUrl;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 1;
            canvas.height = 1;
            ctx.drawImage(img, 0, 0, 1, 1);
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
            
            // Brighten and saturate for a premium look
            const hsv = rgbToHsv(r, g, b);
            const accent = hsvToRgb(hsv.h, Math.max(hsv.s, 0.7), Math.max(hsv.v, 0.8));
            
            document.documentElement.style.setProperty('--accent-color', `rgb(${accent.r}, ${accent.g}, ${accent.b})`);
            localStorage.setItem(ART_CACHE_KEY, imageUrl);
        };
    }

    function rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, v = max;
        const d = max - min;
        s = max === 0 ? 0 : d / max;
        if (max === min) { h = 0; }
        else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h, s, v };
    }

    function hsvToRgb(h, s, v) {
        let r, g, b;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
    }

    // --- OS media session (Windows media controls, Fenn, lock screen) ---
    // The widget plays no audio itself, so a web Media Session never reaches the
    // OS: Windows only lists an app that is actually playing. Instead Rust
    // registers a native session and we push every real poll result into it.
    // Its play/pause/next/previous buttons come back through the existing
    // "media-key" listener below.
    function syncOsMediaSession(data) {
        if (!window.player.updateMediaSession) return;
        if (!data || !data.track) {
            window.player.updateMediaSession(null);
            return;
        }
        const { track, isPlaying, progressMs } = data;
        window.player.updateMediaSession({
            title: track.title || '',
            artist: track.artists || '',
            album: track.album || '',
            coverUrl: track.albumArtUrl || '',
            durationMs: track.durationMs || 0,
            positionMs: progressMs || 0,
            isPlaying: !!isPlaying
        });
    }

    function updatePlayerUI(data) {
        if (!data || !data.track) {
            titleEl.textContent = localDeviceId ? 'Ready to Play' : 'No Active Device';
            artistEl.textContent = localDeviceId ? 'Click Play to start local player' : 'Start playing on any device';
            albumArtEl.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            if (playIcon && pauseIcon) {
                playIcon.style.display = '';
                pauseIcon.style.display = 'none';
            }
            return;
        }

        const { track, isPlaying } = data;
        titleEl.textContent = track.title || 'Unknown Title';
        artistEl.textContent = track.artists || 'Unknown Artist';
        
        // Cache basic info
        localStorage.setItem(TRACK_CACHE_KEY, JSON.stringify({ title: track.title, artists: track.artists }));

        // Update art and accent color
        if (albumArtEl.src !== track.albumArtUrl) {
            updateAccentColor(track.albumArtUrl);
            albumArtEl.style.transform = 'scale(0.9)';
            albumArtEl.style.opacity = '0.5';
            setTimeout(() => {
                albumArtEl.src = track.albumArtUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                albumArtEl.style.transform = 'scale(1)';
                albumArtEl.style.opacity = '1';
            }, 100);
        }

        if (isPlaying) {
            widgetContainer.style.backgroundColor = 'rgba(20, 20, 20, 0.85)';
            isCurrentlyPlaying = true;
            playIcon.style.display = 'none';
            pauseIcon.style.display = '';
            startSeekTick();
        } else {
            widgetContainer.style.backgroundColor = 'rgba(15, 15, 15, 0.7)';
            isCurrentlyPlaying = false;
            playIcon.style.display = '';
            pauseIcon.style.display = 'none';
            stopSeekTick();
        }
        // Update Shuffle/Repeat states (only if not locked by user interaction)
        if (!shuffleBtn.classList.contains('locked')) {
            if (data.shuffleState) shuffleBtn.classList.add('active');
            else shuffleBtn.classList.remove('active');
        }

        if (!repeatBtn.classList.contains('locked')) {
            repeatBtn.classList.remove('active', 'active-track');
            if (data.repeatState === 'context') repeatBtn.classList.add('active');
            else if (data.repeatState === 'track') repeatBtn.classList.add('active-track');
        }
    }

    function setOptimisticLoading() {
        titleEl.style.opacity = '0.5';
        artistEl.style.opacity = '0.5';
        albumArtEl.style.opacity = '0.5';
    }

    async function refreshLikeState() {
        try {
            const res = await window.player.isLiked();
            if (res?.error) {
                console.warn('isLiked returned error:', res.error);
                // don't spam the user; only show message when they try to like
                return;
            }
            if (res?.liked) {
                likeIcon.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--accent-color') || '#7C4DFF');
                likeIcon.setAttribute('stroke', 'none');
                likeBtn.classList.add('liked');
            } else {
                // empty heart: transparent fill and stroked outline
                likeIcon.setAttribute('fill', 'none');
                likeIcon.setAttribute('stroke', 'currentColor');
                likeBtn.classList.remove('liked');
            }
        } catch (err) {
            console.error('Failed to get like state:', err);
        }
    }

    function showMessage(text) {
        messageTextEl.textContent = text;
        showView('message');
        // Auto-dismiss after 4 seconds and go back to player
        setTimeout(() => {
            if (currentStatus !== 'unauthorized') showView('player');
        }, 4000);
    }

    // --- Core Polling Logic ---
    async function fetchNowPlaying() {
        // Clear previous timeout to prevent race conditions
        if (pollTimeoutId) clearTimeout(pollTimeoutId);

        try {
            const result = await window.player.getNowPlaying();
            currentStatus = result.status || 'idle';
            activeDeviceId = result.activeDeviceId || null;

            switch (result.status) {
                case 'unauthorized':
                    showView('auth');
                    // Stop polling when unauthorized to save resources
                    currentPollingInterval = POLLING_INTERVAL_HIDDEN;
                    break;
                case 'playing':
                    updatePlayerUI(result);
                    syncOsMediaSession(result);
                    showView('player');
                    // Use active polling when playing
                    currentPollingInterval = isWindowVisible ? POLLING_INTERVAL_ACTIVE : POLLING_INTERVAL_HIDDEN;
                    break;
                case 'idle':
                case 'no-device':
                    updatePlayerUI(null);
                    syncOsMediaSession(null);
                    showView('player');
                    // Slower polling when idle or no device
                    currentPollingInterval = isWindowVisible ? POLLING_INTERVAL_IDLE : POLLING_INTERVAL_HIDDEN;
                    break;
                case 'error':
                    showMessage(result.message || 'An unknown error occurred.');
                    currentPollingInterval = POLLING_INTERVAL_IDLE;
                    break;
                default:
                    showView('auth');
                    currentPollingInterval = POLLING_INTERVAL_HIDDEN;
            }
        } catch (error) {
            console.error('Error fetching now playing:', error);
            showMessage('Failed to fetch data.');
            currentPollingInterval = POLLING_INTERVAL_IDLE;
        } finally {
            // Schedule the next poll with adaptive interval
            pollTimeoutId = setTimeout(fetchNowPlaying, currentPollingInterval);
        }
    }

    function immediateRefresh(delayMs = 0) {
        if (refreshDebounceTimeout) clearTimeout(refreshDebounceTimeout);
        if (pollTimeoutId) clearTimeout(pollTimeoutId);
        
        if (delayMs > 0) {
            refreshDebounceTimeout = setTimeout(fetchNowPlaying, delayMs);
        } else {
            fetchNowPlaying();
        }
    }

    // --- Playback actions (shared by on-screen buttons and hardware media keys) ---
    async function handlePlayPause() {
        if (activeDeviceId && activeDeviceId === localDeviceId && window.localSpotifyPlayer) {
            window.localSpotifyPlayer.togglePlay();
            return;
        }

        if ((currentStatus === 'no-device' || currentStatus === 'idle') && localDeviceId) {
            setOptimisticLoading();
            const res = await window.player.transferPlayback(localDeviceId, true);
            if (res?.error) {
                showMessage(res.error.message || 'Error transferring playback');
            } else {
                activeDeviceId = localDeviceId;
                immediateRefresh(500);
            }
            return;
        }

        setOptimisticLoading();
        const result = await window.player.playPause(isCurrentlyPlaying);
        if (result?.error) {
            showMessage(result.error.message || JSON.stringify(result.error));
        } else {
            immediateRefresh(500);
        }
    }

    async function handleNext() {
        // Update UI instantly with next track info from queue, then send command
        if (globalSpotifyState && globalSpotifyState.track_window?.next_tracks?.length > 0) {
            const nextTrack = globalSpotifyState.track_window.next_tracks.shift();
            updatePlayerUI({
                status: 'playing',
                isPlaying: true,
                track: {
                    id: nextTrack.id,
                    title: nextTrack.name,
                    artists: nextTrack.artists.map(a => a.name).join(', '),
                    albumArtUrl: nextTrack.album.images[0]?.url
                }
            });
        } else {
            setOptimisticLoading();
        }

        if (activeDeviceId && activeDeviceId === localDeviceId && window.localSpotifyPlayer) {
            window.localSpotifyPlayer.nextTrack();
            return;
        }

        const result = await window.player.next(activeDeviceId);
        if (result?.error) {
            showMessage(result.error.message || JSON.stringify(result.error));
        } else {
            immediateRefresh(500);
        }
    }

    async function handlePrev() {
        // previous_tracks[0] is the MOST recently played track
        if (globalSpotifyState && globalSpotifyState.track_window?.previous_tracks?.length > 0) {
            const prevTrack = globalSpotifyState.track_window.previous_tracks[0];
            updatePlayerUI({
                status: 'playing',
                isPlaying: true,
                track: {
                    id: prevTrack.id,
                    title: prevTrack.name,
                    artists: prevTrack.artists.map(a => a.name).join(', '),
                    albumArtUrl: prevTrack.album.images[0]?.url
                }
            });
        } else {
            setOptimisticLoading();
        }

        if (activeDeviceId && activeDeviceId === localDeviceId && window.localSpotifyPlayer) {
            window.localSpotifyPlayer.previousTrack();
            return;
        }

        const result = await window.player.prev(activeDeviceId);
        if (result?.error) {
            showMessage(result.error.message || JSON.stringify(result.error));
        } else {
            immediateRefresh(500);
        }
    }

    // --- Event Listeners ---
    connectBtn.addEventListener('click', () => {
        window.player.authorize().catch(err => console.error('authorize error:', err));
    });

    reconnectBtn.addEventListener('click', async () => {
        if (confirm('Force reconnect to Spotify?')) {
            await window.player.logout();
            window.location.reload();
        }
    });

    closeBtn.addEventListener('click', () => {
        window.__TAURI__.core.invoke('exit_app');
    });

    playPauseBtn.addEventListener('click', handlePlayPause);
    nextBtn.addEventListener('click', handleNext);
    prevBtn.addEventListener('click', handlePrev);

    // --- Hardware media keys (registered globally in Rust, work even when unfocused) ---
    window.player.onMediaKey((action) => {
        if (action === 'play_pause') handlePlayPause();
        else if (action === 'next') handleNext();
        else if (action === 'prev') handlePrev();
    });

    // --- Panel icons (per Spotify Connect device type) ---
    const DEVICE_ICONS = {
        Computer: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="1.5"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
        Smartphone: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>',
        Speaker: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><circle cx="12" cy="6" r="1"/></svg>',
        TV: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="14" rx="1.5"/><line x1="8" y1="21" x2="16" y2="21"/></svg>',
    };
    const DEVICE_ICON_DEFAULT = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><path d="M2 12a9 9 0 0 1 8 8"/><path d="M2 16a5 5 0 0 1 4 4"/><line x1="2" y1="20" x2="2.01" y2="20"/></svg>';
    const PLAYLIST_ICON_DEFAULT = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
    const EQ_BARS = '<div class="eq-active"><span></span><span></span><span></span></div>';

    function panelEmptyHtml(text) {
        return `<div class="panel-empty"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/></svg><span>${text}</span></div>`;
    }

    let anyPanelOpen = false;
    let panelCloseTimeout = null;

    // Dragging the bar while a panel is expanded would move the window without
    // Rust's collapsed_y baseline knowing about it, so closing afterward would
    // snap back to the stale pre-drag position. Disabling drag while any panel
    // is open avoids that class of desync entirely.
    function setAnyPanelOpen(open) {
        anyPanelOpen = open;
        widgetContainer.classList.toggle('panel-open', open);
    }

    function closeAllPanels() {
        if (devicePanelOpen) closeDevicePanel();
        if (playlistPanelOpen) closePlaylistPanel();
    }

    // set_panel_expanded calls a Rust command that isn't guaranteed to run in the
    // order it was invoked from JS if two calls overlap (e.g. closing one panel
    // while opening another, or resizing the device popup mid-open). Chaining
    // every call through one promise forces them to execute strictly in the
    // order they were requested, which is what the window-position math assumes.
    let panelInvokeChain = Promise.resolve();
    function invokeSetPanelExpanded(args) {
        panelInvokeChain = panelInvokeChain.then(() =>
            window.__TAURI__.core.invoke('set_panel_expanded', args).catch(() => {})
        );
        return panelInvokeChain;
    }

    // --- Devices: floating popup card ---
    let devicePanelOpen = false;
    let deviceOpenToken = 0; // invalidates a stale open session's async work (getDevices, resize)
    const DEVICE_POPUP_COLLAPSED_HEIGHT = 40; // must match Rust's PANEL_COLLAPSED_HEIGHT
    const DEVICE_POPUP_MARGIN = 12; // space above/below the card within the expanded window

    // Shrinks the window to exactly fit the popup card's real rendered height,
    // instead of a fixed guess — otherwise the outer widget frame shows as empty
    // space around a smaller card, looking like a box within a box.
    function resizeDevicePopupToFit(token) {
        if (token !== deviceOpenToken) return; // a newer open (or a close) superseded this one
        const card = devicePanel.querySelector('.device-popup-card');
        if (!card) return;
        const target = Math.round(DEVICE_POPUP_COLLAPSED_HEIGHT + card.offsetHeight + DEVICE_POPUP_MARGIN);
        invokeSetPanelExpanded({ expanded: true, height: target });
    }

    function renderDeviceRows(devices, token) {
        if (token !== deviceOpenToken) return; // a newer open (or a close) superseded this one
        const card = document.createElement('div');
        card.className = 'device-popup-card';

        if (!devices || devices.length === 0) {
            card.innerHTML = panelEmptyHtml('No devices found');
        } else {
            devices.forEach(device => {
                const row = document.createElement('div');
                row.className = 'panel-row' + (device.is_active ? ' active' : '');
                row.innerHTML =
                    `<span class="row-icon">${DEVICE_ICONS[device.type] || DEVICE_ICON_DEFAULT}</span>` +
                    `<span class="row-text"><span class="row-title">${device.name}</span></span>` +
                    (device.is_active ? EQ_BARS : '');
                row.addEventListener('click', async () => {
                    closeDevicePanel();
                    if (device.is_active) return;
                    setOptimisticLoading();
                    const res = await window.player.transferPlayback(device.id, true);
                    if (res?.error) {
                        showMessage(res.error.message || 'Error transferring playback');
                    } else {
                        activeDeviceId = device.id;
                        immediateRefresh(500);
                    }
                });
                card.appendChild(row);
            });
        }

        devicePanel.innerHTML = '';
        devicePanel.appendChild(card);

        // Anchor the card (and its caret) under the devices button, clamped to stay on-screen.
        const btnRect = devicesBtn.getBoundingClientRect();
        const containerRect = widgetContainer.getBoundingClientRect();
        const caretX = btnRect.left - containerRect.left + btnRect.width / 2;
        const cardWidth = card.offsetWidth;
        const left = Math.max(8, Math.min(containerRect.width - cardWidth - 8, caretX - cardWidth / 2));
        card.style.left = `${left}px`;
        card.style.setProperty('--caret-left', `${caretX - left}px`);
        resizeDevicePopupToFit(token);
    }

    async function openDevicePanel() {
        closePlaylistPanel();
        const token = ++deviceOpenToken; // invalidates any still-in-flight previous open
        devicePanelOpen = true;
        setAnyPanelOpen(true);
        devicesBtn.classList.add('active');
        // Expand generously at first so the card can render at its natural size
        // (it's clamped by the window's available height); resizeDevicePopupToFit()
        // then shrinks the window to match once we know the real content height.
        await invokeSetPanelExpanded({ expanded: true, height: 180 });
        if (token !== deviceOpenToken) return; // closed (or reopened) while this was in flight
        devicePanel.style.display = 'flex';
        devicePanel.innerHTML = `<div class="device-popup-card">${panelEmptyHtml('Loading…')}</div>`;
        resizeDevicePopupToFit(token);

        const res = await window.player.getDevices();
        if (token !== deviceOpenToken) return; // panel was closed (or reopened) while this was in flight
        if (res?.error) {
            devicePanel.innerHTML = `<div class="device-popup-card">${panelEmptyHtml('Could not load devices')}</div>`;
            resizeDevicePopupToFit(token);
            return;
        }
        renderDeviceRows(res.data?.devices, token);
    }

    function closeDevicePanel() {
        if (!devicePanelOpen) return;
        deviceOpenToken++; // invalidate any in-flight open session
        devicePanelOpen = false;
        devicesBtn.classList.remove('active');
        devicePanel.style.display = 'none';
        if (!playlistPanelOpen) {
            setAnyPanelOpen(false);
            invokeSetPanelExpanded({ expanded: false });
        }
    }

    devicesBtn.addEventListener('click', () => {
        if (devicePanelOpen) closeDevicePanel();
        else openDevicePanel();
    });

    // --- Playlists panel: search songs, browse playlists (incl. Liked Songs), drill into a playlist to pick a song ---
    let playlistPanelOpen = false;
    let playlistOpenToken = 0; // invalidates stale async work across open/close/track-navigation
    let playlistView = 'list'; // 'list' | 'tracks'
    let cachedPlaylists = null;
    let currentPlaylist = null;
    let searchDebounceTimeout = null;
    let searchToken = 0;

    const LIKED_SONGS = { id: '__liked__', liked: true, name: 'Liked Songs', images: [] };
    const LIKED_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-6.7-4.35-9.3-8.1C1 10.1 1.6 6.6 4.6 5.1c2.3-1.15 4.6-.3 5.9 1.4l1.5 1.9 1.5-1.9c1.3-1.7 3.6-2.55 5.9-1.4 3 1.5 3.6 5 1.9 7.8C18.7 16.65 12 21 12 21z"/></svg>';
    const SEARCH_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

    function makeTrackRow(track, onClick) {
        const row = document.createElement('div');
        row.className = 'panel-row';
        const art = track.album?.images?.[0]?.url;
        row.innerHTML =
            `<span class="row-icon">${art ? `<img src="${art}" alt="">` : PLAYLIST_ICON_DEFAULT}</span>` +
            `<span class="row-text"><span class="row-title">${track.name}</span>` +
            `<span class="row-subtitle">${(track.artists || []).map(a => a.name).join(', ')}</span></span>`;
        row.addEventListener('click', onClick);
        return row;
    }

    async function playLikedSongs() {
        const res = await window.player.getLikedSongs();
        if (res?.error) return res;
        const uris = (res.data?.items || []).map(i => i.track?.uri).filter(Boolean);
        if (uris.length === 0) return { error: { message: 'No liked songs found' } };
        return window.player.playUris(uris, activeDeviceId || localDeviceId);
    }

    function makePlaylistRow(playlist, subtitleOverride) {
        const row = document.createElement('div');
        row.className = 'panel-row';
        const art = playlist.images?.[0]?.url;
        const icon = playlist.liked ? LIKED_ICON : PLAYLIST_ICON_DEFAULT;
        const subtitle = subtitleOverride ?? `${playlist.owner?.display_name || ''} · ${playlist.tracks?.total ?? 0} songs`;
        row.innerHTML =
            `<span class="row-icon">${art ? `<img src="${art}" alt="">` : icon}</span>` +
            `<span class="row-text"><span class="row-title">${playlist.name}</span>` +
            `<span class="row-subtitle">${subtitle}</span></span>` +
            `<span class="row-action" title="Browse songs"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg></span>`;

        row.addEventListener('click', async () => {
            closePlaylistPanel();
            setOptimisticLoading();
            const res = playlist.liked
                ? await playLikedSongs()
                : await window.player.playContext(playlist.uri, activeDeviceId || localDeviceId);
            if (res?.error) {
                showMessage(res.error.message || 'Error starting playback');
            } else {
                immediateRefresh(500);
            }
        });
        row.querySelector('.row-action').addEventListener('click', (e) => {
            e.stopPropagation();
            openPlaylistTracks(playlist);
        });
        return row;
    }

    function renderPlaylistBrowseList() {
        const body = document.getElementById('playlist-body');
        if (!body) return;
        body.innerHTML = '';
        body.appendChild(makePlaylistRow(LIKED_SONGS, 'Your saved tracks'));
        (cachedPlaylists || []).forEach(playlist => body.appendChild(makePlaylistRow(playlist)));
    }

    async function runSearch(query) {
        const token = ++searchToken;
        const body = document.getElementById('playlist-body');
        if (body) body.innerHTML = panelEmptyHtml('Searching…');

        const res = await window.player.searchTracks(query);
        if (token !== searchToken) return; // a newer search (or list view) superseded this one
        const freshBody = document.getElementById('playlist-body');
        if (!freshBody) return;
        if (res?.error) {
            freshBody.innerHTML = panelEmptyHtml('Search failed');
            return;
        }
        const tracks = res.data?.tracks?.items || [];
        if (tracks.length === 0) {
            freshBody.innerHTML = panelEmptyHtml('No songs found');
            return;
        }
        freshBody.innerHTML = '';
        tracks.forEach(track => {
            freshBody.appendChild(makeTrackRow(track, async () => {
                closePlaylistPanel();
                setOptimisticLoading();
                const deviceId = activeDeviceId || localDeviceId;
                const res = await window.player.playUris([track.uri], deviceId);
                if (res?.error) {
                    showMessage(res.error.message || 'Error playing song');
                    return;
                }
                immediateRefresh(500);
                // A single searched track has no queue behind it and would just stop
                // when it ends, so line up more from the same artist in the background.
                // (Spotify's /recommendations endpoint is restricted to apps with special
                // extended-access approval, so it isn't usable here.)
                queueSimilarTracks(track, deviceId);
            }));
        });
    }

    let cachedMarket = null;
    async function getMarket() {
        if (cachedMarket) return cachedMarket;
        const res = await window.player.getMe();
        cachedMarket = res?.data?.country || 'US';
        return cachedMarket;
    }

    async function queueSimilarTracks(track, deviceId) {
        const artistId = track.artists?.[0]?.id;
        if (!artistId) return;
        const market = await getMarket();
        const res = await window.player.getArtistTopTracks(artistId, market);
        if (res?.error) return;
        const uris = (res.data?.tracks || [])
            .map(t => t.uri)
            .filter(uri => uri && uri !== track.uri)
            .slice(0, 8);
        for (const uri of uris) {
            try {
                await window.player.queueTrack(uri, deviceId);
            } catch {
                // Best-effort background queueing; one failed track shouldn't stop the rest.
            }
        }
    }

    function onSearchInput(e) {
        const query = e.target.value.trim();
        if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
        if (!query) {
            searchToken++; // invalidate any in-flight search
            renderPlaylistBrowseList();
            return;
        }
        searchDebounceTimeout = setTimeout(() => runSearch(query), 300);
    }

    function renderPlaylistListView() {
        playlistPanel.innerHTML =
            `<div class="panel-search-wrap"><span class="panel-search-icon">${SEARCH_ICON}</span>` +
            '<input type="text" id="playlist-search-input" class="panel-search" placeholder="Search songs…" autocomplete="off"></div>' +
            '<div class="panel-body" id="playlist-body"></div>';
        document.getElementById('playlist-search-input').addEventListener('input', onSearchInput);
        renderPlaylistBrowseList();
    }

    async function openPlaylistTracks(playlist) {
        const token = ++playlistOpenToken; // also invalidates a same-playlist fetch already in flight
        currentPlaylist = playlist;
        playlistView = 'tracks';
        playlistPanel.innerHTML =
            `<div class="panel-header clickable" id="playlist-back"><span class="back-chevron"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></span>${playlist.name}</div>` +
            `<div class="panel-body" id="playlist-body">${panelEmptyHtml('Loading…')}</div>`;
        document.getElementById('playlist-back').addEventListener('click', () => {
            playlistOpenToken++; // invalidate any in-flight fetch for the playlist we're leaving
            playlistView = 'list';
            renderPlaylistListView();
        });

        const res = playlist.liked
            ? await window.player.getLikedSongs()
            : await window.player.getPlaylistTracks(playlist.id);
        if (token !== playlistOpenToken) return; // navigated away (or panel closed/reopened) while loading
        const body = document.getElementById('playlist-body');
        if (res?.error) {
            body.innerHTML = panelEmptyHtml('Could not load songs');
            return;
        }
        const tracks = (res.data?.items || []).map(i => i.track).filter(Boolean);
        if (tracks.length === 0) {
            body.innerHTML = panelEmptyHtml('No songs found');
            return;
        }
        const uris = tracks.map(t => t.uri);
        body.innerHTML = '';
        tracks.forEach((track, idx) => {
            body.appendChild(makeTrackRow(track, async () => {
                closePlaylistPanel();
                setOptimisticLoading();
                const res = playlist.liked
                    ? await window.player.playUris(uris, activeDeviceId || localDeviceId, idx)
                    : await window.player.playContext(playlist.uri, activeDeviceId || localDeviceId, track.uri);
                if (res?.error) {
                    showMessage(res.error.message || 'Error playing song');
                } else {
                    immediateRefresh(500);
                }
            }));
        });
    }

    async function openPlaylistPanel() {
        closeDevicePanel();
        const token = ++playlistOpenToken; // invalidates any still-in-flight previous open
        playlistPanelOpen = true;
        setAnyPanelOpen(true);
        playlistView = 'list';
        playlistsBtn.classList.add('active');
        await invokeSetPanelExpanded({ expanded: true });
        if (token !== playlistOpenToken) return; // closed (or reopened) while this was in flight
        playlistPanel.style.display = 'flex';

        if (cachedPlaylists) {
            renderPlaylistListView();
        } else {
            playlistPanel.innerHTML = `<div class="panel-header">Playlists</div><div class="panel-body">${panelEmptyHtml('Loading…')}</div>`;
            const res = await window.player.getPlaylists();
            if (token !== playlistOpenToken) return; // closed (or reopened) while loading
            if (res?.error) {
                playlistPanel.innerHTML = `<div class="panel-header">Playlists</div><div class="panel-body">${panelEmptyHtml('Could not load playlists')}</div>`;
                return;
            }
            cachedPlaylists = res.data?.items || [];
            renderPlaylistListView();
        }
    }

    function closePlaylistPanel() {
        if (!playlistPanelOpen) return;
        playlistOpenToken++; // invalidate any in-flight open/track-fetch session
        playlistPanelOpen = false;
        playlistsBtn.classList.remove('active');
        playlistPanel.style.display = 'none';
        if (!devicePanelOpen) {
            setAnyPanelOpen(false);
            invokeSetPanelExpanded({ expanded: false });
        }
    }

    playlistsBtn.addEventListener('click', () => {
        if (playlistPanelOpen) closePlaylistPanel();
        else openPlaylistPanel();
    });

    widgetContainer.addEventListener('mouseleave', () => {
        if (panelCloseTimeout) clearTimeout(panelCloseTimeout);
        panelCloseTimeout = setTimeout(() => {
            if (anyPanelOpen) closeAllPanels();
        }, 600);
    });
    widgetContainer.addEventListener('mouseenter', () => {
        if (panelCloseTimeout) clearTimeout(panelCloseTimeout);
    });

    // --- Title/buttons split handle: drag to trade space between the track
    // title and the control buttons (which shrink/grow in place via CSS
    // transform). Window width itself never changes, only the internal split. ---
    const CTRL_SCALE_KEY = 'spotify_ctrl_scale';
    const CTRL_SCALE_MIN = 0.55;
    const CTRL_SCALE_MAX = 1;
    const ACTION_GROUP_NATURAL_WIDTH = 271;

    let splitCurrentScale = 1;

    // persist=false during a drag: localStorage.setItem is synchronous and can run
    // at pointermove frequency (100Hz+ on precision trackpads), so only the CSS
    // variable updates live; the final value is persisted once on release.
    function applyCtrlScale(scale, persist = true) {
        const clamped = Math.max(CTRL_SCALE_MIN, Math.min(CTRL_SCALE_MAX, scale));
        document.documentElement.style.setProperty('--ctrl-scale', clamped);
        splitCurrentScale = clamped;
        if (persist) localStorage.setItem(CTRL_SCALE_KEY, clamped);
        return clamped;
    }

    const savedCtrlScale = parseFloat(localStorage.getItem(CTRL_SCALE_KEY));
    applyCtrlScale(Number.isFinite(savedCtrlScale) ? savedCtrlScale : 1);

    let splitDragStartX = 0;
    let splitDragStartScale = 1;

    splitHandle.addEventListener('pointerdown', (e) => {
        // Stop this from bubbling to the widget's data-tauri-drag-region container,
        // which would otherwise start moving the whole window instead of resizing.
        e.preventDefault();
        e.stopPropagation();
        splitDragStartX = e.clientX;
        splitDragStartScale = splitCurrentScale;
        splitHandle.classList.add('dragging');
        splitHandle.setPointerCapture(e.pointerId);
    });
    splitHandle.addEventListener('pointermove', (e) => {
        if (!splitHandle.hasPointerCapture(e.pointerId)) return;
        const deltaX = e.clientX - splitDragStartX;
        // Dragging right shrinks the buttons (title grows); dragging left grows them back.
        applyCtrlScale(splitDragStartScale - deltaX / ACTION_GROUP_NATURAL_WIDTH, false);
    });
    function endSplitDrag(e) {
        splitHandle.classList.remove('dragging');
        if (splitHandle.hasPointerCapture(e.pointerId)) splitHandle.releasePointerCapture(e.pointerId);
        localStorage.setItem(CTRL_SCALE_KEY, splitCurrentScale);
    }
    // pointercancel fires instead of pointerup when the OS revokes capture mid-drag
    // (e.g. a system gesture or an alt-tab) — without handling it too, ".dragging"
    // could stay stuck highlighted until the next full drag cycle.
    splitHandle.addEventListener('pointerup', endSplitDrag);
    splitHandle.addEventListener('pointercancel', endSplitDrag);

    likeBtn.addEventListener('click', async () => {
        const res = await window.player.toggleLike();
        if (res?.error) {
            console.error('Like toggle failed:', res.error);
            showMessage('Failed to toggle Like. Please reconnect to grant library permissions.');
            return;
        }
        refreshLikeState();
    });

    let shuffleRepeatLockTimeout = null;

    shuffleBtn.addEventListener('click', async () => {
        if (shuffleRepeatLockTimeout) clearTimeout(shuffleRepeatLockTimeout);
        
        const isActive = shuffleBtn.classList.contains('active');
        // Optimistic update + Lock
        if (!isActive) shuffleBtn.classList.add('active');
        else shuffleBtn.classList.remove('active');
        shuffleBtn.classList.add('locked');
        
        const res = await window.player.shuffle(!isActive, activeDeviceId);
        
        // Unlock after 2 seconds
        shuffleRepeatLockTimeout = setTimeout(() => {
            shuffleBtn.classList.remove('locked');
            repeatBtn.classList.remove('locked');
        }, 2000);

        if (res?.error) {
            showMessage(res.error.message);
            shuffleBtn.classList.remove('locked');
            if (!isActive) shuffleBtn.classList.remove('active');
            else shuffleBtn.classList.add('active');
        } else {
            immediateRefresh(1200);
        }
    });

    repeatBtn.addEventListener('click', async () => {
        if (shuffleRepeatLockTimeout) clearTimeout(shuffleRepeatLockTimeout);

        const isTrack = repeatBtn.classList.contains('active-track');
        const isContext = repeatBtn.classList.contains('active');
        
        let nextState = 'off';
        if (isTrack) nextState = 'off';
        else if (isContext) nextState = 'track';
        else nextState = 'context';
        
        // Optimistic update + Lock
        repeatBtn.classList.remove('active', 'active-track');
        if (nextState === 'context') repeatBtn.classList.add('active');
        else if (nextState === 'track') repeatBtn.classList.add('active-track');
        repeatBtn.classList.add('locked');

        const res = await window.player.repeat(nextState, activeDeviceId);
        
        shuffleRepeatLockTimeout = setTimeout(() => {
            shuffleBtn.classList.remove('locked');
            repeatBtn.classList.remove('locked');
        }, 2000);

        if (res?.error) {
            showMessage(res.error.message);
            repeatBtn.classList.remove('locked');
            repeatBtn.classList.remove('active', 'active-track');
            if (isTrack) repeatBtn.classList.add('active-track');
            else if (isContext) repeatBtn.classList.add('active');
        } else {
            immediateRefresh(1200);
        }
    });

    // Listen for events from the main process
    window.player.onAuthSuccess(() => {
        window.location.reload();
    });

    window.player.onAuthRequired(() => {
        if (pollTimeoutId) clearTimeout(pollTimeoutId);
        showView('auth');
    });

    // --- Visibility tracking for adaptive polling ---
    document.addEventListener('visibilitychange', () => {
        isWindowVisible = !document.hidden;
        // Immediately adjust polling when visibility changes
        if (isWindowVisible) {
            // Speed up polling when visible
            if (pollTimeoutId) {
                clearTimeout(pollTimeoutId);
                pollTimeoutId = setTimeout(fetchNowPlaying, 500);
            }
        }
    });

    // Initialize
    loadCachedState();
    fetchNowPlaying();
    // and initial like state
    refreshLikeState();

    window.onSpotifyWebPlaybackSDKReady = () => {
        const player = new Spotify.Player({
            name: 'Spotify Taskbar Widget',
            getOAuthToken: async cb => {
                const token = await window.player.getAccessToken();
                cb(token);
            },
            volume: 0.5
        });

        window.localSpotifyPlayer = player;
        
        player.addListener('ready', ({ device_id }) => {
            console.log('Ready with Device ID', device_id);
            localDeviceId = device_id;
            immediateRefresh();
        });

        player.addListener('not_ready', ({ device_id }) => {
            console.log('Device ID has gone offline', device_id);
            localDeviceId = null;
        });

        player.addListener('player_state_changed', state => {
            if (!state) return;
            globalSpotifyState = state;
            
            // Instantly update the UI without a network request!
            const track = state.track_window.current_track;
            if (track) {
                currentStatus = 'playing';
                updatePlayerUI({
                    status: 'playing',
                    isPlaying: !state.paused,
                    track: {
                        id: track.id,
                        title: track.name,
                        artists: track.artists.map(a => a.name).join(', '),
                        albumArtUrl: track.album.images[0]?.url
                    }
                });
                // Update seek bar with accurate SDK position
                updateSeekBar(state.position, state.duration);
                refreshLikeState();

                // Preload next and previous track images
                if (state.track_window?.next_tracks) {
                    state.track_window.next_tracks.slice(0, 2).forEach(t => {
                        if (t.album?.images?.[0]?.url) preloadImage(t.album.images[0].url);
                    });
                }
                if (state.track_window?.previous_tracks) {
                    state.track_window.previous_tracks.slice(0, 1).forEach(t => {
                        if (t.album?.images?.[0]?.url) preloadImage(t.album.images[0].url);
                    });
                }
            }
        });

        player.connect();
    };

    // Dynamically load the SDK script so it executes after we've defined the callback
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    document.body.appendChild(script);

    // --- Dock state handling ---
    async function applyDockState(docked) {
        if (docked) document.documentElement.classList.add('docked');
        else document.documentElement.classList.remove('docked');
    }

    (async () => {
        try {
            const docked = await window.player.getDockState();
            applyDockState(!!docked);
        } catch (e) {}
        // Listen for changes
        window.player.onDockChanged((d) => applyDockState(!!d));
    })();

    // --- Seek bar interaction ---
    seekBar.addEventListener('mousedown', () => { isSeeking = true; });
    seekBar.addEventListener('input', () => {
        const posMs = Number(seekBar.value);
        const pct = trackDurationMs > 0 ? (posMs / trackDurationMs) * 100 : 0;
        if (seekFill) seekFill.style.width = `${pct}%`;
    });
    seekBar.addEventListener('change', async () => {
        const posMs = Number(seekBar.value);
        trackPositionMs = posMs;
        isSeeking = false;
        if (window.localSpotifyPlayer && activeDeviceId === localDeviceId) {
            await window.localSpotifyPlayer.seek(posMs);
        } else {
            await window.player.seek(posMs);
        }
        immediateRefresh(1200);
    });
    seekBar.addEventListener('mouseup', () => { isSeeking = false; });

    // Native Tauri dragging is handled by data-tauri-drag-region in HTML
    
    // Right click anywhere to cleanly exit the app
    window.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.__TAURI__.core.invoke('exit_app');
    });

    // --- Cleanup on window close ---
    window.addEventListener('beforeunload', () => {
        if (pollTimeoutId) clearTimeout(pollTimeoutId);
        window.player.cleanupListeners();
    });
});