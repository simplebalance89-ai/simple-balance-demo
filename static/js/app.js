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
    dashboard: 'Dashboard',
    presskit: 'Press Kit',
    samples: 'Samples',
    liveaudit: 'Live Audit'
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
    { mode: 'liveaudit', icon: '🔍', label: 'Audit' },
    { mode: 'presskit',  icon: '📋', label: 'EPK' },
    { mode: 'samples',   icon: '🎙️', label: 'Samples' },
    { mode: 'tools',     icon: '🛠️', label: 'Tools' }
];

/* ===== API STATUS CHECK ===== */
(function fetchApiStatus() {
    fetch('/api/status')
        .then(r => r.json())
        .then(data => { apiStatus = data; renderToolTabs(); })
        .catch(() => {});
})();

/* ===== BOTTOM NAV ===== */
function sbmNavTo(section) {
    document.querySelectorAll('.sbm-nav-btn').forEach(function(b) { b.classList.remove('active'); });
    var btn = document.getElementById('nav' + section.charAt(0).toUpperCase() + section.slice(1));
    if (btn) btn.classList.add('active');

    if (section === 'home') {
        selectedMode = null;
        renderToolTabs();
        renderHomeContent();
    } else if (section === 'studio') {
        selectTool('mastering');
    } else if (section === 'discover') {
        selectTool('discovery');
    } else if (section === 'library') {
        selectTool('archive');
    }
    window.scrollTo(0, 0);
}

/* ===== BEATPORT & TICKETMASTER — Placeholder Connects ===== */
function connectBeatport() {
    sbmToast('Beatport integration coming soon — DJ charts, top tracks, and purchase links.', 'info');
}
function connectTicketmaster() {
    sbmToast('Ticketmaster integration coming soon — live events, concerts, and ticket alerts.', 'info');
}

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
    else if (selectedMode === 'liveaudit') area.innerHTML = buildLiveAuditExperience(name, modeName);
    else if (selectedMode === 'presskit') area.innerHTML = buildPressKitExperience(name, modeName);
    else if (selectedMode === 'samples') { area.innerHTML = buildSampleSaverExperience(name, modeName); renderSampleList(); }
    else if (selectedMode === 'tools') area.innerHTML = buildToolsExperience(name, modeName);
    else if (selectedMode === 'dashboard') { area.innerHTML = buildDashboardExperience(name, modeName); loadDashboardStats(); }
    else area.innerHTML = buildDefaultExperience(name, modeName);
}

