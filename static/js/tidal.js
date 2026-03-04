/* ===== TIDAL — OAuth Connect & Search ===== */

let tidalConnected = false;
let tidalSession = localStorage.getItem('tidal_session') || '';

// On load — check for OAuth callback or saved session
(function checkTidalSession() {
    const params = new URLSearchParams(window.location.search);
    const sessionFromUrl = params.get('tidal_session');
    const tidalError = params.get('tidal_error');
    if (sessionFromUrl) {
        tidalSession = sessionFromUrl;
        localStorage.setItem('tidal_session', sessionFromUrl);
        // Clean URL params
        const url = new URL(window.location);
        url.searchParams.delete('tidal_session');
        window.history.replaceState({}, '', url.toString());
    }
    if (tidalError) {
        console.warn('[Tidal] OAuth error:', tidalError);
        const url = new URL(window.location);
        url.searchParams.delete('tidal_error');
        window.history.replaceState({}, '', url.toString());
    }
    if (tidalSession) {
        loadTidalUser(tidalSession);
    }
})();

async function loadTidalUser(session) {
    try {
        const res = await fetch(`/api/tidal/me?session=${session}`);
        if (!res.ok) throw new Error('Session expired');
        const data = await res.json();
        tidalConnected = true;
        updateTidalCardUI(true, data.user);
    } catch (e) {
        localStorage.removeItem('tidal_session');
        tidalSession = '';
        tidalConnected = false;
        updateTidalCardUI(false);
    }
}

function updateTidalCardUI(connected, user) {
    const card = document.getElementById('tidalCard');
    if (!card) return;
    if (connected && user) {
        card.classList.add('connected');
        card.style.opacity = '1';
        card.onclick = null;
        card.querySelector('.cc-status').innerHTML = `<span style="color:#00FFFF;">${user.name || 'Tidal User'}</span>`;
        const lib = document.getElementById('tidalLibrary');
        if (lib) lib.style.display = 'block';
    } else {
        card.classList.remove('connected');
        card.style.opacity = '1';
        card.onclick = function(){ connectTidal(); };
        card.querySelector('.cc-status').innerHTML = '<span style="color:#22c55e;">Ready to connect</span>';
    }
}

async function connectTidal() {
    const card = document.getElementById('tidalCard');
    if (!card) return;

    // If we have a session, validate it first
    if (tidalSession) {
        card.querySelector('.cc-status').innerHTML = '<span style="color:#D4A017;">Validating session...</span>';
        try {
            const res = await fetch(`/api/tidal/me?session=${tidalSession}`);
            if (res.ok) {
                await loadTidalUser(tidalSession);
                return;
            }
            localStorage.removeItem('tidal_session');
            tidalSession = '';
            tidalConnected = false;
        } catch (e) {
            localStorage.removeItem('tidal_session');
            tidalSession = '';
        }
    }

    // Full-page redirect to Tidal OAuth (PKCE, works on mobile + desktop)
    card.style.opacity = '0.6';
    card.querySelector('.cc-status').textContent = 'Redirecting to Tidal...';
    card.querySelector('.cc-status').style.color = '#D4A017';
    window.location.href = '/api/tidal/login?redirect_to=' + encodeURIComponent(window.location.href);
}

function tidalUserLogin() {
    window.location.href = '/api/tidal/login?redirect_to=' + encodeURIComponent(window.location.pathname);
}

async function tidalSearch() {
    const rawQuery = document.getElementById('tidalSearchInput').value.trim();
    const genreEl = document.getElementById('tidalGenreFilter');
    const genre = genreEl ? genreEl.value : '';
    if (!rawQuery && !genre) return;
    let query = rawQuery;
    if (genre) {
        query = query ? `${genre} ${query}` : genre;
    }
    const results = document.getElementById('tidalResults');
    if (!results) return;
    results.innerHTML = '<div style="text-align:center;padding:12px;color:#888;font-size:0.8rem;">Searching Tidal...</div>';
    try {
        const sessionParam = tidalSession ? `&session=${tidalSession}` : '';
        const res = await fetch(`/api/tidal/search?q=${encodeURIComponent(query)}&limit=10${sessionParam}`);
        const data = await res.json();

        // If server says we need to login
        if (data.needs_login) {
            results.innerHTML = '<div style="text-align:center;padding:16px;"><div style="color:#F59E0B;font-size:0.85rem;margin-bottom:8px;">Tidal login required for search</div><button onclick="connectTidal()" style="background:linear-gradient(135deg,#00FFFF,#00BFFF);color:#000;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">Connect Tidal Account</button></div>';
            return;
        }

        const tracks = data.tracks || [];
        results.innerHTML = `<div style="font-size:0.7rem;color:#00BFFF;margin:4px 0 8px;text-transform:uppercase;letter-spacing:1px;">Tidal results for "${query}"</div>`;
        if (!tracks.length) { results.innerHTML += '<div style="color:#666;font-size:0.8rem;padding:8px;">No results found</div>'; return; }
        tracks.forEach(t => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;font-size:0.78rem;';
            const art = t.album_art ? `<img src="${t.album_art}" style="width:28px;height:28px;border-radius:3px;">` : '<div style="width:28px;height:28px;border-radius:3px;background:#1a2a3a;display:flex;align-items:center;justify-content:center;font-size:0.7rem;">🌊</div>';
            const link = t.url ? `<a href="${t.url}" target="_blank" style="color:#00BFFF;font-size:0.65rem;text-decoration:none;">Open</a>` : '';
            const trackTitle = (t.title || '').replace(/'/g, "\\'");
            const trackArtist = (t.artist || '').replace(/'/g, "\\'");
            const addBtn = `<button onclick="event.stopPropagation();addTrackToProfile('${trackTitle}','${trackArtist}','tidal');this.textContent='Added';this.disabled=true;this.style.color='#4CAF50';" style="background:none;border:1px solid rgba(0,191,255,0.3);border-radius:4px;cursor:pointer;font-size:0.6rem;color:#00BFFF;padding:2px 6px;white-space:nowrap;">+ Add</button>`;
            row.innerHTML = `${art}<div style="flex:1;min-width:0;"><div style="color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.title}</div><div style="font-size:0.65rem;color:#666;">${t.artist}${t.album ? ' · ' + t.album : ''}</div></div>${addBtn}${link}`;
            results.appendChild(row);
        });
    } catch (e) {
        results.innerHTML = '<div style="text-align:center;padding:12px;color:#C41E3A;font-size:0.8rem;">Tidal search failed</div>';
    }
}
