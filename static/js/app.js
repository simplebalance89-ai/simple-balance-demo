/* ===== CORE STATE ===== */
let selectedMode = null;
let apiStatus = { azure_openai: false, audd: false, replicate: false, spotify: false, tidal: false };
let userProfile = null;
let spotifyTracks = [];
let spotifyPlaylistNames = [];
let mixUploadedTracks = [];
let currentTab = 'home';

const MODE_NAMES = {
    jaw: 'J.A.W. DJ Command',
    discovery: 'Music Discovery',
    mastering: 'AI Mastering',
    stems: 'Stem Separation',
    generation: 'AI Generation',
    events: 'Events Radar',
    setbuilder: 'Set Builder',
    archive: 'Mix Archive',
    digestor: 'Mix Digestor',
    shazam: 'Track ID',
    tools: 'Producer Tools',
    dashboard: 'Dashboard'
};

const API_REQUIREMENTS = {
    jaw: 'azure_openai',
    mastering: 'azure_openai',
    discovery: 'azure_openai',
    generation: 'azure_openai',
    events: 'azure_openai',
    setbuilder: 'azure_openai',
    tools: 'azure_openai',
    stems: 'replicate',
    digestor: 'audd',
    shazam: 'azure_openai'
};

/* ===== API STATUS CHECK ===== */
(function fetchApiStatus() {
    fetch('/api/status')
        .then(r => r.json())
        .then(data => { apiStatus = data; })
        .catch(() => {});
})();

/* ===== TAB NAVIGATION ===== */
function navigateTab(tabName) {
    currentTab = tabName;
    const app = document.getElementById('app');

    // Update bottom nav active state
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
    if (activeTab) activeTab.classList.add('active');

    // Clear any active mode
    selectedMode = null;

    // Render tab content
    switch (tabName) {
        case 'home': renderHomeTab(app); break;
        case 'discover': renderDiscoverTab(app); break;
        case 'studio': renderStudioTab(app); break;
        case 'library': renderLibraryTab(app); break;
        default: renderHomeTab(app);
    }

    window.scrollTo(0, 0);
}

