/* ===== TIDAL — Connect & Search ===== */

let tidalConnected = false;

async function connectTidal() {
    const card = document.getElementById('tidalCard');
    if (!card) return;
    card.style.opacity = '0.6';
    card.onclick = null;
    try {
        const res = await fetch('/api/tidal/search?q=electronic&limit=1');
        if (res.ok) {
            tidalConnected = true;
            card.classList.add('connected');
            card.style.opacity = '1';
            card.querySelector('.cc-status').textContent = 'Connected';
            card.querySelector('.cc-status').style.color = '#00FFFF';
            const lib = document.getElementById('tidalLibrary');
            if (lib) lib.style.display = 'block';
            return;
        }
        // Check if credentials are set but auth is failing
        const errData = await res.json().catch(() => ({}));
        if (errData.configured) {
            card.style.opacity = '1';
            card.onclick = function(){ connectTidal(); };
            card.querySelector('.cc-status').textContent = 'Tidal API auth failing — credentials may be expired';
            card.querySelector('.cc-status').style.color = '#F59E0B';
            return;
        }
        const statusRes = await fetch('/api/status');
        const statusData = await statusRes.json();
        if (statusData.tidal) {
            tidalConnected = true;
            card.classList.add('connected');
            card.style.opacity = '1';
            card.querySelector('.cc-status').textContent = 'Connected (limited)';
            card.querySelector('.cc-status').style.color = '#00BFFF';
            const lib = document.getElementById('tidalLibrary');
            if (lib) lib.style.display = 'block';
            return;
        }
        throw new Error('Tidal not configured');
    } catch (e) {
        card.style.opacity = '1';
        card.onclick = function(){ connectTidal(); };
        card.querySelector('.cc-status').textContent = 'Connection failed — retry';
        card.querySelector('.cc-status').style.color = '#C41E3A';
        setTimeout(() => {
            card.querySelector('.cc-status').textContent = 'Ready to connect';
            card.querySelector('.cc-status').style.color = '#22c55e';
        }, 3000);
    }
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
        const res = await fetch(`/api/tidal/search?q=${encodeURIComponent(query)}&limit=10`);
        const data = await res.json();
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
            row.innerHTML = `${art}<div style="flex:1;min-width:0;"><div style="color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.title}</div><div style="font-size:0.65rem;color:#666;">${t.artist}</div></div>${addBtn}${link}`;
            results.appendChild(row);
        });
    } catch (e) {
        results.innerHTML = '<div style="text-align:center;padding:12px;color:#C41E3A;font-size:0.8rem;">Tidal search failed</div>';
    }
}
