/* ===== SPOTIFY — Connect, Search, Playlists ===== */

let spotifyConnected = false;
let spotifySession = localStorage.getItem('spotify_session') || '';
let spotifyUserInfo = null;
let _spotifyValidating = false;

// On load — check for OAuth callback or saved session
(function checkSpotifySession() {
    const params = new URLSearchParams(window.location.search);
    const sessionFromUrl = params.get('spotify_session');
    if (sessionFromUrl) {
        spotifySession = sessionFromUrl;
        localStorage.setItem('spotify_session', sessionFromUrl);
        window.history.replaceState({}, '', window.location.pathname);
    }
    if (spotifySession) {
        loadSpotifyUser(spotifySession);
    }

    // No popup listener needed — using full-page redirect flow
})();

async function loadSpotifyUser(session) {
    _spotifyValidating = true;
    try {
        const res = await fetch(`/api/spotify/me?session=${session}`);
        if (!res.ok) throw new Error('Session expired');
        const data = await res.json();
        spotifyUserInfo = data.user;
        spotifyConnected = true;
        updateSpotifyCardUI(true, data.user);
        loadUserPlaylists(session);
    } catch (e) {
        localStorage.removeItem('spotify_session');
        spotifySession = '';
        spotifyConnected = false;
        spotifyUserInfo = null;
        updateSpotifyCardUI(false);
        setTimeout(() => { if (!spotifyConnected) connectSpotifyClientCreds(); }, 5000);
    } finally {
        _spotifyValidating = false;
    }
}

function updateSpotifyCardUI(connected, user) {
    const card = document.getElementById('spotifyCard');
    if (!card) return;
    if (connected && user) {
        card.classList.add('connected');
        card.style.opacity = '1';
        card.onclick = null;
        const avatar = user.image ? `<img src="${user.image}" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;margin-right:4px;">` : '';
        card.querySelector('.cc-status').innerHTML = `${avatar}<span style="color:#1DB954;">${user.name}</span>`;
        const lib = document.getElementById('spotifyLibrary');
        if (lib) { lib.style.display = 'block'; }
        const label = document.getElementById('spotifyUserLabel');
        if (label) label.textContent = user.name;
    } else {
        card.classList.remove('connected');
        card.style.opacity = '1';
        card.onclick = function(){ connectSpotify(); };
        card.querySelector('.cc-status').innerHTML = '<span style="color:#D4A017;">Session expired — click to reconnect</span>';
        const lib = document.getElementById('spotifyLibrary');
        if (lib) lib.style.display = 'none';
    }
}

async function loadUserPlaylists(session) {
    try {
        const res = await fetch(`/api/spotify/user/playlists?session=${session}`);
        if (!res.ok) return;
        const data = await res.json();
        const container = document.getElementById('spotifyPlaylists');
        if (!container || !data.playlists || !data.playlists.length) return;
        container.innerHTML = '';
        const section = document.createElement('div');
        section.innerHTML = '<div style="font-size:0.7rem;color:#1DB954;margin:8px 0 4px;text-transform:uppercase;letter-spacing:1px;">Your Playlists</div>';
        data.playlists.slice(0, 8).forEach(p => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background 0.2s;';
            row.onmouseenter = () => row.style.background = 'rgba(29,185,84,0.15)';
            row.onmouseleave = () => row.style.background = 'transparent';
            row.onclick = () => loadPlaylistTracks(p.id, p.name);
            const img = p.image ? `<img src="${p.image}" style="width:32px;height:32px;border-radius:4px;">` : '<div style="width:32px;height:32px;border-radius:4px;background:#333;display:flex;align-items:center;justify-content:center;font-size:0.7rem;">🎵</div>';
            row.innerHTML = `${img}<div style="flex:1;min-width:0;"><div style="font-size:0.8rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div><div style="font-size:0.65rem;color:#666;">${p.tracks || 0} tracks · ${p.owner}</div></div>`;
            section.appendChild(row);
        });
        container.appendChild(section);
    } catch (e) { /* silent */ }
}

async function connectSpotify() {
    const card = document.getElementById('spotifyCard');
    if (!card) return;
    if (_spotifyValidating) {
        card.querySelector('.cc-status').innerHTML = '<span style="color:#D4A017;">Checking session...</span>';
        return;
    }
    if (spotifySession) {
        _spotifyValidating = true;
        card.querySelector('.cc-status').innerHTML = '<span style="color:#D4A017;">Validating session...</span>';
        try {
            const res = await fetch(`/api/spotify/me?session=${spotifySession}`);
            if (res.ok) {
                await loadSpotifyUser(spotifySession);
                return;
            }
            localStorage.removeItem('spotify_session');
            spotifySession = '';
            spotifyConnected = false;
            spotifyUserInfo = null;
        } catch (e) {
            localStorage.removeItem('spotify_session');
            spotifySession = '';
        } finally {
            _spotifyValidating = false;
        }
    }
    // Full-page redirect (works on mobile + desktop, no popup)
    card.style.opacity = '0.6';
    card.querySelector('.cc-status').textContent = 'Redirecting to Spotify...';
    card.querySelector('.cc-status').style.color = '#D4A017';
    window.location.href = '/api/spotify/login?redirect_to=' + encodeURIComponent(window.location.href);
}

