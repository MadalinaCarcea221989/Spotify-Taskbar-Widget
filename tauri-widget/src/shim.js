const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// --- Token cache: avoid hitting Rust on every call ---
let _cachedToken = null;
let _tokenCachedAt = 0;
const TOKEN_CACHE_MS = 50_000;

async function getCachedToken() {
    const now = Date.now();
    if (_cachedToken && (now - _tokenCachedAt) < TOKEN_CACHE_MS) return _cachedToken;
    _cachedToken = await invoke('get_access_token');
    _tokenCachedAt = Date.now();
    return _cachedToken;
}

// --- Native Rust fetch: fastest possible Spotify API calls ---
// Uses reqwest persistent connection pool, no WebView overhead.
async function nativeFetch(endpoint, method = 'GET', body = null) {
    try {
        const res = await invoke('spotify_fetch', {
            endpoint,
            method,
            body: body ? JSON.stringify(body) : null
        });
        
        if (res.status === 401) return { error: { status: 401, message: 'Not authorized' } };
        if (res.status === 429) return { error: { status: 429, message: 'Too many requests. Please wait a moment.' } };
        if (res.status === 204) return { status: 204 };
        
        let data = null;
        const trimmedBody = res.body ? res.body.trim() : null;
        
        if (trimmedBody) {
            if (trimmedBody.startsWith('<')) {
                console.error('Spotify API returned HTML:', res.body);
                return { error: { status: res.status, message: `Spotify Error ${res.status}. Please check your connection.` } };
            }
            try {
                data = JSON.parse(trimmedBody);
            } catch (e) {
                console.error('Non-JSON response:', trimmedBody);
                if (res.status >= 400) {
                    return { error: { status: res.status, message: trimmedBody.substring(0, 50) || `Error ${res.status}` } };
                }
                return { status: res.status, data: null };
            }
        }
        
        if (res.status >= 400) {
            const errorMsg = data?.error?.message || `Error ${res.status}`;
            return { error: { status: res.status, message: errorMsg }, data };
        }
        return { status: res.status, data };
    } catch (e) {
        console.error('Fetch error:', e);
        return { error: { status: 0, message: 'Connection failed' } };
    }
}

window.player = {
    getAccessToken: getCachedToken,
    authorize: () => invoke('authorize'),
    onAuthSuccess: (cb) => listen('auth-success', () => cb()),
    onAuthRequired: (cb) => listen('auth-required', () => cb()),
    onMediaKey: (cb) => listen('media-key', (e) => cb(e.payload)),
    getDockState: async () => false,
    requestDockAt: async () => ({ ok: true, docked: false }),
    onDockChanged: () => {},
    cleanupListeners: () => {},
    logout: () => invoke('logout'),

    getNowPlaying: async () => {
        const res = await nativeFetch('/me/player');
        if (res.error) return { status: res.error.status === 401 ? 'unauthorized' : 'error', message: res.error.message };
        if (res.status === 204 || !res.data?.item) {
            return { status: res.data ? 'idle' : 'no-device' };
        }
        const item = res.data.item;
        return {
            status: 'playing',
            isPlaying: res.data.is_playing,
            shuffleState: res.data.shuffle_state,
            repeatState: res.data.repeat_state,
            activeDeviceId: res.data.device?.id,
            track: { id: item.id, title: item.name, artists: item.artists.map(a => a.name).join(', '), albumArtUrl: item.album.images[0]?.url }
        };
    },

    isLiked: async () => {
        const np = await window.player.getNowPlaying();
        if (np.status !== 'playing' && np.status !== 'idle') return { error: 'No track' };
        const id = np.track?.id;
        if (!id) return { error: 'No track' };
        const res = await nativeFetch(`/me/tracks/contains?ids=${id}`);
        return { liked: res.data?.[0] };
    },

    toggleLike: async () => {
        const np = await window.player.getNowPlaying();
        const id = np.track?.id;
        if (!id) return { error: 'No track' };
        const contains = await nativeFetch(`/me/tracks/contains?ids=${id}`);
        const isLiked = contains.data?.[0];
        const res = await nativeFetch(`/me/tracks?ids=${id}`, isLiked ? 'DELETE' : 'PUT');
        if (res.error) return { error: res.error.message };
        return { liked: !isLiked };
    },

    // Single native call, no double-fetch
    playPause: async (isCurrentlyPlaying) => {
        return nativeFetch(`/me/player/${isCurrentlyPlaying ? 'pause' : 'play'}`, 'PUT');
    },

    next: async (deviceId) => nativeFetch(`/me/player/next${deviceId ? `?device_id=${deviceId}` : ''}`, 'POST'),
    prev: async (deviceId) => nativeFetch(`/me/player/previous${deviceId ? `?device_id=${deviceId}` : ''}`, 'POST'),
    seek: async (positionMs, deviceId) => nativeFetch(`/me/player/seek?position_ms=${Math.round(positionMs)}${deviceId ? `&device_id=${deviceId}` : ''}`, 'PUT'),
    shuffle: async (state, deviceId) => nativeFetch(`/me/player/shuffle?state=${state}${deviceId ? `&device_id=${deviceId}` : ''}`, 'PUT'),
    repeat: async (state, deviceId) => nativeFetch(`/me/player/repeat?state=${state}${deviceId ? `&device_id=${deviceId}` : ''}`, 'PUT'),
    transferPlayback: async (deviceId, play) => nativeFetch('/me/player', 'PUT', { device_ids: [deviceId], play }),
    getDevices: async () => nativeFetch('/me/player/devices'),

    getPlaylists: async () => nativeFetch('/me/playlists?limit=50'),
    getPlaylistTracks: async (playlistId) =>
        nativeFetch(`/playlists/${encodeURIComponent(playlistId)}/tracks?limit=50&fields=items(track(id,uri,name,artists(name),album(images)))`),
    playContext: async (contextUri, deviceId, offsetUri) => {
        const body = { context_uri: contextUri };
        if (offsetUri) body.offset = { uri: offsetUri };
        return nativeFetch(`/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`, 'PUT', body);
    },
    playUris: async (uris, deviceId, offsetPosition) => {
        const body = { uris };
        if (typeof offsetPosition === 'number') body.offset = { position: offsetPosition };
        return nativeFetch(`/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`, 'PUT', body);
    },
    getLikedSongs: async () => nativeFetch('/me/tracks?limit=50'),
    searchTracks: async (query) => nativeFetch(`/search?q=${encodeURIComponent(query)}&type=track&limit=20`),
    getMe: async () => nativeFetch('/me'),
    getArtistTopTracks: async (artistId, market) =>
        nativeFetch(`/artists/${encodeURIComponent(artistId)}/top-tracks?market=${encodeURIComponent(market)}`),
    queueTrack: async (uri, deviceId) =>
        nativeFetch(`/me/player/queue?uri=${encodeURIComponent(uri)}${deviceId ? `&device_id=${deviceId}` : ''}`, 'POST'),
};
