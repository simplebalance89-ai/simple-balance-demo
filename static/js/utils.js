/* ===== UTILS — Shared Helpers ===== */

function showNotConfigured(container, modeName) {
    container.innerHTML = `
        <div style="text-align:center;padding:40px 20px;">
            <div style="font-size:2.5rem;margin-bottom:12px;">🔧</div>
            <div style="font-family:'Playfair Display',serif;font-size:1.2rem;color:#FFE082;margin-bottom:8px;">${modeName} — Coming Soon</div>
            <div style="font-size:0.8rem;color:#8A7A5A;max-width:400px;margin:0 auto;">This mode requires API keys to be configured. Connect your keys in the Render dashboard to activate.</div>
        </div>`;
}

function formatDuration(seconds) {
    if (!seconds) return '';
    seconds = Math.round(seconds);
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
}

async function clearAllCache() {
    if ('serviceWorker' in navigator) {
        var regs = await navigator.serviceWorker.getRegistrations();
        for (var r of regs) await r.unregister();
    }
    if ('caches' in window) {
        var names = await caches.keys();
        for (var n of names) await caches.delete(n);
    }
    localStorage.clear();
    window.location.href = window.location.pathname + '?v=' + Date.now();
}

function buildAnalysisCard(label, value, detail) {
    return '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px;text-align:center;">' +
        '<div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:1px;color:#8A7A5A;margin-bottom:4px;">' + label + '</div>' +
        '<div style="font-family:Playfair Display,serif;font-size:1.5rem;font-weight:700;color:#D4A017;">' + value + '</div>' +
        '<div style="font-size:0.6rem;color:#6A6A7A;">' + detail + '</div>' +
    '</div>';
}

function toggleSampleCard(el) {
    el.classList.toggle('expanded');
}
