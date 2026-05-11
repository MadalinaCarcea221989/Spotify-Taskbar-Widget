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

    // --- Media Key Integration: Media Session API ---
    function setupMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => { window.player.play(); immediateRefresh(100); });
            navigator.mediaSession.setActionHandler('pause', () => { window.player.pause(); immediateRefresh(100); });
            navigator.mediaSession.setActionHandler('previoustrack', () => { window.player.prev(); immediateRefresh(300); });
            navigator.mediaSession.setActionHandler('nexttrack', () => { window.player.next(); immediateRefresh(300); });
            
            // Keep media session alive with a silent dummy audio if needed
            const dummyAudio = document.getElementById('dummy-audio');
            dummyAudio.volume = 0.01;
            
            // Trigger playback on first user interaction to unlock audio
            document.addEventListener('click', () => {
                dummyAudio.play().catch(() => {});
            }, { once: true });
        }
    }

    function updateMediaSessionMetadata(track, isPlaying) {
        if ('mediaSession' in navigator && track) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.title,
                artist: track.artists,
                album: '',
                artwork: [{ src: track.albumArtUrl, sizes: '512x512', type: 'image/png' }]
            });
            navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
        }
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
            updateMediaSessionMetadata(track, isPlaying);
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
                    showView('player');
                    // Use active polling when playing
                    currentPollingInterval = isWindowVisible ? POLLING_INTERVAL_ACTIVE : POLLING_INTERVAL_HIDDEN;
                    break;
                case 'idle':
                case 'no-device':
                    updatePlayerUI(null);
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

    // --- Event Listeners ---
    connectBtn.addEventListener('click', () => {
        window.player.authorize().catch(err => console.error('authorize error:', err));
    });

    reconnectBtn.addEventListener('click', async () => {
        if (confirm('Force reconnect to Spotify?')) {
            await window.__TAURI__.core.invoke('logout');
            window.location.reload();
        }
    });

    closeBtn.addEventListener('click', () => {
        window.__TAURI__.core.invoke('exit_app');
    });

    playPauseBtn.addEventListener('click', async () => {
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
    });

    likeBtn.addEventListener('click', async () => {
        const res = await window.player.toggleLike();
        if (res?.error) {
            console.error('Like toggle failed:', res.error);
            showMessage('Failed to toggle Like. Please reconnect to grant library permissions.');
            return;
        }
        refreshLikeState();
    });

    nextBtn.addEventListener('click', async () => {
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
    });

    prevBtn.addEventListener('click', async () => {
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
    setupMediaSession();
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