/* ===== HOME CONTENT (when no tool selected) ===== */
function renderHomeContent() {
    var area = document.getElementById('contentArea');
    if (!area) return;

    var displayName = (sbmProfile && sbmProfile.display_name) ? sbmProfile.display_name : 'Producer';
    var avatarColor = (sbmProfile && sbmProfile.color) ? sbmProfile.color : '#D4A017';
    var initial = displayName.charAt(0).toUpperCase();

    // Swim lane card builder — single column, horizontal cards
    function buildCards(list) {
        return list.map(function(f) {
            var statusBadge = f.status === 'live'
                ? '<span class="feature-badge feature-badge-live">Live</span>'
                : f.status === 'new'
                ? '<span class="feature-badge feature-badge-new">New</span>'
                : '<span class="feature-badge feature-badge-testing">Testing</span>';
            return '<div class="feature-card" onclick="selectTool(\'' + f.mode + '\')">' +
                '<span class="feature-card-icon">' + f.icon + '</span>' +
                '<div class="feature-card-body">' +
                    '<div class="feature-card-name">' + f.name + '</div>' +
                    '<div class="feature-card-desc">' + f.desc + '</div>' +
                '</div>' +
                '<div class="feature-card-badge">' + statusBadge + '</div>' +
            '</div>';
        }).join('');
    }

    // Profile lane — things that build your identity
    var profileTools = [
        { mode: 'discovery', icon: '🧭', name: 'Discover', desc: 'Mood-based AI track recommendations', status: 'live' },
        { mode: 'events', icon: '📍', name: 'Events', desc: 'Upcoming shows and festivals near you', status: 'testing' },
        { mode: 'presskit', icon: '📋', name: 'Press Kit', desc: 'Build your EPK for bookings and promos', status: 'new' },
        { mode: 'samples', icon: '🎙️', name: 'Samples', desc: 'Record, tag, and auto-ID audio samples', status: 'new' }
    ];

    // Studio lane — production & performance tools
    var studioTools = [
        { mode: 'jaw', icon: '🎙️', name: 'J.A.W.', desc: 'AI DJ advisor — mixing, sets, keys, energy flow', status: 'live' },
        { mode: 'mastering', icon: '🎚️', name: 'Master', desc: 'Upload a track for AI mastering analysis', status: 'live' },
        { mode: 'stems', icon: '🔀', name: 'Stems', desc: 'Separate vocals, drums, bass, melody', status: 'testing' },
        { mode: 'generation', icon: '🎹', name: 'Generate', desc: 'Create beats and loops with AI', status: 'live' },
        { mode: 'digestor', icon: '🔬', name: 'Digest', desc: 'Extract tracklists from DJ mixes', status: 'live' },
        { mode: 'shazam', icon: '🎧', name: 'Live ID', desc: 'Mic-based real-time track identification', status: 'live' },
        { mode: 'setbuilder', icon: '📋', name: 'Sets', desc: 'Build and plan DJ sets with AI', status: 'testing' },
        { mode: 'liveaudit', icon: '🔍', name: 'Live Audit', desc: 'Full set analysis — tracklist, BPM, transitions', status: 'new' },
        { mode: 'tools', icon: '🛠️', name: 'Tools', desc: 'BPM tap, key finder, utilities', status: 'testing' }
    ];

    area.innerHTML =
        // Welcome Header
        '<div class="home-welcome">' +
            '<div class="welcome-avatar" style="background:' + avatarColor + ';">' + initial + '</div>' +
            '<div class="welcome-text">' +
                '<div class="welcome-greeting">Welcome back, ' + escapeHTML(displayName) + '</div>' +
                '<div class="welcome-sub">Your AI production suite is ready.</div>' +
            '</div>' +
        '</div>' +

        // SWIM LANE: Your Profile
        '<div class="swim-lane">' +
            '<div class="swim-lane-header">' +
                '<div class="swim-lane-title">Your Profile</div>' +
                '<div class="swim-lane-sub">Connect services, build your taste, discover music</div>' +
            '</div>' +
            '<div class="connect-row">' +
                '<div id="spotifyCard" class="connect-chip connect-spotify" onclick="connectSpotify()">' +
                    '<span class="connect-chip-dot" style="background:#1DB954;"></span>' +
                    '<span class="connect-chip-name">Spotify</span>' +
                    '<span class="cc-status connect-chip-status">Connect</span>' +
                '</div>' +
                '<div id="tidalCard" class="connect-chip connect-tidal" onclick="connectTidal()">' +
                    '<span class="connect-chip-dot" style="background:#00BFFF;"></span>' +
                    '<span class="connect-chip-name">Tidal</span>' +
                    '<span class="cc-status connect-chip-status">Connect</span>' +
                '</div>' +
                '<div id="beatportCard" class="connect-chip" onclick="connectBeatport()" style="border-color:rgba(150,200,60,0.3);">' +
                    '<span class="connect-chip-dot" style="background:#96C83C;"></span>' +
                    '<span class="connect-chip-name">Beatport</span>' +
                    '<span class="cc-status connect-chip-status">Coming Soon</span>' +
                '</div>' +
                '<div id="ticketmasterCard" class="connect-chip" onclick="connectTicketmaster()" style="border-color:rgba(0,150,214,0.3);">' +
                    '<span class="connect-chip-dot" style="background:#0096D6;"></span>' +
                    '<span class="connect-chip-name">Ticketmaster</span>' +
                    '<span class="cc-status connect-chip-status">Coming Soon</span>' +
                '</div>' +
            '</div>' +
            '<div id="spotifyLibrary" class="service-library service-library-spotify" style="display:none;">' +
                '<div class="service-library-header"><span class="service-library-label" id="spotifyUserLabel" style="color:#1DB954;">Spotify</span></div>' +
                '<div class="service-search-row">' +
                    '<input type="text" id="spotifySearchInput" class="service-search-input" placeholder="Search Spotify..." style="border-color:rgba(29,185,84,0.3);" onkeydown="if(event.key===\'Enter\')spotifySearch()">' +
                    '<select id="spotifyGenreFilter" class="service-genre-filter"><option value="">All</option><option value="house">House</option><option value="techno">Techno</option><option value="trance">Trance</option><option value="deep house">Deep House</option><option value="progressive house">Progressive</option><option value="drum and bass">DnB</option><option value="ambient">Ambient</option></select>' +
                    '<button class="service-search-btn" style="background:#1DB954;" onclick="spotifySearch()">Go</button>' +
                '</div>' +
                '<div id="spotifyPlaylists"></div>' +
                '<div id="spotifyResults" class="service-results"></div>' +
            '</div>' +
            '<div id="tidalLibrary" class="service-library service-library-tidal" style="display:none;">' +
                '<div class="service-search-row">' +
                    '<input type="text" id="tidalSearchInput" class="service-search-input" placeholder="Search Tidal..." style="border-color:rgba(0,191,255,0.3);" onkeydown="if(event.key===\'Enter\')tidalSearch()">' +
                    '<select id="tidalGenreFilter" class="service-genre-filter"><option value="">All</option><option value="house">House</option><option value="techno">Techno</option><option value="trance">Trance</option><option value="deep house">Deep House</option><option value="ambient">Ambient</option></select>' +
                    '<button class="service-search-btn" style="background:#00BFFF;" onclick="tidalSearch()">Go</button>' +
                '</div>' +
                '<div id="tidalResults" class="service-results"></div>' +
            '</div>' +
            '<div id="buildProfileResults"></div>' +
            '<div id="profileTrackBadge" style="display:none;margin-top:8px;font-size:0.7rem;color:#D4A017;text-align:center;"></div>' +
            '<div class="feature-grid">' + buildCards(profileTools) + '</div>' +
        '</div>' +

        // SWIM LANE: Studio
        '<div class="swim-lane">' +
            '<div class="swim-lane-header">' +
                '<div class="swim-lane-title">Studio</div>' +
                '<div class="swim-lane-sub">Master, remix, generate, and perform</div>' +
            '</div>' +
            '<div class="feature-grid">' + buildCards(studioTools) + '</div>' +
        '</div>' +

        // Error Log
        '<div class="home-section" id="errorLogSection" style="display:none;">' +
            '<div class="error-log-header">' +
                '<div class="home-section-title" style="color:var(--sbm-danger);margin-bottom:0;">Error Log</div>' +
                '<button class="btn-error-refresh" onclick="loadErrorLog()">Refresh</button>' +
            '</div>' +
            '<div id="errorLogEntries" class="error-log-entries"></div>' +
        '</div>';

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
