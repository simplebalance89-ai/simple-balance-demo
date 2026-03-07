/* ===== PROFILE & TASTE ANALYSIS ===== */
let profileFavorites = [];

/* --- Persistent Music Profile (per user, localStorage) --- */
function _profileKey() {
    var p = sbmProfile || {};
    return 'sbm_music_profile_' + (p.display_name || 'guest');
}
function _tracksKey() {
    var p = sbmProfile || {};
    return 'sbm_profile_tracks_' + (p.display_name || 'guest');
}

function saveUserProfile(profile) {
    try { localStorage.setItem(_profileKey(), JSON.stringify(profile)); } catch(e) {}
}

function loadUserProfile() {
    try {
        var raw = localStorage.getItem(_profileKey());
        if (raw) {
            userProfile = JSON.parse(raw);
            return userProfile;
        }
    } catch(e) {}
    return null;
}

function getSavedTracks() {
    try {
        var raw = localStorage.getItem(_tracksKey());
        return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
}

function addTracksToSaved(tracks) {
    var saved = getSavedTracks();
    var existing = {};
    saved.forEach(function(t) { existing[(t.name + '|' + t.artist).toLowerCase()] = true; });
    var added = 0;
    tracks.forEach(function(t) {
        var key = ((t.name || t.title || '') + '|' + (t.artist || '')).toLowerCase();
        if (!existing[key] && (t.name || t.title)) {
            saved.push({ name: t.name || t.title, artist: t.artist || 'Unknown', source: t.source || 'unknown', added: new Date().toISOString() });
            existing[key] = true;
            added++;
        }
    });
    if (added > 0) {
        // Keep last 100 tracks
        if (saved.length > 100) saved = saved.slice(-100);
        try { localStorage.setItem(_tracksKey(), JSON.stringify(saved)); } catch(e) {}
    }
    return added;
}

function autoRebuildProfile() {
    var saved = getSavedTracks();
    if (saved.length < 3) return;
    // Only rebuild if we have new tracks since last build
    var lastBuild = 0;
    try { lastBuild = parseInt(localStorage.getItem(_profileKey() + '_ts') || '0'); } catch(e) {}
    var newestTrack = 0;
    saved.forEach(function(t) { if (t.added) { var d = new Date(t.added).getTime(); if (d > newestTrack) newestTrack = d; } });
    if (newestTrack <= lastBuild && userProfile) return; // No new tracks

    var favorites = saved.slice(-20).map(function(t) { return t.name + ' by ' + t.artist; });
    var headers = { 'Content-Type': 'application/json' };
    if (sbmToken) headers['X-Crew-Token'] = sbmToken;

    fetch('/api/profile/build', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ favorites: favorites })
    }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.profile) {
            userProfile = data.profile;
            userProfile._recommendations = data.recommendations || [];
            saveUserProfile(userProfile);
            try { localStorage.setItem(_profileKey() + '_ts', String(Date.now())); } catch(e) {}
            renderSavedProfile();
        }
    }).catch(function() {});
}