/* ===== LAUNCH MODE (tool within a tab) ===== */
function launchMode(mode) {
    selectedMode = mode;
    const area = document.getElementById('experienceArea');
    if (!area) return;
    buildExperienceInto(area);
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildExperienceInto(area) {
    const name = 'Producer';
    const modeName = MODE_NAMES[selectedMode] || 'Mode';

    if (selectedMode === 'jaw') area.innerHTML = buildJAWExperience(name, modeName);
    else if (selectedMode === 'mastering') area.innerHTML = buildMasteringExperience(name, modeName);
    else if (selectedMode === 'discovery') area.innerHTML = buildDiscoveryExperience(name, modeName);
    else if (selectedMode === 'generation') area.innerHTML = buildGenerationExperience(name, modeName);
    else if (selectedMode === 'digestor') area.innerHTML = buildDigestorExperience(name, modeName);
    else if (selectedMode === 'shazam') area.innerHTML = buildShazamExperience(name, modeName);
    else if (selectedMode === 'stems') area.innerHTML = buildStemsExperience(name, modeName);
    else if (selectedMode === 'events') area.innerHTML = buildEventsExperience(name, modeName);
    else if (selectedMode === 'setbuilder') area.innerHTML = buildSetBuilderExperience(name, modeName);
    else if (selectedMode === 'archive') { area.innerHTML = buildArchiveExperience(name, modeName); loadArchiveList(); }
    else if (selectedMode === 'tools') area.innerHTML = buildToolsExperience(name, modeName);
    else if (selectedMode === 'dashboard') { area.innerHTML = buildDashboardExperience(name, modeName); loadDashboardStats(); }
    else area.innerHTML = buildDefaultExperience(name, modeName);
}

/* ===== FEATURE CARD BUILDER ===== */
var TESTING_MODES = ['mastering']; // Real backend TBD — show amber
function featureCard(mode, icon, title, desc) {
    const req = API_REQUIREMENTS[mode];
    const available = !req || apiStatus[req];
    var badge;
    if (TESTING_MODES.indexOf(mode) !== -1) {
        badge = '<span style="font-size:0.55rem;background:rgba(245,158,11,0.15);color:#F59E0B;padding:2px 6px;border-radius:4px;">TESTING</span>';
    } else if (available) {
        badge = '<span style="font-size:0.55rem;background:rgba(76,175,80,0.15);color:#4CAF50;padding:2px 6px;border-radius:4px;">READY</span>';
    } else {
        badge = '<span style="font-size:0.55rem;background:rgba(255,255,255,0.06);color:#666;padding:2px 6px;border-radius:4px;">NEEDS KEY</span>';
    }
    return `
        <div class="feature-card" onclick="launchMode('${mode}')">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <span style="font-size:1.3rem;">${icon}</span>
                ${badge}
            </div>
            <div style="font-family:'Playfair Display',serif;font-size:0.95rem;color:#FFE082;margin-bottom:4px;">${title}</div>
            <div style="font-size:0.7rem;color:#8A7A5A;">${desc}</div>
        </div>`;
}

/* ===== HOME TAB ===== */
function renderHomeTab(app) {
    app.innerHTML = `
        <div class="tab-header">
            <h1>Simple Balance Music</h1>
            <p>Your AI-powered music production suite</p>
        </div>

        <!-- Quick Actions -->
        <div class="home-section">
            <div style="font-family:'Playfair Display',serif;font-size:1rem;color:#FFE082;margin-bottom:12px;">Quick Actions</div>
            <div class="quick-action-grid">
                <button class="btn-secondary" onclick="navigateTab('discover');setTimeout(()=>launchMode('jaw'),100)">Chat with J.A.W.</button>
                <button class="btn-secondary" onclick="navigateTab('studio');setTimeout(()=>launchMode('mastering'),100)">Analyze a Track</button>
                <button class="btn-secondary" onclick="navigateTab('studio');setTimeout(()=>launchMode('digestor'),100)">Digest a Mix</button>
                <button class="btn-secondary" onclick="navigateTab('discover');setTimeout(()=>launchMode('discovery'),100)">Discover Music</button>
            </div>
        </div>

        <!-- Connect Services -->
        <div class="home-section">
            <div style="font-family:'Playfair Display',serif;font-size:1rem;color:#FFE082;margin-bottom:4px;">Connect Services</div>
            <div style="font-size:0.7rem;color:#8A7A5A;margin-bottom:12px;">Optional — enhances search and recommendations</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div id="spotifyCard" class="connect-card" onclick="connectSpotify()" style="background:rgba(29,185,84,0.06);border:1px solid rgba(29,185,84,0.2);border-radius:12px;padding:14px;cursor:pointer;transition:all 0.3s;">
                    <div style="font-size:1.2rem;margin-bottom:4px;">🟢</div>
                    <div style="font-size:0.85rem;font-weight:700;color:#1DB954;">Spotify</div>
                    <div class="cc-status" style="font-size:0.65rem;color:#22c55e;margin-top:4px;">Ready to connect</div>
                </div>
                <div id="tidalCard" class="connect-card" onclick="connectTidal()" style="background:rgba(0,191,255,0.06);border:1px solid rgba(0,191,255,0.2);border-radius:12px;padding:14px;cursor:pointer;transition:all 0.3s;">
                    <div style="font-size:1.2rem;margin-bottom:4px;">🌊</div>
                    <div style="font-size:0.85rem;font-weight:700;color:#00BFFF;">Tidal</div>
                    <div class="cc-status" style="font-size:0.65rem;color:#22c55e;margin-top:4px;">Ready to connect</div>
                </div>
            </div>

            <!-- Spotify Library (hidden until connected) -->
            <div id="spotifyLibrary" style="display:none;margin-top:12px;background:rgba(29,185,84,0.04);border:1px solid rgba(29,185,84,0.15);border-radius:12px;padding:14px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <span style="color:#1DB954;font-size:0.8rem;font-weight:700;" id="spotifyUserLabel">Spotify</span>
                </div>
                <div style="display:flex;gap:8px;margin-bottom:10px;">
                    <input type="text" id="spotifySearchInput" placeholder="Search Spotify..." style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid rgba(29,185,84,0.3);background:#1a1a2e;color:#fff;font-family:'Nunito',sans-serif;font-size:0.8rem;" onkeydown="if(event.key==='Enter')spotifySearch()">
                    <select id="spotifyGenreFilter" style="padding:6px;border-radius:8px;border:1px solid #333;background:#1a1a2e;color:#888;font-size:0.7rem;">
                        <option value="">All Genres</option>
                        <option value="house">House</option>
                        <option value="techno">Techno</option>
                        <option value="trance">Trance</option>
                        <option value="deep house">Deep House</option>
                        <option value="progressive house">Progressive</option>
                        <option value="drum and bass">DnB</option>
                        <option value="ambient">Ambient</option>
                    </select>
                    <button onclick="spotifySearch()" style="padding:8px 14px;border-radius:8px;border:none;background:#1DB954;color:#000;font-weight:700;cursor:pointer;font-size:0.75rem;">Go</button>
                </div>
                <div id="spotifyPlaylists"></div>
                <div id="spotifyResults" style="max-height:300px;overflow-y:auto;"></div>
            </div>

            <!-- Tidal Library (hidden until connected) -->
            <div id="tidalLibrary" style="display:none;margin-top:12px;background:rgba(0,191,255,0.04);border:1px solid rgba(0,191,255,0.15);border-radius:12px;padding:14px;">
                <div style="display:flex;gap:8px;margin-bottom:10px;">
                    <input type="text" id="tidalSearchInput" placeholder="Search Tidal..." style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid rgba(0,191,255,0.3);background:#1a1a2e;color:#fff;font-family:'Nunito',sans-serif;font-size:0.8rem;" onkeydown="if(event.key==='Enter')tidalSearch()">
                    <select id="tidalGenreFilter" style="padding:6px;border-radius:8px;border:1px solid #333;background:#1a1a2e;color:#888;font-size:0.7rem;">
                        <option value="">All Genres</option>
                        <option value="house">House</option>
                        <option value="techno">Techno</option>
                        <option value="trance">Trance</option>
                        <option value="deep house">Deep House</option>
                        <option value="ambient">Ambient</option>
                    </select>
                    <button onclick="tidalSearch()" style="padding:8px 14px;border-radius:8px;border:none;background:#00BFFF;color:#000;font-weight:700;cursor:pointer;font-size:0.75rem;">Go</button>
                </div>
                <div id="tidalResults" style="max-height:300px;overflow-y:auto;"></div>
            </div>

            <div id="profileTrackBadge" style="display:none;margin-top:8px;font-size:0.7rem;color:#D4A017;text-align:center;"></div>
        </div>

        <!-- Build Profile -->
        <div class="home-section">
            <div id="buildProfileCard" style="background:rgba(212,160,23,0.06);border:1px solid rgba(212,160,23,0.2);border-radius:12px;padding:14px;cursor:pointer;" onclick="showBuildProfile()">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:1.3rem;">🎵</span>
                    <div>
                        <div style="font-size:0.85rem;font-weight:700;color:#FFE082;">Build Your Music Profile</div>
                        <div style="font-size:0.65rem;color:#8A7A5A;">Add favorites to get personalized recommendations</div>
                    </div>
                </div>
            </div>
            <div id="buildProfilePanel" style="display:none;margin-top:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <span style="font-size:0.75rem;color:#8A7A5A;">Your favorite songs or artists</span>
                    <span id="favCount" style="font-size:0.65rem;color:#D4A017;">0 / 10</span>
                </div>
                <div id="favoritesInputs"></div>
                <div style="display:flex;gap:8px;margin-top:8px;">
                    <button onclick="addFavoriteInput()" style="flex:1;padding:8px;border-radius:8px;border:1px dashed rgba(212,160,23,0.3);background:transparent;color:#D4A017;cursor:pointer;font-size:0.75rem;">+ Add More</button>
                    <button id="buildProfileBtn" onclick="buildProfile()" disabled class="btn-primary" style="flex:1;padding:8px;font-size:0.8rem;">Build Profile</button>
                </div>
                <div id="buildProfileStatus" style="display:none;margin-top:12px;"></div>
            </div>
            <div id="buildProfileResults" style="display:none;margin-top:12px;"></div>
        </div>

        <!-- Dashboard Stats -->
        <div class="home-section">
            <div style="font-family:'Playfair Display',serif;font-size:1rem;color:#FFE082;margin-bottom:12px;">Your Stats</div>
            <div id="homeStatsGrid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
                <div class="analysis-card">
                    <div class="ac-label">Tracks Mastered</div>
                    <div class="ac-value" id="home-val-mastered">--</div>
                </div>
                <div class="analysis-card">
                    <div class="ac-label">Mixes Archived</div>
                    <div class="ac-value" id="home-val-archive">--</div>
                </div>
            </div>
        </div>`;

    // Load dashboard stats for home
    const dashHdrs = typeof getAuthHeaders === 'function' ? getAuthHeaders() : {};
    fetch('/api/dashboard', { headers: dashHdrs })
    .then(r => r.json())
    .then(data => {
        const el1 = document.getElementById('home-val-mastered');
        const el2 = document.getElementById('home-val-archive');
        if (el1) el1.textContent = data.tracks_mastered || 0;
        if (el2) el2.textContent = data.mixes_archived || 0;
    })
    .catch(() => {});

    // Re-apply Spotify/Tidal connected state
    if (spotifyConnected) updateSpotifyCardUI(true, spotifyUserInfo);
    if (tidalConnected) {
        var card = document.getElementById('tidalCard');
        if (card) {
            card.classList.add('connected');
            card.querySelector('.cc-status').textContent = 'Connected';
            card.querySelector('.cc-status').style.color = '#00FFFF';
            var lib = document.getElementById('tidalLibrary');
            if (lib) lib.style.display = 'block';
        }
    }
}

/* ===== DISCOVER TAB ===== */
function renderDiscoverTab(app) {
    app.innerHTML = `
        <div class="tab-header">
            <h1>Discover</h1>
            <p>Find new music, build sets, explore events</p>
        </div>
        <div class="feature-grid">
            ${featureCard('jaw', '🎙️', 'J.A.W. DJ Command', 'AI DJ advisor for mixing, sets, keys')}
            ${featureCard('discovery', '🧭', 'Music Discovery', 'Mood-based AI recommendations')}
            ${featureCard('setbuilder', '📋', 'Set Builder', 'Build complete DJ sets with AI')}
            ${featureCard('events', '📍', 'Events Radar', 'Find electronic music events near you')}
        </div>
        <div id="experienceArea" class="experience-area"></div>`;
}

/* ===== STUDIO TAB ===== */
function renderStudioTab(app) {
    app.innerHTML = `
        <div class="tab-header">
            <h1>Studio</h1>
            <p>Production tools powered by AI</p>
        </div>
        <div class="feature-grid">
            ${featureCard('mastering', '🎚️', 'AI Mastering', 'Upload and analyze your tracks')}
            ${featureCard('stems', '🔀', 'Stem Separation', 'Split tracks into vocals, drums, bass')}
            ${featureCard('digestor', '🔬', 'Mix Digestor', 'Extract tracklists from DJ mixes')}
            ${featureCard('shazam', '🎵', 'Track ID', 'Identify any song with AI')}
            ${featureCard('generation', '🎹', 'AI Generation', 'Generate beats and patterns')}
            ${featureCard('tools', '🛠️', 'Producer Tools', 'Music theory and production Q&A')}
        </div>
        <div id="experienceArea" class="experience-area"></div>`;
}

/* ===== LIBRARY TAB ===== */
function renderLibraryTab(app) {
    app.innerHTML = `
        <div class="tab-header">
            <h1>Library</h1>
            <p>Your mixes, archives, and history</p>
        </div>

        <!-- Mix Archive -->
        <div class="home-section">
            <div style="font-family:'Playfair Display',serif;font-size:1rem;color:#FFE082;margin-bottom:12px;">Mix Archive</div>
            <div style="background:rgba(255,255,255,0.03);border:2px dashed rgba(212,160,23,0.3);border-radius:12px;padding:20px;text-align:center;margin-bottom:12px;cursor:pointer;" onclick="document.getElementById('archiveFileLib').click()">
                <div style="font-size:1.5rem;margin-bottom:4px;">💾</div>
                <div style="font-size:0.8rem;color:#FFE082;">Upload a mix to archive</div>
                <div style="font-size:0.65rem;color:#8A7A5A;">MP3, WAV, M4A, FLAC</div>
                <input type="file" id="archiveFileLib" accept="audio/*" style="display:none" onchange="uploadArchiveLibrary(this)">
            </div>
            <div id="archiveStatusLib" style="display:none;text-align:center;padding:8px;font-size:0.8rem;color:#D4A017;"></div>
            <div id="archiveListLib" style="font-size:0.8rem;color:#8A7A5A;">Loading...</div>
        </div>

        <!-- Digest a Mix -->
        <div class="home-section">
            <div style="font-family:'Playfair Display',serif;font-size:1rem;color:#FFE082;margin-bottom:12px;">Identify Tracks</div>
            <div style="background:rgba(255,255,255,0.03);border:2px dashed rgba(212,160,23,0.3);border-radius:12px;padding:20px;text-align:center;margin-bottom:12px;cursor:pointer;" onclick="document.getElementById('mixFileLib').click()">
                <div style="font-size:1.5rem;margin-bottom:4px;">🔬</div>
                <div style="font-size:0.8rem;color:#FFE082;">Upload a mix to identify tracks</div>
                <div style="font-size:0.65rem;color:#8A7A5A;">Powered by AudD fingerprinting</div>
                <input type="file" id="mixFileLib" accept="audio/*" style="display:none" onchange="uploadMixLibrary(this)">
            </div>
            <div id="libraryMixStatus" style="display:none;"></div>
            <div id="libraryMixResults" style="display:none;"></div>
        </div>

        <!-- Dashboard -->
        <div class="home-section">
            <div style="font-family:'Playfair Display',serif;font-size:1rem;color:#FFE082;margin-bottom:12px;">Stats</div>
            <div id="libStatsGrid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
                <div class="analysis-card">
                    <div class="ac-label">Tracks Mastered</div>
                    <div class="ac-value" id="lib-val-mastered">--</div>
                </div>
                <div class="analysis-card">
                    <div class="ac-label">Sets Built</div>
                    <div class="ac-value" id="lib-val-sets">--</div>
                </div>
                <div class="analysis-card">
                    <div class="ac-label">Stems Separated</div>
                    <div class="ac-value" id="lib-val-stems">--</div>
                </div>
                <div class="analysis-card">
                    <div class="ac-label">Mixes Archived</div>
                    <div class="ac-value" id="lib-val-archive">--</div>
                </div>
            </div>
        </div>`;

    // Load archive list
    loadArchiveListLibrary();

    // Load stats
    var libDashHdrs = typeof getAuthHeaders === 'function' ? getAuthHeaders() : {};
    fetch('/api/dashboard', { headers: libDashHdrs })
    .then(r => r.json())
    .then(data => {
        var ids = { 'lib-val-mastered': data.tracks_mastered, 'lib-val-sets': data.sets_built, 'lib-val-stems': data.stems_separated, 'lib-val-archive': data.mixes_archived };
        Object.keys(ids).forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.textContent = ids[id] || 0;
        });
    })
    .catch(() => {});
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', function() {
    navigateTab('home');
});
