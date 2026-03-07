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
    liveaudit: 'Live Audit',
    vibecheck: 'Vibe Check',
    board: 'Status Board'
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
    { mode: 'tools',     icon: '🛠️', label: 'Tools' },
    { mode: 'vibecheck', icon: '📡', label: 'Vibe' },
    { mode: 'board',     icon: '📝', label: 'Board' }
];

/* ===== API STATUS CHECK ===== */
(function fetchApiStatus() {
    fetch('/api/status')
        .then(r => r.json())
        .then(data => { apiStatus = data; renderToolTabs(); })
        .catch(() => {});
})();

/* ===== CATEGORY DEFINITIONS ===== */
var CATEGORIES = {
    studio: {
        title: 'Studio',
        sub: 'Master, remix, generate, and perform',
        tools: [
            { mode: 'digestor',  icon: '🔬', name: 'Digestor',   desc: 'Extract tracklists from DJ mixes' },
            { mode: 'liveaudit', icon: '🔍', name: 'Live Audit', desc: 'Full set analysis — tracklist, BPM, transitions' },
            { mode: 'stems',     icon: '🔀', name: 'Stems',      desc: 'Separate vocals, drums, bass, melody' },
            { mode: 'generation',icon: '🎹', name: 'Generate',   desc: 'Create beats and loops with AI' },
            { mode: 'mastering', icon: '🎚️', name: 'Master',     desc: 'Upload a track for AI mastering analysis' },
            { mode: 'samples',   icon: '🎙️', name: 'Samples',    desc: 'Record, tag, and auto-ID audio samples' }
        ]
    },
    discover: {
        title: 'Discover',
        sub: 'Find music, events, and track IDs',
        tools: [
            { mode: 'shazam',    icon: '🎧', name: 'Live ID',    desc: 'Mic-based real-time track identification' },
            { mode: 'discovery', icon: '🧭', name: 'Discover',   desc: 'Mood-based AI track recommendations' },
            { mode: 'events',    icon: '📍', name: 'Events',     desc: 'Upcoming shows and festivals near you' }
        ]
    },
    library: {
        title: 'Library',
        sub: 'Your sets, samples, press kit, and more',
        tools: [
            { mode: 'setbuilder',icon: '📋', name: 'Sets',       desc: 'Build and plan DJ sets with AI' },
            { mode: 'archive',   icon: '📚', name: 'Archive',    desc: 'Your saved mixes, tracks, and history' },
            { mode: 'presskit',  icon: '📋', name: 'Press Kit',  desc: 'Build your EPK for bookings and promos' },
            { mode: 'vibecheck', icon: '📡', name: 'Vibe Check', desc: 'Live session — audience sees tracks & requests' },
            { mode: 'board',     icon: '📝', name: 'Board',      desc: 'Status board and project tracking' },
            { mode: 'tools',     icon: '🛠️', name: 'Tools',      desc: 'BPM tap, key finder, utilities' }
        ]
    }
};