function renderSavedProfile() {
    var container = document.getElementById('buildProfileResults');
    if (!container || !userProfile) return;

    var profile = userProfile;
    var genres = (profile.genres || []).map(function(g) { return '<span class="profile-genre-tag">' + g + '</span>'; }).join('');
    var keys = (profile.key_clusters || []).join(', ');
    var bpmMin = profile.bpm_range ? profile.bpm_range.min : '?';
    var bpmMax = profile.bpm_range ? profile.bpm_range.max : '?';
    var savedTracks = getSavedTracks();

    var recsHtml = '';
    var recs = profile._recommendations || [];
    if (recs.length) {
        recsHtml = '<div style="font-family:Playfair Display,serif;font-size:0.9rem;color:#FFE082;margin:16px 0 10px;">Recommended For You</div>';
        recs.forEach(function(r) {
            var art = (r.spotify && r.spotify.album_art) ? '<img src="' + r.spotify.album_art + '" style="width:36px;height:36px;border-radius:4px;">' : '<div style="width:36px;height:36px;border-radius:4px;background:#222;display:flex;align-items:center;justify-content:center;">🎵</div>';
            recsHtml += '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">' + art + '<div style="flex:1;min-width:0;"><div style="font-size:0.82rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (r.title || '') + '</div><div style="font-size:0.65rem;color:#8A7A5A;">' + (r.artist || '') + '</div></div></div>';
        });
    }

    container.style.display = 'block';
    container.innerHTML =
        '<div class="profile-card">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                '<h3>Your Music Profile</h3>' +
                '<span style="font-size:0.6rem;color:#8A7A5A;">' + savedTracks.length + ' tracks analyzed</span>' +
            '</div>' +
            '<div class="profile-genres">' + genres + '</div>' +
            '<div class="profile-stat"><span class="ps-label">Energy Level</span><span class="ps-value">' + (profile.energy_level || '—') + '</span></div>' +
            '<div class="profile-stat"><span class="ps-label">BPM Range</span><span class="ps-value">' + bpmMin + ' – ' + bpmMax + '</span></div>' +
            '<div class="profile-stat"><span class="ps-label">Key Clusters</span><span class="ps-value">' + (keys || '—') + '</span></div>' +
            '<div class="profile-stat"><span class="ps-label">Mood</span><span class="ps-value">' + (profile.mood || '—') + '</span></div>' +
            '<div class="profile-stat"><span class="ps-label">DJ Style</span><span class="ps-value">' + (profile.dj_style || '—') + '</span></div>' +
        '</div>' + recsHtml;

    // Hide the build card if profile exists
    var buildCard = document.getElementById('buildProfileCard');
    if (buildCard) buildCard.style.display = 'none';
}

/* --- Build Profile (manual input from Home tab) --- */
function showBuildProfile() {
    const panel = document.getElementById('buildProfilePanel');
    const card = document.getElementById('buildProfileCard');
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        card.classList.add('connected');
        const inputs = document.getElementById('favoritesInputs');
        inputs.innerHTML = '';
        profileFavorites = [];
        for (let i = 0; i < 3; i++) addFavoriteInput();
    } else {
        panel.style.display = 'none';
        card.classList.remove('connected');
    }
}

function addFavoriteInput() {
    const container = document.getElementById('favoritesInputs');
    const count = container.children.length;
    if (count >= 10) return;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;';
    row.innerHTML = `
        <input type="text" placeholder="Song or artist name" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #333;background:#1a1a2e;color:#fff;font-family:'Nunito',sans-serif;font-size:0.8rem;" oninput="updateFavCount()">
        <button onclick="this.parentElement.remove();updateFavCount()" style="padding:4px 10px;border-radius:8px;border:1px solid #333;background:transparent;color:#666;cursor:pointer;font-size:0.8rem;">&times;</button>`;
    container.appendChild(row);
    updateFavCount();
}

function updateFavCount() {
    const inputs = document.querySelectorAll('#favoritesInputs input');
    const filled = Array.from(inputs).filter(i => i.value.trim()).length;
    const countEl = document.getElementById('favCount');
    if (countEl) countEl.textContent = `${filled} / 10`;
    const btn = document.getElementById('buildProfileBtn');
    if (btn) btn.disabled = filled < 3;
}

