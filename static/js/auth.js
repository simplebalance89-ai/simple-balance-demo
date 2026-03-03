/* ===== SIMPLE BALANCE MUSIC — AUTH MODULE ===== */

const SUPABASE_URL = 'https://mprvtxmgnewfqzawpjvy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-DUm9kgx9ao9hdfwA5g-cA_iLDwTtQl';
let supabaseClient = null;
let currentUser = null;
let _cachedAccessToken = null;

/* ----- Supabase Init ----- */
function initSupabase() {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // Listen for auth state changes
        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (session && session.user) {
                currentUser = session.user;
                _cachedAccessToken = session.access_token;
                authUpdateUI(currentUser);
            } else {
                currentUser = null;
                _cachedAccessToken = null;
                authUpdateUI(null);
            }
        });

        checkSession();
    } else {
        console.warn('[Auth] Supabase JS not loaded — auth disabled.');
    }
}

/* ----- Session Management ----- */
async function checkSession() {
    if (!supabaseClient) return;
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) {
            console.warn('[Auth] Session check error:', error.message);
            return;
        }
        if (session && session.user) {
            currentUser = session.user;
            _cachedAccessToken = session.access_token;
            authUpdateUI(currentUser);
        } else {
            currentUser = null;
            _cachedAccessToken = null;
            authUpdateUI(null);
        }
    } catch (err) {
        console.warn('[Auth] Session check failed:', err);
    }
}

function getAuthHeaders() {
    if (_cachedAccessToken) {
        return { Authorization: 'Bearer ' + _cachedAccessToken };
    }
    return {};
}

async function getAuthHeadersAsync() {
    if (!supabaseClient) return {};
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session && session.access_token) {
            return { Authorization: 'Bearer ' + session.access_token };
        }
    } catch (e) {
        console.warn('[Auth] Could not get token:', e);
    }
    return {};
}

/* ----- Auth Actions ----- */
async function authLogin(email, password) {
    if (!supabaseClient) return { error: { message: 'Auth not initialized' } };
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) return { error };
    currentUser = data.user;
    authUpdateUI(currentUser);
    closeAuthModal();
    return { data };
}

async function authSignup(email, password, displayName) {
    if (!supabaseClient) return { error: { message: 'Auth not initialized' } };
    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
            data: { display_name: displayName || '' }
        }
    });
    if (error) return { error };
    // If email confirmation is required, user won't be logged in yet
    if (data.user && data.user.identities && data.user.identities.length === 0) {
        return { error: { message: 'This email is already registered. Try logging in.' } };
    }
    if (data.session) {
        currentUser = data.user;
        authUpdateUI(currentUser);
        closeAuthModal();
    } else {
        // Email confirmation required
        showAuthMessage('Check your email to confirm your account, then log in.');
    }
    return { data };
}

async function authLogout() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    currentUser = null;
    authUpdateUI(null);
    closeAuthDropdown();
}

