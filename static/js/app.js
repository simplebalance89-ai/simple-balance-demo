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
    shazam: 'Live ID',
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
function loadErrorLog() {
    fetch('/api/errors?limit=20')
    .then(function(r) { return r.json(); })
    .then(function(data) {
        var el = document.getElementById('errorLogEntries');
        if (!el) return;
        var errors = data.errors || [];
        if (!errors.length) { el.innerHTML = '<div style="color:#4a4a4a;padding:8px;">No errors logged</div>'; return; }
        el.innerHTML = errors.map(function(e) {
            var ts = e.ts ? e.ts.split('T')[1].split('.')[0] : '';
            return '<div style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.04);">' +
                '<span style="color:#666;">' + ts + '</span> ' +
                '<span style="color:#EF4444;font-weight:600;">[' + e.source + ']</span> ' +
                '<span style="color:#ccc;">' + e.message + '</span>' +
                (e.detail ? '<div style="color:#666;font-size:0.6rem;margin-top:2px;word-break:break-all;">' + e.detail.substring(0, 200) + '</div>' : '') +
            '</div>';
        }).join('');
    })
    .catch(function() {});
}

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
var TESTING_MODES = []; // All modes now have real backends
function featureCard(mode, icon, title, desc) {
    const req = API_REQUIREMENTS[mode];
    const available = !req || apiStatus[req];
    var badgeClass, badgeText;
    if (TESTING_MODES.indexOf(mode) !== -1) {
        badgeClass = 'fc-badge-testing';
        badgeText = 'TESTING';
    } else if (available) {
        badgeClass = 'fc-badge-ready';
        badgeText = 'READY';
    } else {
        badgeClass = 'fc-badge-needs';
        badgeText = 'NEEDS KEY';
    }
    return `
        <div class="feature-card${!available ? ' disabled' : ''}" onclick="launchMode('${mode}')">
            <div class="fc-icon">${icon}</div>
            <div class="fc-name">${title}</div>
            <div class="fc-desc">${desc}</div>
            <div class="fc-badge-label ${badgeClass}">${badgeText}</div>
        </div>`;
}