async function connectSpotifyClientCreds() {
    const card = document.getElementById('spotifyCard');
    if (!card) return;
    card.style.opacity = '0.6';
    try {
        const res = await fetch('/api/spotify/search?q=test&limit=1');
        if (!res.ok) throw new Error('Spotify not configured');
        const data = await res.json();
        if (!data.tracks || !data.tracks.length) throw new Error('Spotify search failed');
        spotifyConnected = true;
        card.classList.add('connected');
        card.style.opacity = '1';
        card.querySelector('.cc-status').textContent = 'Connected (search only)';
        card.querySelector('.cc-status').style.color = '#1DB954';
        const lib = document.getElementById('spotifyLibrary');
        if (lib) lib.style.display = 'block';
        const label = document.getElementById('spotifyUserLabel');
        if (label) label.textContent = 'Search Spotify catalog';
    } catch (e) {
        card.style.opacity = '1';
        card.onclick = function(){ connectSpotify(); };
        card.querySelector('.cc-status').textContent = 'Connection failed — retry';
        card.querySelector('.cc-status').style.color = '#C41E3A';
        setTimeout(() => {
            card.querySelector('.cc-status').textContent = 'Ready to connect';
            card.querySelector('.cc-status').style.color = '#22c55e';
        }, 3000);
    }
}

async function loadPlaylistTracks(playlistId, playlistName) {
    const results = document.getElementById('spotifyResults');
    if (!results) return;
    results.innerHTML = '<div style="text-align:center;padding:12px;color:#888;font-size:0.8rem;">Loading tracks...</div>';
    try {
        const sessionParam = spotifySession ? `?session=${spotifySession}` : '';
        const res = await fetch(`/api/spotify/playlist/${playlistId}/tracks${sessionParam}`);
        const data = await res.json();
        const tracks = data.tracks || [];
        results.innerHTML = `<div style="font-size:0.7rem;color:#1DB954;margin:4px 0 8px;text-transform:uppercase;letter-spacing:1px;">${playlistName} (${tracks.length} tracks)</div>`;
        tracks.slice(0, 20).forEach(t => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;font-size:0.78rem;';
            const bpm = t.audio_features?.bpm ? `${Math.round(t.audio_features.bpm)} BPM` : '';
            const key = t.audio_features?.key || '';
            const meta = [bpm, key].filter(Boolean).join(' · ');
            const preview = t.preview_url ? `<button onclick="event.stopPropagation();new Audio('${t.preview_url}').play()" style="background:none;border:none;cursor:pointer;font-size:0.7rem;color:#1DB954;">▶</button>` : '';
            row.innerHTML = `<div style="flex:1;min-width:0;"><div style="color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.name}</div><div style="font-size:0.65rem;color:#666;">${t.artist}${meta ? ' · ' + meta : ''}</div></div>${preview}`;
            results.appendChild(row);
        });
    } catch (e) {
        results.innerHTML = '<div style="text-align:center;padding:12px;color:#C41E3A;font-size:0.8rem;">Failed to load tracks</div>';
    }
}

async function spotifySearch() {
    const rawQuery = document.getElementById('spotifySearchInput').value.trim();
    const genreEl = document.getElementById('spotifyGenreFilter');
    const genre = genreEl ? genreEl.value : '';
    if (!rawQuery && !genre) return;
    let query = rawQuery;
    if (genre) {
        query = query ? `genre:"${genre}" ${query}` : `genre:"${genre}"`;
    }
    const results = document.getElementById('spotifyResults');
    if (!results) return;
    results.innerHTML = '<div style="text-align:center;padding:12px;color:#888;font-size:0.8rem;">Searching...</div>';
    try {
        const sessionParam = spotifySession ? `&session=${spotifySession}` : '';
        const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}&type=track&limit=10${sessionParam}`);
        const data = await res.json();
        const tracks = data.tracks || [];
        results.innerHTML = `<div style="font-size:0.7rem;color:#1DB954;margin:4px 0 8px;text-transform:uppercase;letter-spacing:1px;">Results for "${query}"</div>`;
        if (!tracks.length) { results.innerHTML += '<div style="color:#666;font-size:0.8rem;padding:8px;">No results found</div>'; return; }
        tracks.forEach(t => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;font-size:0.78rem;';
            const img = t.album_image ? `<img src="${t.album_image}" style="width:28px;height:28px;border-radius:3px;">` : '';
            const preview = t.preview_url ? `<button onclick="event.stopPropagation();new Audio('${t.preview_url}').play()" style="background:none;border:none;cursor:pointer;font-size:0.7rem;color:#1DB954;">▶</button>` : '';
            const trackName = (t.name || '').replace(/'/g, "\\'");
            const trackArtist = (t.artist || '').replace(/'/g, "\\'");
            const addBtn = `<button onclick="event.stopPropagation();addTrackToProfile('${trackName}','${trackArtist}','spotify');this.textContent='Added';this.disabled=true;this.style.color='#4CAF50';" style="background:none;border:1px solid rgba(29,185,84,0.3);border-radius:4px;cursor:pointer;font-size:0.6rem;color:#1DB954;padding:2px 6px;white-space:nowrap;">+ Add</button>`;
            row.innerHTML = `${img}<div style="flex:1;min-width:0;"><div style="color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.name}</div><div style="font-size:0.65rem;color:#666;">${t.artist} · ${t.album || ''}</div></div>${addBtn}${preview}`;
            results.appendChild(row);
        });
    } catch (e) {
        results.innerHTML = '<div style="text-align:center;padding:12px;color:#C41E3A;font-size:0.8rem;">Search failed</div>';
    }
}
