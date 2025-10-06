document.addEventListener('DOMContentLoaded', () => {
    const POLLING_INTERVAL = 2000; // 2 seconds
    let pollTimeoutId = null;
    let refreshDebounceTimeout = null;

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
    const messageTextEl = document.getElementById('message-text');

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
        playPauseBtn.textContent = isPlaying ? '⏸' : '▶️';
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
                    break;
                case 'playing':
                    updatePlayerUI(result);
                    showView('player');
                    break;
                case 'idle':
                    showMessage('Playback is paused or stopped.');
                    break;
                case 'no-device':
                     showMessage('No active Spotify device found. Start playing music on any device.');
                    break;
                case 'error':
                    showMessage(result.message || 'An unknown error occurred.');
                    break;
                default:
                    showView('auth'); // Default to auth view on unknown status
            }
        } catch (error) {
            console.error('Error fetching now playing:', error);
            showMessage('Failed to fetch data.');
        } finally {
            // Schedule the next poll
            pollTimeoutId = setTimeout(fetchNowPlaying, POLLING_INTERVAL);
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
        window.player.authorize();
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
        console.log('Authentication successful, starting polling.');
        fetchNowPlaying();
    });

    window.player.onAuthRequired(() => {
        console.log('Authentication required by main process.');
        if (pollTimeoutId) clearTimeout(pollTimeoutId);
        showView('auth');
    });

    // --- Initial Load ---
    fetchNowPlaying();

    // --- Cleanup on window close ---
    window.addEventListener('beforeunload', () => {
        if (pollTimeoutId) clearTimeout(pollTimeoutId);
        window.player.cleanupListeners();
    });
});