/* ===== HOME TAB ===== */
function renderHomeTab(app) {
    app.innerHTML = `
        <div class="tab-header">
            <h1>simple / balance</h1>
            <p>Your AI-powered music production suite</p>
        </div>

        <!-- Quick Actions -->
        <div class="home-section">
            <div class="home-section-title">Quick Actions</div>
            <div class="quick-action-grid">
                <button class="btn-secondary" onclick="navigateTab('discover');setTimeout(()=>launchMode('jaw'),100)">Chat with J.A.W.</button>
                <button class="btn-secondary" onclick="navigateTab('studio');setTimeout(()=>launchMode('mastering'),100)">Analyze a Track</button>
                <button class="btn-secondary" onclick="navigateTab('studio');setTimeout(()=>launchMode('digestor'),100)">Digest a Mix</button>
                <button class="btn-secondary" onclick="navigateTab('discover');setTimeout(()=>launchMode('discovery'),100)">Discover Music</button>
            </div>
        </div>

        <!-- Connect Services -->
        <div class="home-section">
            <div class="home-section-title">Connect Services</div>
            <div class="home-section-subtitle">Optional — enhances search and recommendations</div>
            <div class="connect-grid">
                <div id="spotifyCard" class="connect-card connect-spotify" onclick="connectSpotify()">
                    <div class="cc-icon">🟢</div>
                    <div class="cc-name" style="color:#1DB954;">Spotify</div>
                    <div class="cc-status">Ready to connect</div>
                </div>
                <div id="tidalCard" class="connect-card connect-tidal" onclick="connectTidal()">
                    <div class="cc-icon">🌊</div>
                    <div class="cc-name" style="color:#00BFFF;">Tidal</div>
                    <div class="cc-status">Ready to connect</div>
                </div>
            </div>

            <!-- Spotify Library (hidden until connected) -->
            <div id="spotifyLibrary" class="service-library service-library-spotify" style="display:none;">
                <div class="service-library-header">
                    <span class="service-library-label" id="spotifyUserLabel" style="color:#1DB954;">Spotify</span>
                </div>
                <div class="service-search-row">
                    <input type="text" id="spotifySearchInput" class="service-search-input" placeholder="Search Spotify..." style="border-color:rgba(29,185,84,0.3);" onkeydown="if(event.key==='Enter')spotifySearch()">
                    <select id="spotifyGenreFilter" class="service-genre-filter">
                        <option value="">All Genres</option>
                        <option value="house">House</option>
                        <option value="techno">Techno</option>
                        <option value="trance">Trance</option>
                        <option value="deep house">Deep House</option>
                        <option value="progressive house">Progressive</option>
                        <option value="drum and bass">DnB</option>
                        <option value="ambient">Ambient</option>
                    </select>
                    <button class="service-search-btn" style="background:#1DB954;" onclick="spotifySearch()">Go</button>
                </div>
                <div id="spotifyPlaylists"></div>
                <div id="spotifyResults" class="service-results"></div>
            </div>

            <!-- Tidal Library (hidden until connected) -->
            <div id="tidalLibrary" class="service-library service-library-tidal" style="display:none;">
                <div class="service-search-row">
                    <input type="text" id="tidalSearchInput" class="service-search-input" placeholder="Search Tidal..." style="border-color:rgba(0,191,255,0.3);" onkeydown="if(event.key==='Enter')tidalSearch()">
                    <select id="tidalGenreFilter" class="service-genre-filter">
                        <option value="">All Genres</option>
                        <option value="house">House</option>
                        <option value="techno">Techno</option>
                        <option value="trance">Trance</option>
                        <option value="deep house">Deep House</option>
                        <option value="ambient">Ambient</option>
                    </select>
                    <button class="service-search-btn" style="background:#00BFFF;" onclick="tidalSearch()">Go</button>
                </div>
                <div id="tidalResults" class="service-results"></div>
            </div>

            <div id="profileTrackBadge" style="display:none;margin-top:8px;font-size:0.7rem;color:#D4A017;text-align:center;"></div>
        </div>

        <!-- Build Profile -->
        <div class="home-section">
            <div id="buildProfileCard" class="build-profile-cta" onclick="showBuildProfile()">
                <div class="build-profile-cta-inner">
                    <span class="build-profile-cta-icon">🎵</span>
                    <div>
                        <div class="build-profile-cta-title">Build Your Music Profile</div>
                        <div class="build-profile-cta-desc">Add favorites to get personalized recommendations</div>
                    </div>
                </div>
            </div>
            <div id="buildProfilePanel" class="build-profile-panel" style="display:none;">
                <div class="build-profile-panel-header">
                    <span class="build-profile-panel-label">Your favorite songs or artists</span>
                    <span id="favCount" class="build-profile-panel-count">0 / 10</span>
                </div>
                <div id="favoritesInputs"></div>
                <div class="build-profile-actions">
                    <button class="btn-add-more" onclick="addFavoriteInput()">+ Add More</button>
                    <button id="buildProfileBtn" onclick="buildProfile()" disabled class="btn-primary btn-compact">Build Profile</button>
                </div>
                <div id="buildProfileStatus" style="display:none;margin-top:12px;"></div>
            </div>
            <div id="buildProfileResults" style="display:none;margin-top:12px;"></div>
        </div>

        <!-- Dashboard Stats -->
        <div class="home-section">
            <div class="home-section-title">Your Stats</div>
            <div id="homeStatsGrid" class="analysis-grid">
                <div class="analysis-card">
                    <div class="ac-label">Tracks Mastered</div>
                    <div class="ac-value" id="home-val-mastered">--</div>
                </div>
                <div class="analysis-card">
                    <div class="ac-label">Mixes Archived</div>
                    <div class="ac-value" id="home-val-archive">--</div>
                </div>
            </div>
        </div>

        <!-- Error Log (admin only) -->
        <div class="home-section" id="errorLogSection" style="display:none;">
            <div class="error-log-header">
                <div class="home-section-title" style="color:var(--sbm-danger);margin-bottom:0;">Error Log</div>
                <button class="btn-error-refresh" onclick="loadErrorLog()">Refresh</button>
            </div>
            <div id="errorLogEntries" class="error-log-entries"></div>
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

    // Show error log for admins
    var crew = JSON.parse(localStorage.getItem('sbm_crew') || '{}');
    if (crew.is_admin) {
        var errSec = document.getElementById('errorLogSection');
        if (errSec) errSec.style.display = 'block';
        loadErrorLog();
    }

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
            ${featureCard('shazam', '🎧', 'Live ID', 'Hold up your phone — we\'ll name that track')}
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
            <div class="home-section-title">Mix Archive</div>
            <div class="upload-zone" onclick="document.getElementById('archiveFileLib').click()">
                <div class="upload-zone-icon">💾</div>
                <div class="upload-zone-title">Upload a mix to archive</div>
                <div class="upload-zone-desc">MP3, WAV, M4A, FLAC</div>
                <input type="file" id="archiveFileLib" accept="audio/*" style="display:none" onchange="uploadArchiveLibrary(this)">
            </div>
            <div id="archiveStatusLib" class="upload-status" style="display:none;"></div>
            <div id="archiveListLib" class="archive-list">Loading...</div>
        </div>

        <!-- Digest a Mix -->
        <div class="home-section">
            <div class="home-section-title">Identify Tracks</div>
            <div class="upload-zone" onclick="document.getElementById('mixFileLib').click()">
                <div class="upload-zone-icon">🔬</div>
                <div class="upload-zone-title">Upload a mix to identify tracks</div>
                <div class="upload-zone-desc">Powered by AudD fingerprinting</div>
                <input type="file" id="mixFileLib" accept="audio/*" style="display:none" onchange="uploadMixLibrary(this)">
            </div>
            <div id="libraryMixStatus" style="display:none;"></div>
            <div id="libraryMixResults" style="display:none;"></div>
        </div>

        <!-- Dashboard -->
        <div class="home-section">
            <div class="home-section-title">Stats</div>
            <div id="libStatsGrid" class="analysis-grid">
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
