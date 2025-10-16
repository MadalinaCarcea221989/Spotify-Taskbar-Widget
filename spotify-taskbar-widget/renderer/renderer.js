document.addEventListener('DOMContentLoaded', () => {
    const POLLING_INTERVAL_ACTIVE = 3000; // 3 seconds when playing
    const POLLING_INTERVAL_IDLE = 8000; // 8 seconds when idle/paused
    const POLLING_INTERVAL_HIDDEN = 15000; // 15 seconds when window hidden
    let pollTimeoutId = null;
    let refreshDebounceTimeout = null;
    let currentPollingInterval = POLLING_INTERVAL_ACTIVE;
    let isWindowVisible = true;

    // --- DOM Elements ---
    const views = {
        auth: document.getElementById('auth-view'),
        player: document.getElementById('player-view'),
        message: document.getElementById('message-view'),
    };
    const connectBtn = document.getElementById('connect-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const albumArtEl = document.getElementById('album-art');
    const titleEl = document.getElementById('title');
    const artistEl = document.getElementById('artist');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const likeBtn = document.getElementById('like-btn');
    const messageTextEl = document.getElementById('message-text');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const likeIcon = document.getElementById('like-icon');

    // --- UI State Management ---
    function showView(viewName) {
        Object.values(views).forEach(v => v.style.display = 'none');
        if (views[viewName]) {
            views[viewName].style.display = 'flex';
        }
    }

    function updatePlayerUI(data) {
        if (!data || !data.track) {
            titleEl.textContent = 'Not Playing';
            artistEl.textContent = '';
            albumArtEl.src = '';
            playPauseBtn.textContent = '⏯';
            return;
        }

        const { track, isPlaying } = data;
        titleEl.textContent = track.title || 'Unknown Title';
        artistEl.textContent = track.artists || 'Unknown Artist';
        albumArtEl.src = track.albumArtUrl || '';
        if (isPlaying) {
            playIcon.style.display = 'none';
            pauseIcon.style.display = '';
        } else {
            playIcon.style.display = '';
            pauseIcon.style.display = 'none';
        }
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
    }

    // --- Core Polling Logic ---
    async function fetchNowPlaying() {
        // Clear previous timeout to prevent race conditions
        if (pollTimeoutId) clearTimeout(pollTimeoutId);

        try {
            const result = await window.player.getNowPlaying();

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
                    showMessage('Playback is paused or stopped.');
                    // Slower polling when idle
                    currentPollingInterval = isWindowVisible ? POLLING_INTERVAL_IDLE : POLLING_INTERVAL_HIDDEN;
                    break;
                case 'no-device':
                     showMessage('No active Spotify device found. Start playing music on any device.');
                    // Slower polling when no device
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

    // Debounced refresh to feel more responsive after an action
    function immediateRefresh() {
        if(refreshDebounceTimeout) clearTimeout(refreshDebounceTimeout);
        refreshDebounceTimeout = setTimeout(() => {
            fetchNowPlaying();
        }, 300); // 300ms delay
    }

    // --- Event Listeners ---
    connectBtn.addEventListener('click', () => {
        window.player.authorize().catch(err => console.error('authorize error:', err));
    });

    logoutBtn.addEventListener('click', async () => {
        if (pollTimeoutId) clearTimeout(pollTimeoutId);
        await window.player.logout();
        showView('auth');
    });

    playPauseBtn.addEventListener('click', async () => {
        const result = await window.player.playPause();
        if (result?.error) {
            showMessage(result.error);
        } else {
            immediateRefresh();
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
        const result = await window.player.next();
        if (result?.error) {
            showMessage(result.error);
        } else {
            immediateRefresh();
        }
    });

    prevBtn.addEventListener('click', async () => {
        const result = await window.player.prev();
        if (result?.error) {
            showMessage(result.error);
        } else {
            immediateRefresh();
        }
    });

    // Listen for events from the main process
    window.player.onAuthSuccess(() => {
        fetchNowPlaying();
        // refresh like state when auth succeeds
        refreshLikeState();
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

    // --- Initial Load ---
    fetchNowPlaying();
    // and initial like state
    refreshLikeState();

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

    // --- Drag-to-dock/snapping ---
    let dragging = false;
    let dragStart = null;
    const container = document.getElementById('widget-container');
    container.style.cursor = 'grab';
    container.addEventListener('mousedown', (ev) => {
        dragging = true; dragStart = { x: ev.clientX, y: ev.clientY };
        container.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (ev) => {
        if (!dragging) return;
        // Could add visual feedback here
    });
    window.addEventListener('mouseup', async (ev) => {
        if (!dragging) return;
        dragging = false; container.style.cursor = 'grab';
        // Compute screen coords
        const screenX = window.screenX + ev.clientX;
        const screenY = window.screenY + ev.clientY;
        try {
            const res = await window.player.requestDockAt({ x: screenX, y: screenY });
            if (res?.docked !== undefined) applyDockState(!!res.docked);
        } catch (err) {
            console.warn('requestDockAt failed', err);
        }
    });

    // --- Cleanup on window close ---
    window.addEventListener('beforeunload', () => {
        if (pollTimeoutId) clearTimeout(pollTimeoutId);
        window.player.cleanupListeners();
    });
});