/* ===== BOTTOM NAV ===== */
function sbmNavTo(section) {
    document.querySelectorAll('.sbm-nav-btn').forEach(function(b) { b.classList.remove('active'); });
    var btn = document.getElementById('nav' + section.charAt(0).toUpperCase() + section.slice(1));
    if (btn) btn.classList.add('active');

    // Hide tool tabs strip — we use category pages now
    var tabsWrap = document.getElementById('toolTabsWrap');
    if (tabsWrap) tabsWrap.style.display = 'none';

    if (section === 'home') {
        selectedMode = null;
        currentTab = 'home';
        renderHomeContent();
    } else if (CATEGORIES[section]) {
        selectedMode = null;
        currentTab = section;
        renderCategoryPage(section);
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

/* ===== RENDER TOOL TABS (legacy — hidden by default now) ===== */
function renderToolTabs() {
    // No-op: tool tabs strip replaced by category pages
}

/* ===== RENDER CATEGORY PAGE ===== */
function renderCategoryPage(section) {
    var cat = CATEGORIES[section];
    if (!cat) return;
    var area = document.getElementById('contentArea');
    if (!area) return;

    var html = '<div class="category-page">' +
        '<div class="category-header">' +
            '<h1 class="category-title">' + cat.title + '</h1>' +
            '<p class="category-sub">' + cat.sub + '</p>' +
        '</div>' +
        '<div class="category-grid">';

    cat.tools.forEach(function(t) {
        html += '<div class="category-card" onclick="selectTool(\'' + t.mode + '\')">' +
            '<div class="category-card-icon">' + t.icon + '</div>' +
            '<div class="category-card-body">' +
                '<div class="category-card-name">' + t.name + '</div>' +
                '<div class="category-card-desc">' + t.desc + '</div>' +
            '</div>' +
            '<div class="category-card-arrow">&#8250;</div>' +
        '</div>';
    });

    html += '</div></div>';
    area.innerHTML = html;
}

/* ===== SELECT TOOL ===== */
function selectTool(mode) {
    if (selectedMode === mode) {
        // Toggle off — go back to current category or home
        selectedMode = null;
        if (currentTab && CATEGORIES[currentTab]) {
            renderCategoryPage(currentTab);
        } else {
            renderHomeContent();
        }
        return;
    }
    selectedMode = mode;

    var area = document.getElementById('contentArea');
    if (!area) return;

    // Add back button
    var backTarget = currentTab || 'home';
    var backLabel = CATEGORIES[backTarget] ? CATEGORIES[backTarget].title : 'Home';
    var backHtml = '<div class="tool-back-row">' +
        '<button class="tool-back-btn" onclick="sbmNavTo(\'' + backTarget + '\')">' +
            '&#8249; ' + backLabel +
        '</button>' +
        '<span class="tool-back-title">' + (MODE_NAMES[mode] || mode) + '</span>' +
    '</div>';

    area.innerHTML = backHtml;
    var toolArea = document.createElement('div');
    toolArea.className = 'tool-content-area';
    area.appendChild(toolArea);
    buildExperienceInto(toolArea);
    window.scrollTo(0, 0);
}

/* ===== LAUNCH MODE (backwards compat) ===== */
function launchMode(mode) {
    selectTool(mode);
}

/* ===== NAV TAB (backwards compat) ===== */
function navigateTab(tabName) {
    sbmNavTo(tabName === 'discover' ? 'discover' : tabName === 'studio' ? 'studio' : tabName === 'library' ? 'library' : 'home');
}

/* ===== BUILD EXPERIENCE ===== */
function buildExperienceInto(area) {
    var displayName = (sbmProfile && sbmProfile.display_name) ? sbmProfile.display_name : 'Producer';
    var modeName = MODE_NAMES[selectedMode] || 'Mode';

    if (selectedMode === 'jaw') area.innerHTML = buildJAWExperience(displayName, modeName);
    else if (selectedMode === 'mastering') area.innerHTML = buildMasteringExperience(displayName, modeName);
    else if (selectedMode === 'discovery') area.innerHTML = buildDiscoveryExperience(displayName, modeName);
    else if (selectedMode === 'generation') area.innerHTML = buildGenerationExperience(displayName, modeName);
    else if (selectedMode === 'digestor') area.innerHTML = buildDigestorExperience(displayName, modeName);
    else if (selectedMode === 'shazam') area.innerHTML = buildShazamExperience(displayName, modeName);
    else if (selectedMode === 'stems') area.innerHTML = buildStemsExperience(displayName, modeName);
    else if (selectedMode === 'events') area.innerHTML = buildEventsExperience(displayName, modeName);
    else if (selectedMode === 'setbuilder') area.innerHTML = buildSetBuilderExperience(displayName, modeName);
    else if (selectedMode === 'archive') { area.innerHTML = buildArchiveExperience(displayName, modeName); loadArchiveList(); }
    else if (selectedMode === 'liveaudit') area.innerHTML = buildLiveAuditExperience(displayName, modeName);
    else if (selectedMode === 'presskit') area.innerHTML = buildPressKitExperience(displayName, modeName);
    else if (selectedMode === 'samples') { area.innerHTML = buildSampleSaverExperience(displayName, modeName); renderSampleList(); }
    else if (selectedMode === 'tools') area.innerHTML = buildToolsExperience(displayName, modeName);
    else if (selectedMode === 'dashboard') { area.innerHTML = buildDashboardExperience(displayName, modeName); loadDashboardStats(); }
    else if (selectedMode === 'vibecheck') { area.innerHTML = buildVibeCheckExperience(displayName, modeName); }
    else if (selectedMode === 'board') { area.innerHTML = buildStatusBoardExperience(displayName, modeName); initSBMBoard(); }
    else area.innerHTML = buildDefaultExperience(displayName, modeName);
}

/* ===== HOME CONTENT (when no tool selected) ===== */
function renderHomeContent() {
    var area = document.getElementById('contentArea');
    if (!area) return;

    var displayName = (sbmProfile && sbmProfile.display_name) ? sbmProfile.display_name : 'Producer';
    var avatarColor = (sbmProfile && sbmProfile.color) ? sbmProfile.color : '#D4A017';
    var initial = displayName.charAt(0).toUpperCase();

    area.innerHTML =
        // Hero Banner
        '<div class="hero-banner">' +
            '<div class="hero-bg-pattern"></div>' +
            '<div class="hero-content">' +
                '<div class="hero-brand">simple / balance</div>' +
                '<div class="hero-tagline">Your crew. Your sound. Your edge.</div>' +
                '<div class="hero-welcome">' +
                    '<div class="welcome-avatar" style="background:' + avatarColor + ';">' + initial + '</div>' +
                    '<span>Welcome back, ' + escapeHTML(displayName) + '</span>' +
                '</div>' +
            '</div>' +
        '</div>' +

        // Quick Actions
        '<div class="quick-actions">' +
            '<div class="quick-action-card" onclick="selectTool(\'digestor\')">' +
                '<div class="qa-icon">🔬</div>' +
                '<div class="qa-label">Upload a Mix</div>' +
            '</div>' +
            '<div class="quick-action-card" onclick="selectTool(\'shazam\')">' +
                '<div class="qa-icon">🎧</div>' +
                '<div class="qa-label">ID a Track</div>' +
            '</div>' +
            '<div class="quick-action-card" onclick="toggleJawPanel()">' +
                '<div class="qa-icon">🎙️</div>' +
                '<div class="qa-label">Ask J.A.W.</div>' +
            '</div>' +
            '<div class="quick-action-card" onclick="sbmNavTo(\'studio\')">' +
                '<div class="qa-icon">🎚️</div>' +
                '<div class="qa-label">Open Studio</div>' +
            '</div>' +
        '</div>' +

        // Connect Services
        '<div class="home-section-block">' +
            '<div class="section-block-title">Connect Your Music</div>' +
            '<div class="connect-row-home">' +
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
                    '<span class="cc-status connect-chip-status">Soon</span>' +
                '</div>' +
                '<div id="ticketmasterCard" class="connect-chip" onclick="connectTicketmaster()" style="border-color:rgba(0,150,214,0.3);">' +
                    '<span class="connect-chip-dot" style="background:#0096D6;"></span>' +
                    '<span class="connect-chip-name">Ticketmaster</span>' +
                    '<span class="cc-status connect-chip-status">Soon</span>' +
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
        '</div>' +

        // What's Inside — preview of categories
        '<div class="home-section-block">' +
            '<div class="section-block-title">What\'s Inside</div>' +
            '<div class="category-preview-grid">' +
                '<div class="category-preview" onclick="sbmNavTo(\'studio\')">' +
                    '<div class="cp-icon">🎚️</div>' +
                    '<div class="cp-title">Studio</div>' +
                    '<div class="cp-desc">6 production tools</div>' +
                '</div>' +
                '<div class="category-preview" onclick="sbmNavTo(\'discover\')">' +
                    '<div class="cp-icon">🧭</div>' +
                    '<div class="cp-title">Discover</div>' +
                    '<div class="cp-desc">3 discovery tools</div>' +
                '</div>' +
                '<div class="category-preview" onclick="sbmNavTo(\'library\')">' +
                    '<div class="cp-icon">📚</div>' +
                    '<div class="cp-title">Library</div>' +
                    '<div class="cp-desc">6 management tools</div>' +
                '</div>' +
            '</div>' +
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
    // Hide legacy tool tabs strip
    var tabsWrap = document.getElementById('toolTabsWrap');
    if (tabsWrap) tabsWrap.style.display = 'none';
    renderHomeContent();
});
