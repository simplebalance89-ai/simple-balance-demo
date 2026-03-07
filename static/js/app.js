/* ===== CORE STATE ===== */
let selectedMode = null;
let apiStatus = { azure_openai: false, audd: false, replicate: false, spotify: false, tidal: false };
let userProfile = null;
let spotifyTracks = [];
let spotifyPlaylistNames = [];
let mixUploadedTracks = [];
let currentTab = 'home';

const MODE_NAMES = {
    jaw: 'J.A.W.',
    discovery: 'Discover',
    mastering: 'Mastering',
    stems: 'Stems',
    generation: 'Generate',
    events: 'Events',
    setbuilder: 'Set Builder',
    archive: 'Archive',
    digestor: 'Digestor',
    shazam: 'Live ID',
    tools: 'Tools',
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

/* Tool tab config — icon, label, mode */
var TOOL_TABS = [
    { mode: 'jaw',       icon: '🎙️', label: 'J.A.W.' },
    { mode: 'mastering', icon: '🎚️', label: 'Master' },
    { mode: 'digestor',  icon: '🔬', label: 'Digest' },
    { mode: 'shazam',    icon: '🎧', label: 'Live ID' },
    { mode: 'discovery', icon: '🧭', label: 'Discover' },
    { mode: 'generation',icon: '🎹', label: 'Generate' },
    { mode: 'stems',     icon: '🔀', label: 'Stems' },
    { mode: 'events',    icon: '📍', label: 'Events' },
    { mode: 'setbuilder',icon: '📋', label: 'Sets' },
    { mode: 'tools',     icon: '🛠️', label: 'Tools' }
];

/* ===== API STATUS CHECK ===== */
(function fetchApiStatus() {
    fetch('/api/status')
        .then(r => r.json())
        .then(data => { apiStatus = data; renderToolTabs(); })
        .catch(() => {});
})();

/* ===== ERROR LOG ===== */
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

/* ===== RENDER TOOL TABS ===== */
function renderToolTabs() {
    var container = document.getElementById('toolTabs');
    if (!container) return;

    var html = '';
    TOOL_TABS.forEach(function(t) {
        var active = selectedMode === t.mode ? ' active' : '';
        html += '<div class="tool-tab' + active + '" onclick="selectTool(\'' + t.mode + '\')">' +
                '<span class="tool-tab-icon">' + t.icon + '</span>' +
                '<span class="tool-tab-label">' + t.label + '</span>' +
                '</div>';
    });
    container.innerHTML = html;
}

/* ===== SELECT TOOL ===== */
function selectTool(mode) {
    if (selectedMode === mode) {
        // Toggle off — go back to home
        selectedMode = null;
        renderToolTabs();
        renderHomeContent();
        return;
    }
    selectedMode = mode;
    renderToolTabs();

    var area = document.getElementById('contentArea');
    if (!area) return;
    buildExperienceInto(area);
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ===== LAUNCH MODE (backwards compat) ===== */
function launchMode(mode) {
    selectTool(mode);
}

/* ===== NAV TAB (backwards compat — now just selects tools) ===== */
function navigateTab(tabName) {
    if (tabName === 'home') {
        selectedMode = null;
        renderToolTabs();
        renderHomeContent();
    } else if (tabName === 'discover') {
        selectTool('jaw');
    } else if (tabName === 'studio') {
        selectTool('mastering');
    } else if (tabName === 'library') {
        // Show archive
        selectedMode = null;
        renderToolTabs();
        renderHomeContent();
    }
}

/* ===== BUILD EXPERIENCE ===== */
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

/* ===== HOME CONTENT (when no tool selected) ===== */
function renderHomeContent() {
    var area = document.getElementById('contentArea');
    if (!area) return;

    area.innerHTML = `
        <!-- Connect Services -->
        <div class="home-section">
            <div class="connect-row">
                <div id="spotifyCard" class="connect-chip connect-spotify" onclick="connectSpotify()">
                    <span class="connect-chip-dot" style="background:#1DB954;"></span>
                    <span class="connect-chip-name">Spotify</span>
                    <span class="cc-status connect-chip-status">Connect</span>
                </div>
                <div id="tidalCard" class="connect-chip connect-tidal" onclick="connectTidal()">
                    <span class="connect-chip-dot" style="background:#00BFFF;"></span>
                    <span class="connect-chip-name">Tidal</span>
                    <span class="cc-status connect-chip-status">Connect</span>
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
                        <option value="">All</option>
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
                        <option value="">All</option>
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
        </div>

        <!-- Music Profile (auto-built, shown if exists) -->
        <div id="buildProfileResults"></div>
        <div id="profileTrackBadge" style="display:none;margin-top:8px;font-size:0.7rem;color:#D4A017;text-align:center;"></div>

        <!-- Error Log (admin only) -->
        <div class="home-section" id="errorLogSection" style="display:none;">
            <div class="error-log-header">
                <div class="home-section-title" style="color:var(--sbm-danger);margin-bottom:0;">Error Log</div>
                <button class="btn-error-refresh" onclick="loadErrorLog()">Refresh</button>
            </div>
            <div id="errorLogEntries" class="error-log-entries"></div>
        </div>`;

    // Re-apply Spotify/Tidal connected state
    if (typeof spotifyConnected !== 'undefined' && spotifyConnected) updateSpotifyCardUI(true, spotifyUserInfo);
    if (typeof tidalConnected !== 'undefined' && tidalConnected) {
        var card = document.getElementById('tidalCard');
        if (card) {
            card.classList.add('connected');
            var status = card.querySelector('.cc-status');
            if (status) { status.textContent = 'Connected'; status.style.color = '#00FFFF'; }
            var lib = document.getElementById('tidalLibrary');
            if (lib) lib.style.display = 'block';
        }
    }

    // Show saved profile
    if (typeof loadUserProfile === 'function') {
        var saved = loadUserProfile();
        if (saved && typeof renderSavedProfile === 'function') {
            renderSavedProfile();
        }
    }

    // Show error log for admins
    var crew = JSON.parse(localStorage.getItem('sbm_crew') || '{}');
    if (crew.is_admin) {
        var errSec = document.getElementById('errorLogSection');
        if (errSec) errSec.style.display = 'block';
        loadErrorLog();
    }
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', function() {
    renderToolTabs();
    renderHomeContent();
});