/* ----- UI Updates ----- */
function authUpdateUI(user) {
    const btn = document.getElementById('authHeaderBtn');
    if (!btn) return;

    if (user) {
        const name = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';
        const initial = name.charAt(0).toUpperCase();
        btn.innerHTML = '<div class="auth-user-btn" onclick="toggleAuthDropdown(event)">' +
            '<div class="auth-avatar">' + initial + '</div>' +
            '<span style="font-size:0.7rem;color:#FFE082;">' + escapeHTML(name) + '</span>' +
            '<div id="authDropdown" class="auth-dropdown" style="display:none;">' +
                '<div onclick="authLogout()">Sign Out</div>' +
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

/* ----- Auth Dropdown ----- */
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

// Close dropdown on outside click
document.addEventListener('click', function(e) {
    if (!e.target.closest('.auth-user-btn')) {
        closeAuthDropdown();
    }
});

/* ----- Auth Modal ----- */
function showAuthModal(mode) {
    // Remove any existing modal
    closeAuthModal();

    var isLogin = mode === 'login';
    var title = isLogin ? 'Sign In' : 'Create Account';
    var btnLabel = isLogin ? 'Sign In' : 'Sign Up';
    var toggleText = isLogin
        ? "Don't have an account? <a onclick=\"switchAuthMode('signup')\">Sign Up</a>"
        : "Already have an account? <a onclick=\"switchAuthMode('login')\">Sign In</a>";

    var nameField = isLogin ? '' :
        '<input type="text" id="authDisplayName" placeholder="Display Name" autocomplete="name">';

    var html =
        '<div class="auth-backdrop" id="authBackdrop" onclick="onBackdropClick(event)">' +
            '<div class="auth-modal" onclick="event.stopPropagation()">' +
                '<button class="auth-close" onclick="closeAuthModal()">&times;</button>' +
                '<h2>' + title + '</h2>' +
                '<div class="auth-error" id="authError"></div>' +
                nameField +
                '<input type="email" id="authEmail" placeholder="Email" autocomplete="email">' +
                '<input type="password" id="authPassword" placeholder="Password" autocomplete="' + (isLogin ? 'current-password' : 'new-password') + '">' +
                '<button class="auth-btn" onclick="handleAuthSubmit(\'' + mode + '\')">' + btnLabel + '</button>' +
                '<div class="auth-toggle">' + toggleText + '</div>' +
                '<div id="authMessage" style="text-align:center;margin-top:12px;font-size:0.75rem;color:#22c55e;min-height:18px;"></div>' +
            '</div>' +
        '</div>';

    var container = document.createElement('div');
    container.id = 'authModalContainer';
    container.innerHTML = html;
    document.body.appendChild(container);

    // Focus the first input
    setTimeout(function() {
        var first = isLogin
            ? document.getElementById('authEmail')
            : document.getElementById('authDisplayName');
        if (first) first.focus();
    }, 100);

    // Allow enter key to submit
    var handleEnter = function(e) {
        if (e.key === 'Enter') handleAuthSubmit(mode);
    };
    var emailInput = document.getElementById('authEmail');
    var passInput = document.getElementById('authPassword');
    if (emailInput) emailInput.addEventListener('keydown', handleEnter);
    if (passInput) passInput.addEventListener('keydown', handleEnter);
    var nameInput = document.getElementById('authDisplayName');
    if (nameInput) nameInput.addEventListener('keydown', handleEnter);
}

function switchAuthMode(mode) {
    showAuthModal(mode);
}

function closeAuthModal() {
    var c = document.getElementById('authModalContainer');
    if (c) c.remove();
}

function onBackdropClick(e) {
    if (e.target.id === 'authBackdrop') {
        closeAuthModal();
    }
}

function showAuthError(msg) {
    var el = document.getElementById('authError');
    if (el) el.textContent = msg || '';
}

function showAuthMessage(msg) {
    var el = document.getElementById('authMessage');
    if (el) el.textContent = msg || '';
}

async function handleAuthSubmit(mode) {
    var email = (document.getElementById('authEmail')?.value || '').trim();
    var password = (document.getElementById('authPassword')?.value || '').trim();

    showAuthError('');
    showAuthMessage('');

    if (!email || !password) {
        showAuthError('Email and password are required.');
        return;
    }

    if (password.length < 6) {
        showAuthError('Password must be at least 6 characters.');
        return;
    }

    // Disable button while processing
    var btn = document.querySelector('.auth-modal .auth-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Please wait...';
    }

    var result;
    if (mode === 'login') {
        result = await authLogin(email, password);
    } else {
        var displayName = (document.getElementById('authDisplayName')?.value || '').trim();
        result = await authSignup(email, password, displayName);
    }

    if (result && result.error) {
        showAuthError(result.error.message || 'Something went wrong.');
        if (btn) {
            btn.disabled = false;
            btn.textContent = mode === 'login' ? 'Sign In' : 'Sign Up';
        }
    }
}

/* ----- Init on load ----- */
(function() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSupabase);
    } else {
        initSupabase();
    }
})();
