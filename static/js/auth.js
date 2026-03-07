/* ===== SIMPLE BALANCE MUSIC — CREW AUTH ===== */

var sbmToken = null;
var sbmProfile = null; // {display_name, color, is_admin}

var SBM_COLORS = [
    '#818cf8', '#10B981', '#E879F9', '#F59E0B',
    '#EF4444', '#06B6D4', '#A78BFA', '#F472B6'
];

/* ----- Crew Fetch (adds token header) ----- */
function sbmFetch(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    if (sbmToken) options.headers['X-Crew-Token'] = sbmToken;
    return fetch(url, options);
}

/* ----- Auto-login from saved token ----- */
function initAuth() {
    loadGateMembers();
    buildGateColors();
    var saved = localStorage.getItem('sbmToken');
    if (saved) {
        fetch('/api/crew/verify', { headers: { 'X-Crew-Token': saved } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.profile) {
                    sbmToken = saved;
                    sbmProfile = data.profile;
                    onGateSuccess();
                } else {
                    localStorage.removeItem('sbmToken');
                }
            })
            .catch(function() {});
    }
}

/* ----- Login Gate ----- */
function loadGateMembers() {
    fetch('/api/crew/members').then(function(r) { return r.json(); }).then(function(data) {
        var sel = document.getElementById('gateName');
        if (!sel || !data.members) return;
        sel.innerHTML = '<option value="">Select your name...</option>';
        data.members.forEach(function(m) {
            var name = typeof m === 'string' ? m : m.name;
            sel.innerHTML += '<option value="' + escapeHTML(name) + '">' + escapeHTML(name) + '</option>';
        });
    }).catch(function() {});
}

function buildGateColors() {
    var container = document.getElementById('gateColors');
    if (!container) return;
    var html = '';
    SBM_COLORS.forEach(function(c, i) {
        html += '<div class="color-swatch' + (i === 0 ? ' picked' : '') + '" data-color="' + c + '" onclick="pickColor(this)" style="width:28px;height:28px;border-radius:50%;background:' + c + ';cursor:pointer;border:2px solid ' + (i === 0 ? '#fff' : 'transparent') + ';"></div>';
    });
    container.innerHTML = html;
}

function switchGateTab(tab) {
    document.getElementById('gateError').textContent = '';
    if (tab === 'signin') {
        document.getElementById('gateSignin').style.display = 'block';
        document.getElementById('gateRegister').style.display = 'none';
        document.getElementById('gateTabSignin').style.color = '#FFE082';
        document.getElementById('gateTabSignin').style.borderBottomColor = '#FFE082';
        document.getElementById('gateTabRegister').style.color = 'rgba(255,255,255,0.4)';
        document.getElementById('gateTabRegister').style.borderBottomColor = 'transparent';
    } else {
        document.getElementById('gateSignin').style.display = 'none';
        document.getElementById('gateRegister').style.display = 'block';
        document.getElementById('gateTabRegister').style.color = '#FFE082';
        document.getElementById('gateTabRegister').style.borderBottomColor = '#FFE082';
        document.getElementById('gateTabSignin').style.color = 'rgba(255,255,255,0.4)';
        document.getElementById('gateTabSignin').style.borderBottomColor = 'transparent';
    }
}

function gateLogin() {
    var name = document.getElementById('gateName').value;
    var pin = document.getElementById('gatePin').value;
    var err = document.getElementById('gateError');
    err.textContent = '';
    if (!name) { err.textContent = 'Pick your name'; return; }
    if (!pin || pin.length !== 4) { err.textContent = 'PIN must be 4 digits'; return; }

    fetch('/api/crew/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, pin: pin })
    }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
        if (res.ok && res.data.token) {
            sbmToken = res.data.token;
            sbmProfile = res.data.profile;
            localStorage.setItem('sbmToken', sbmToken);
            onGateSuccess();
        } else {
            err.textContent = res.data.error || 'Login failed';
        }
    }).catch(function() { err.textContent = 'Server error'; });
}

function gateRegister() {
    var name = (document.getElementById('gateRegName').value || '').trim();
    var pin = document.getElementById('gateRegPin').value;
    var color = getSelectedColor();
    var err = document.getElementById('gateError');
    err.textContent = '';
    if (!name || name.length < 2) { err.textContent = 'Name must be at least 2 characters'; return; }
    if (!pin || pin.length !== 4) { err.textContent = 'PIN must be 4 digits'; return; }

    fetch('/api/crew/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, pin: pin, color: color })
    }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
        if (res.ok && res.data.token) {
            sbmToken = res.data.token;
            sbmProfile = res.data.profile;
            localStorage.setItem('sbmToken', sbmToken);
            onGateSuccess();
        } else {
            err.textContent = res.data.error || 'Registration failed';
        }
    }).catch(function() { err.textContent = 'Server error'; });
}