async function buildProfile() {
    const inputs = document.querySelectorAll('#favoritesInputs input');
    const favorites = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
    if (favorites.length < 3) return;

    const btn = document.getElementById('buildProfileBtn');
    const status = document.getElementById('buildProfileStatus');
    const results = document.getElementById('buildProfileResults');
    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    status.style.display = 'block';
    status.innerHTML = '<div style="font-size:0.85rem;color:#D4A017;">Building your taste profile...</div><div style="width:100%;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:8px;overflow:hidden;"><div id="buildBar" style="width:20%;height:100%;background:linear-gradient(90deg,#D4A017,#FFE082);border-radius:2px;transition:width 0.5s ease;"></div></div>';

    setTimeout(() => { const b = document.getElementById('buildBar'); if(b) b.style.width = '50%'; }, 1500);
    setTimeout(() => { const b = document.getElementById('buildBar'); if(b) b.style.width = '75%'; }, 4000);

    try {
        const authHdrs = typeof getAuthHeaders === 'function' ? getAuthHeaders() : {};
        const res = await fetch('/api/profile/build', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', ...authHdrs},
            body: JSON.stringify({ favorites: favorites })
        });
        const data = await res.json();
        const b = document.getElementById('buildBar');
        if(b) b.style.width = '100%';

        if (data.error) {
            status.innerHTML = `<div style="color:#C41E3A;font-size:0.85rem;">${data.error}</div>`;
            btn.disabled = false; btn.textContent = 'Build Profile'; return;
        }

        const profile = data.profile || {};
        profile._recommendations = data.recommendations || [];
        userProfile = profile;
        saveUserProfile(profile);
        // Save the favorites as tracked songs
        addTracksToSaved(favorites.map(function(f) { return { name: f, artist: '', source: 'manual' }; }));
        try { localStorage.setItem(_profileKey() + '_ts', String(Date.now())); } catch(e) {}
        status.style.display = 'none';
        results.style.display = 'block';

        const genres = (profile.genres || []).map(g => `<span class="profile-genre-tag">${g}</span>`).join('');
        const bpmMin = profile.bpm_range ? profile.bpm_range.min : '?';
        const bpmMax = profile.bpm_range ? profile.bpm_range.max : '?';
        const keys = (profile.key_clusters || []).join(', ');

        let recsHtml = '';
        const recs = data.recommendations || [];
        if (recs.length) {
            recsHtml = '<div style="font-family:Playfair Display,serif;font-size:0.9rem;color:#FFE082;margin:16px 0 10px;">Recommended For You</div>';
            recs.forEach(r => {
                const platforms = [];
                if (r.spotify && r.spotify.url) platforms.push(`<a href="${r.spotify.url}" target="_blank" style="color:#1DB954;font-size:0.65rem;text-decoration:none;">Spotify</a>`);
                if (r.tidal && r.tidal.url) platforms.push(`<a href="${r.tidal.url}" target="_blank" style="color:#00BFFF;font-size:0.65rem;text-decoration:none;">Tidal</a>`);
                const art = (r.spotify && r.spotify.album_art) ? `<img src="${r.spotify.album_art}" style="width:36px;height:36px;border-radius:4px;">` : '<div style="width:36px;height:36px;border-radius:4px;background:#222;display:flex;align-items:center;justify-content:center;">🎵</div>';
                recsHtml += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                    ${art}
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:0.82rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.title}</div>
                        <div style="font-size:0.65rem;color:#8A7A5A;">${r.artist}${r.bpm ? ' · ' + r.bpm + ' BPM' : ''}${r.key ? ' · ' + r.key : ''}</div>
                        ${r.reason ? `<div style="font-size:0.6rem;color:#6A6A7A;font-style:italic;">${r.reason}</div>` : ''}
                    </div>
                    <div style="display:flex;gap:6px;">${platforms.join('')}</div>
                </div>`;
            });
        }

        results.innerHTML = `
            <div class="profile-card">
                <h3>Your Music Profile</h3>
                <div class="profile-genres">${genres}</div>
                <div class="profile-stat"><span class="ps-label">Energy Level</span><span class="ps-value">${profile.energy_level || '—'}</span></div>
                <div class="profile-stat"><span class="ps-label">BPM Range</span><span class="ps-value">${bpmMin} – ${bpmMax}</span></div>
                <div class="profile-stat"><span class="ps-label">Key Clusters</span><span class="ps-value">${keys || '—'}</span></div>
                <div class="profile-stat"><span class="ps-label">Mood</span><span class="ps-value">${profile.mood || '—'}</span></div>
                <div class="profile-stat"><span class="ps-label">DJ Style</span><span class="ps-value">${profile.dj_style || '—'}</span></div>
            </div>
            ${recsHtml}`;
    } catch (e) {
        status.innerHTML = '<div style="color:#C41E3A;font-size:0.85rem;">Profile build failed. Try again.</div>';
        btn.disabled = false; btn.textContent = 'Build Profile';
    }
}

/* --- Add Track to Profile (from search results) --- */
function addTrackToProfile(name, artist, source) {
    const entry = { name: name, artist: artist, source: source };
    if (spotifyTracks.some(t => t.name === name && t.artist === artist)) return;
    spotifyTracks.push(entry);
    addTracksToSaved([entry]);
    updateProfileTrackCount();
}

function updateProfileTrackCount() {
    const badge = document.getElementById('profileTrackBadge');
    if (badge) {
        badge.style.display = spotifyTracks.length > 0 ? 'block' : 'none';
        badge.textContent = spotifyTracks.length + ' track' + (spotifyTracks.length !== 1 ? 's' : '') + ' added to profile';
    }
}

/* --- Analyze My Music (full profile builder with Spotify/Tidal tracks + manual input) --- */
function addStep2FavInput() {
    const container = document.getElementById('step2FavInputs');
    if (!container) return;
    const count = container.children.length;
    if (count >= 10) return;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;';
    row.innerHTML = `<input type="text" placeholder="Song or artist name" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #333;background:#1a1a2e;color:#fff;font-family:'Nunito',sans-serif;font-size:0.8rem;">
        <button onclick="this.parentElement.remove()" style="padding:4px 10px;border-radius:8px;border:1px solid #333;background:transparent;color:#666;cursor:pointer;font-size:0.8rem;">&times;</button>`;
    container.appendChild(row);
}

function initStep2() {
    var summary = document.getElementById('step2TrackSummary');
    var countEl = document.getElementById('step2TrackCount');
    if (summary && countEl && spotifyTracks.length > 0) {
        summary.style.display = 'block';
        countEl.textContent = spotifyTracks.length + ' track' + (spotifyTracks.length !== 1 ? 's' : '') + ' added from search';
    }
    var container = document.getElementById('step2FavInputs');
    if (container && container.children.length === 0) {
        for (var i = 0; i < 3; i++) addStep2FavInput();
    }
}

async function analyzeMyMusic() {
    var btn = document.getElementById('analyzeBtn');
    var status = document.getElementById('analyzeStatus');
    var msg = document.getElementById('analyzeMsg');
    var bar = document.getElementById('analyzeBar');
    var card = document.getElementById('profileCard');
    if (!btn) return;

    var manualInputs = document.querySelectorAll('#step2FavInputs input');
    var manualFavs = Array.from(manualInputs).map(function(i){ return i.value.trim(); }).filter(Boolean);

    var favorites = [];
    spotifyTracks.forEach(function(t){ favorites.push(t.name + ' by ' + t.artist); });
    mixUploadedTracks.forEach(function(t){ favorites.push((t.name || t.title) + ' by ' + (t.artist || 'Unknown')); });
    manualFavs.forEach(function(f){ favorites.push(f); });

    if (favorites.length < 3) {
        msg.style.color = '#C41E3A';
        status.style.display = 'block';
        msg.textContent = 'Add at least 3 songs — search on Spotify/Tidal and click "+ Add", or type them below.';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    status.style.display = 'block';
    msg.style.color = '#D4A017';
    msg.textContent = 'Gathering your music data...';
    bar.style.width = '20%';

    setTimeout(function(){ msg.textContent = 'Analyzing your taste with AI...'; bar.style.width = '50%'; }, 1500);
    setTimeout(function(){ msg.textContent = 'Finding tracks on Spotify + Tidal...'; bar.style.width = '75%'; }, 4000);

    try {
        var authHdrs = typeof getAuthHeaders === 'function' ? getAuthHeaders() : {};
        var res = await fetch('/api/profile/build', {
            method: 'POST',
            headers: Object.assign({'Content-Type': 'application/json'}, authHdrs),
            body: JSON.stringify({ favorites: favorites.slice(0, 20) })
        });
        var data = await res.json();
        bar.style.width = '100%';

        if (data.error) {
            msg.textContent = 'Error: ' + data.error;
            msg.style.color = '#C41E3A';
            btn.disabled = false;
            btn.textContent = 'Build My Profile';
            return;
        }

        var profile = data.profile || data;
        profile._recommendations = data.recommendations || [];
        userProfile = profile;
        saveUserProfile(profile);
        addTracksToSaved(favorites.map(function(f) { return { name: f, artist: '', source: 'analyze' }; }));
        try { localStorage.setItem(_profileKey() + '_ts', String(Date.now())); } catch(e) {}
        status.style.display = 'none';
        btn.style.display = 'none';
        var manualSection = document.getElementById('step2ManualSection');
        if (manualSection) manualSection.style.display = 'none';
        var trackSummary = document.getElementById('step2TrackSummary');
        if (trackSummary) trackSummary.style.display = 'none';

        var genres = (profile.genres || []).map(function(g){ return '<span class="profile-genre-tag">' + g + '</span>'; }).join('');
        var keys = (profile.key_clusters || []).join(', ');
        var bpmMin = profile.bpm_range ? profile.bpm_range.min : '?';
        var bpmMax = profile.bpm_range ? profile.bpm_range.max : '?';

        var recsHtml = '';
        var recs = data.recommendations || [];
        if (recs.length) {
            recsHtml = '<div style="font-family:Playfair Display,serif;font-size:0.9rem;color:#FFE082;margin:16px 0 10px;">Recommended For You</div>';
            recs.forEach(function(r) {
                var platforms = [];
                if (r.spotify && r.spotify.url) platforms.push('<a href="' + r.spotify.url + '" target="_blank" style="color:#1DB954;font-size:0.6rem;text-decoration:none;background:rgba(29,185,84,0.15);padding:2px 6px;border-radius:4px;">Spotify</a>');
                if (r.tidal && r.tidal.url) platforms.push('<a href="' + r.tidal.url + '" target="_blank" style="color:#00BFFF;font-size:0.6rem;text-decoration:none;background:rgba(0,191,255,0.1);padding:2px 6px;border-radius:4px;">Tidal</a>');
                var art = (r.spotify && r.spotify.album_art) ? '<img src="' + r.spotify.album_art + '" style="width:36px;height:36px;border-radius:4px;">' : '<div style="width:36px;height:36px;border-radius:4px;background:#222;display:flex;align-items:center;justify-content:center;">🎵</div>';
                recsHtml += '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">' + art + '<div style="flex:1;min-width:0;"><div style="font-size:0.82rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + r.title + '</div><div style="font-size:0.65rem;color:#8A7A5A;">' + r.artist + (r.bpm ? ' · ' + r.bpm + ' BPM' : '') + (r.key ? ' · ' + r.key : '') + '</div>' + (r.reason ? '<div style="font-size:0.6rem;color:#6A6A7A;font-style:italic;">' + r.reason + '</div>' : '') + '</div><div style="display:flex;gap:6px;">' + platforms.join('') + '</div></div>';
            });
        }

        card.style.display = 'block';
        card.innerHTML =
            '<div class="profile-card">' +
                '<h3>Your Music Profile</h3>' +
                '<div class="profile-genres">' + genres + '</div>' +
                '<div class="profile-stat"><span class="ps-label">Energy Level</span><span class="ps-value">' + (profile.energy_level || '—') + '</span></div>' +
                '<div class="profile-stat"><span class="ps-label">BPM Range</span><span class="ps-value">' + bpmMin + ' – ' + bpmMax + '</span></div>' +
                '<div class="profile-stat"><span class="ps-label">Key Clusters</span><span class="ps-value">' + (keys || '—') + '</span></div>' +
                '<div class="profile-stat"><span class="ps-label">Mood</span><span class="ps-value">' + (profile.mood || '—') + '</span></div>' +
                '<div class="profile-stat"><span class="ps-label">DJ Style</span><span class="ps-value">' + (profile.dj_style || '—') + '</span></div>' +
            '</div>' + recsHtml;
    } catch (e) {
        bar.style.width = '100%';
        msg.textContent = 'Analysis failed. Try again.';
        msg.style.color = '#C41E3A';
        btn.disabled = false;
        btn.textContent = 'Build My Profile';
    }
}
