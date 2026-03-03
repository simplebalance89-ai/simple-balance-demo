/* ===== LIBRARY & ARCHIVE ===== */

/* --- Mix Archive (experience builder mode) --- */
function buildArchiveExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Upload mixes to your archive. View your collection.</p>
        </div>
        <div style="width:100%;max-width:600px;">
            <div style="background:rgba(255,255,255,0.03);border:2px dashed rgba(212,160,23,0.3);border-radius:16px;padding:32px;text-align:center;margin-bottom:16px;cursor:pointer;" onclick="document.getElementById('archiveFile').click()" id="archiveDropZone">
                <div style="font-size:2.5rem;margin-bottom:8px;">💾</div>
                <div style="font-family:'Playfair Display',serif;font-size:1.1rem;color:#FFE082;margin-bottom:4px;">Upload a mix to archive</div>
                <div style="font-size:0.75rem;color:#8A7A5A;">MP3, WAV, M4A, FLAC</div>
                <input type="file" id="archiveFile" accept="audio/*" style="display:none" onchange="uploadArchive(this)">
            </div>
            <div id="archiveUploadStatus" style="display:none;text-align:center;padding:12px;font-size:0.85rem;color:#D4A017;"></div>
            <div id="archiveListSection">
                <div style="font-family:'Playfair Display',serif;font-size:0.95rem;color:#FFE082;margin-bottom:10px;">Your Archive</div>
                <div id="archiveList" style="font-size:0.8rem;color:#8A7A5A;">Loading...</div>
            </div>
        </div>`;
}

function uploadArchive(input) {
    var file = input.files[0];
    if (!file) return;
    var status = document.getElementById('archiveUploadStatus');
    status.style.display = 'block';
    status.textContent = 'Uploading "' + file.name + '"...';
    status.style.color = '#D4A017';

    var formData = new FormData();
    formData.append('file', file);

    fetch('/api/archive/upload', { method: 'POST', body: formData })
    .then(function(r){ return r.json(); })
    .then(function(data){
        if (data.error) {
            status.textContent = 'Error: ' + data.error;
            status.style.color = '#C41E3A';
        } else {
            status.textContent = 'Archived! ' + data.entry.filename + ' (' + data.entry.size_mb + ' MB)';
            status.style.color = '#4CAF50';
            loadArchiveList();
        }
        input.value = '';
    })
    .catch(function(err){
        status.textContent = 'Upload failed: ' + err.message;
        status.style.color = '#C41E3A';
    });
}

function loadArchiveList() {
    var list = document.getElementById('archiveList');
    if (!list) return;
    fetch('/api/archive')
    .then(function(r){ return r.json(); })
    .then(function(data){
        if (!data.mixes || data.mixes.length === 0) {
            list.innerHTML = '<div style="color:#666;font-size:0.78rem;">No mixes archived yet. Upload one above.</div>';
            return;
        }
        list.innerHTML = data.mixes.map(function(m){
            return '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;margin-bottom:8px;">' +
                '<div style="width:40px;height:40px;border-radius:8px;background:rgba(212,160,23,0.1);display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">💾</div>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-size:0.85rem;font-weight:700;color:#FFFEF7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + m.filename + '</div>' +
                    '<div style="font-size:0.65rem;color:#8A7A5A;">' + m.size_mb + ' MB &bull; ' + m.uploaded_at + '</div>' +
                '</div></div>';
        }).join('');
    })
    .catch(function(){
        list.innerHTML = '<div style="color:#C41E3A;font-size:0.78rem;">Failed to load archive.</div>';
    });
}

/* --- Upload Mix (digest from Home/Connect) --- */
function uploadMixStep1(input) {
    var file = input.files[0];
    if (!file) return;
    var status = document.getElementById('step1MixStatus');
    var results = document.getElementById('step1MixResults');
    status.style.display = 'block';
    status.innerHTML = '<div style="font-size:0.85rem;color:#D4A017;">Uploading "' + file.name + '" to AudD Digestor...</div>';
    results.style.display = 'none';

    var formData = new FormData();
    formData.append('file', file);

    fetch('/api/digestor', { method: 'POST', body: formData })
    .then(function(r){ return r.json(); })
    .then(function(data){
        if (data.error) {
            status.innerHTML = '<div style="font-size:0.85rem;color:#C41E3A;">Error: ' + data.error + '</div>';
            return;
        }
        var tracks = data.tracks || [];
        mixUploadedTracks = tracks.map(function(t){ return { name: t.title, artist: t.artist }; });
        status.innerHTML = '<div style="font-size:0.85rem;color:#22c55e;">Found ' + tracks.length + ' tracks in your mix!</div>';
        if (tracks.length > 0) {
            results.style.display = 'block';
            results.innerHTML = tracks.slice(0, 8).map(function(t){
                return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:0.78rem;">' +
                    '<span style="color:#D4A017;font-weight:700;">' + (t.timestamp || '') + '</span>' +
                    '<span style="color:#fff;">' + (t.title || 'Unknown') + '</span>' +
                    '<span style="color:#8A7A5A;"> — ' + (t.artist || '') + '</span></div>';
            }).join('');
        }
    })
    .catch(function(err){
        status.innerHTML = '<div style="font-size:0.85rem;color:#C41E3A;">Upload failed: ' + err.message + '</div>';
    });
}

/* --- Upload Mix (Library tab digestor) --- */
function uploadMixLibrary(input) {
    var file = input.files[0];
    if (!file) return;
    var status = document.getElementById('libraryMixStatus');
    var results = document.getElementById('libraryMixResults');
    status.style.display = 'block';
    status.innerHTML = '<div style="font-size:0.85rem;color:#D4A017;">Running AudD Digestor on "' + file.name + '"...</div>';
    results.style.display = 'none';

    var formData = new FormData();
    formData.append('file', file);

    fetch('/api/digestor', { method: 'POST', body: formData })
    .then(function(r){ return r.json(); })
    .then(function(data){
        if (data.error) {
            status.innerHTML = '<div style="font-size:0.85rem;color:#C41E3A;">Error: ' + data.error + '</div>';
            return;
        }
        var tracks = data.tracks || [];
        status.innerHTML = '<div style="font-size:0.85rem;color:#22c55e;">Found ' + tracks.length + ' tracks!</div>';
        if (tracks.length > 0) {
            results.style.display = 'block';
            results.innerHTML = tracks.map(function(t){
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;margin-bottom:4px;font-size:0.78rem;">' +
                    '<span style="color:#D4A017;font-weight:700;min-width:50px;">' + (t.timestamp || '') + '</span>' +
                    '<span style="color:#fff;flex:1;">' + (t.title || 'Unknown') + ' — <span style="color:#8A7A5A;">' + (t.artist || '') + '</span></span></div>';
            }).join('');
        }
    })
    .catch(function(err){
        status.innerHTML = '<div style="font-size:0.85rem;color:#C41E3A;">Upload failed: ' + err.message + '</div>';
    });
}

/* --- Archive Upload & List (Library tab) --- */
function uploadArchiveLibrary(input) {
    var file = input.files[0];
    if (!file) return;
    var status = document.getElementById('archiveStatusLib');
    status.style.display = 'block';
    status.textContent = 'Uploading "' + file.name + '"...';
    status.style.color = '#D4A017';

    var formData = new FormData();
    formData.append('file', file);

    fetch('/api/archive/upload', { method: 'POST', body: formData })
    .then(function(r){ return r.json(); })
    .then(function(data){
        if (data.error) {
            status.textContent = 'Error: ' + data.error;
            status.style.color = '#C41E3A';
        } else {
            status.textContent = 'Archived! ' + data.entry.filename;
            status.style.color = '#22c55e';
            loadArchiveListLibrary();
        }
        input.value = '';
    })
    .catch(function(err){
        status.textContent = 'Upload failed: ' + err.message;
        status.style.color = '#C41E3A';
    });
}

function loadArchiveListLibrary() {
    var list = document.getElementById('archiveListLib');
    if (!list) return;
    fetch('/api/archive')
    .then(function(r){ return r.json(); })
    .then(function(data){
        if (!data.mixes || data.mixes.length === 0) {
            list.innerHTML = '<div style="color:#666;font-size:0.78rem;">No mixes archived yet.</div>';
            return;
        }
        list.innerHTML = data.mixes.map(function(m){
            return '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;margin-bottom:6px;">' +
                '<div style="font-size:1rem;">💾</div>' +
                '<div style="flex:1;"><div style="font-size:0.8rem;color:#fff;">' + m.filename + '</div>' +
                '<div style="font-size:0.65rem;color:#8A7A5A;">' + m.size_mb + ' MB &bull; ' + m.uploaded_at + '</div></div></div>';
        }).join('');
    })
    .catch(function(){
        list.innerHTML = '<div style="color:#C41E3A;font-size:0.78rem;">Failed to load archive.</div>';
    });
}