function onGateSuccess() {
    // Hide gate, show app
    var gate = document.getElementById('loginGate');
    if (gate) gate.style.display = 'none';
    var topBar = document.getElementById('topBar');
    if (topBar) topBar.style.display = '';
    var app = document.getElementById('app');
    if (app) app.style.display = '';
    var nav = document.getElementById('bottomNav');
    if (nav) nav.style.display = '';
    authUpdateUI(sbmProfile);
    showToast('Welcome, ' + sbmProfile.display_name + '!');
}

/* ----- UI Update ----- */
function authUpdateUI(profile) {
    var btn = document.getElementById('authHeaderBtn');
    if (!btn) return;

    if (profile) {
        var initial = profile.display_name.charAt(0).toUpperCase();
        var links = profile.links || {};
        var linkBtns = '';
        if (links.spotify) linkBtns += '<div onclick="window.open(\'' + links.spotify + '\',\'_blank\')" style="color:#1DB954;">Spotify</div>';
        if (links.soundcloud) linkBtns += '<div onclick="window.open(\'' + links.soundcloud + '\',\'_blank\')" style="color:#FF5500;">SoundCloud</div>';
        if (links.beatport) linkBtns += '<div onclick="window.open(\'' + links.beatport + '\',\'_blank\')" style="color:#94D500;">Beatport</div>';
        btn.innerHTML =
            '<div class="auth-user-btn" onclick="toggleAuthDropdown(event)">' +
                '<div class="auth-avatar" style="background:' + profile.color + ';">' + initial + '</div>' +
                '<span style="font-size:0.7rem;color:#FFE082;">' + escapeHTML(profile.display_name) + '</span>' +
                '<div id="authDropdown" class="auth-dropdown" style="display:none;">' +
                    linkBtns +
                    '<div onclick="authLogout()" style="border-top:1px solid rgba(255,255,255,0.1);margin-top:4px;padding-top:8px;">Sign Out</div>' +
                '</div>' +
            '</div>';
        btn.removeAttribute('onclick');
        btn.style.cursor = 'default';
    } else {
        btn.innerHTML = 'Sign In';
        btn.setAttribute('onclick', "showAuthModal('login')");
        btn.style.cursor = 'pointer';
    }
}

function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

/* ----- Dropdown ----- */
function toggleAuthDropdown(e) {
    e.stopPropagation();
    var dd = document.getElementById('authDropdown');
    if (!dd) return;
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

function closeAuthDropdown() {
    var dd = document.getElementById('authDropdown');
    if (dd) dd.style.display = 'none';
}

document.addEventListener('click', function(e) {
    if (!e.target.closest('.auth-user-btn')) closeAuthDropdown();
});

/* ----- Logout ----- */
function authLogout() {
    sbmToken = null;
    sbmProfile = null;
    localStorage.removeItem('sbmToken');
    closeAuthDropdown();
    authUpdateUI(null);
    showToast('Signed out');
}

/* ----- Auth Modal ----- */
function showAuthModal(mode) {
    closeAuthModal();
    var isLogin = mode === 'login';

    var html =
        '<div class="auth-backdrop" id="authBackdrop" onclick="if(event.target.id===\'authBackdrop\')closeAuthModal()">' +
            '<div class="auth-modal" onclick="event.stopPropagation()">' +
                '<button class="auth-close" onclick="closeAuthModal()">&times;</button>' +
                '<div style="display:flex;gap:0;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.1);">' +
                    '<div class="login-tab' + (isLogin ? ' active' : '') + '" onclick="switchAuthMode(\'login\')" style="flex:1;text-align:center;padding:10px;cursor:pointer;font-weight:700;font-size:0.85rem;color:' + (isLogin ? '#FFE082' : 'rgba(255,255,255,0.4)') + ';border-bottom:2px solid ' + (isLogin ? '#FFE082' : 'transparent') + ';">Sign In</div>' +
                    '<div class="login-tab' + (!isLogin ? ' active' : '') + '" onclick="switchAuthMode(\'signup\')" style="flex:1;text-align:center;padding:10px;cursor:pointer;font-weight:700;font-size:0.85rem;color:' + (!isLogin ? '#FFE082' : 'rgba(255,255,255,0.4)') + ';border-bottom:2px solid ' + (!isLogin ? '#FFE082' : 'transparent') + ';">Register</div>' +
                '</div>' +
                '<div class="auth-error" id="authError"></div>' +
                (isLogin ? buildSigninForm() : buildRegisterForm()) +
            '</div>' +
        '</div>';

    var container = document.createElement('div');
    container.id = 'authModalContainer';
    container.innerHTML = html;
    document.body.appendChild(container);

    if (isLogin) loadCrewMembers();
}

function buildSigninForm() {
    return '<div id="signinForm">' +
        '<select id="loginName" style="width:100%;padding:12px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:0.85rem;margin-bottom:10px;font-family:inherit;">' +
            '<option value="">Select your name...</option>' +
        '</select>' +
        '<input type="password" id="loginPin" placeholder="4-digit PIN" maxlength="4" inputmode="numeric" pattern="[0-9]*" style="width:100%;padding:12px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:0.85rem;margin-bottom:14px;font-family:inherit;box-sizing:border-box;">' +
        '<button onclick="doLogin()" style="width:100%;padding:12px;background:linear-gradient(135deg,#D4A017,#FFE082);color:#0D0D1A;border:none;border-radius:8px;font-weight:800;font-size:0.9rem;cursor:pointer;font-family:inherit;">SIGN IN</button>' +
    '</div>';
}

function buildRegisterForm() {
    var swatches = '';
    SBM_COLORS.forEach(function(c, i) {
        swatches += '<div class="color-swatch' + (i === 0 ? ' picked' : '') + '" data-color="' + c + '" onclick="pickColor(this)" style="width:28px;height:28px;border-radius:50%;background:' + c + ';cursor:pointer;border:2px solid ' + (i === 0 ? '#fff' : 'transparent') + ';"></div>';
    });

    return '<div id="registerForm">' +
        '<input type="text" id="registerName" placeholder="Your producer name" style="width:100%;padding:12px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:0.85rem;margin-bottom:10px;font-family:inherit;box-sizing:border-box;">' +
        '<input type="password" id="registerPin" placeholder="4-digit PIN" maxlength="4" inputmode="numeric" pattern="[0-9]*" style="width:100%;padding:12px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:0.85rem;margin-bottom:12px;font-family:inherit;box-sizing:border-box;">' +
        '<div style="margin-bottom:14px;">' +
            '<div style="font-size:0.7rem;color:rgba(255,255,255,0.4);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">Pick your color</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + swatches + '</div>' +
        '</div>' +
        '<button onclick="doRegister()" style="width:100%;padding:12px;background:linear-gradient(135deg,#D4A017,#FFE082);color:#0D0D1A;border:none;border-radius:8px;font-weight:800;font-size:0.9rem;cursor:pointer;font-family:inherit;">CREATE PROFILE</button>' +
    '</div>';
}

function loadCrewMembers() {
    fetch('/api/crew/members').then(function(r) { return r.json(); }).then(function(data) {
        var sel = document.getElementById('loginName');
        if (!sel || !data.members) return;
        sel.innerHTML = '<option value="">Select your name...</option>';
        data.members.forEach(function(m) {
            var name = typeof m === 'string' ? m : m.name;
            var color = typeof m === 'object' ? m.color : '';
            sel.innerHTML += '<option value="' + escapeHTML(name) + '" style="color:' + color + ';">' + escapeHTML(name) + '</option>';
        });
    }).catch(function() {});
}

function switchAuthMode(mode) {
    showAuthModal(mode);
}

function closeAuthModal() {
    var c = document.getElementById('authModalContainer');
    if (c) c.remove();
}

function pickColor(el) {
    document.querySelectorAll('.color-swatch').forEach(function(s) {
        s.classList.remove('picked');
        s.style.border = '2px solid transparent';
    });
    el.classList.add('picked');
    el.style.border = '2px solid #fff';
}

function getSelectedColor() {
    var picked = document.querySelector('.color-swatch.picked');
    return picked ? picked.getAttribute('data-color') : '#818cf8';
}

/* ----- Login ----- */
function doLogin() {
    var name = document.getElementById('loginName').value;
    var pin = document.getElementById('loginPin').value;
    var errEl = document.getElementById('authError');
    errEl.textContent = '';
    if (!name) { errEl.textContent = 'Pick your name'; return; }
    if (!pin || pin.length !== 4) { errEl.textContent = 'PIN must be 4 digits'; return; }

    fetch('/api/crew/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, pin: pin })
    }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
        if (res.ok && res.data.token) {
            sbmToken = res.data.token;
            sbmProfile = res.data.profile;
            localStorage.setItem('sbmToken', sbmToken);
            authUpdateUI(sbmProfile);
            closeAuthModal();
            showToast('Welcome, ' + sbmProfile.display_name + '!');
        } else {
            errEl.textContent = res.data.error || 'Login failed';
        }
    }).catch(function() {
        errEl.textContent = 'Server error';
    });
}

/* ----- Register ----- */
function doRegister() {
    var name = (document.getElementById('registerName').value || '').trim();
    var pin = document.getElementById('registerPin').value;
    var color = getSelectedColor();
    var errEl = document.getElementById('authError');
    errEl.textContent = '';
    if (!name || name.length < 2) { errEl.textContent = 'Name must be at least 2 characters'; return; }
    if (!pin || pin.length !== 4) { errEl.textContent = 'PIN must be 4 digits'; return; }

    fetch('/api/crew/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, pin: pin, color: color })
    }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
        if (res.ok && res.data.token) {
            sbmToken = res.data.token;
            sbmProfile = res.data.profile;
            localStorage.setItem('sbmToken', sbmToken);
            authUpdateUI(sbmProfile);
            closeAuthModal();
            showToast('Profile created! Welcome, ' + sbmProfile.display_name);
        } else {
            errEl.textContent = res.data.error || 'Registration failed';
        }
    }).catch(function() {
        errEl.textContent = 'Server error';
    });
}

/* ----- Init on load ----- */
(function() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuth);
    } else {
        initAuth();
    }
})();
