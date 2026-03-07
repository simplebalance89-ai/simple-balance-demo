/* ===== ESSENTIA.JS CLIENT-SIDE AUDIO ANALYSIS ===== */

var essentiaInstance = null;

function getEssentia() {
    if (essentiaInstance) return Promise.resolve(essentiaInstance);
    return new Promise(function(resolve, reject) {
        if (typeof EssentiaWASM === 'undefined') { reject(new Error('Essentia WASM not loaded')); return; }
        EssentiaWASM().then(function(wasmModule) {
            essentiaInstance = new Essentia(wasmModule);
            resolve(essentiaInstance);
        }).catch(reject);
    });
}

function analyzeAudioLocal(file) {
    return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() {
            var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioCtx.decodeAudioData(reader.result).then(function(buffer) {
                getEssentia().then(function(essentia) {
                    var mono = buffer.getChannelData(0);
                    var vector = essentia.arrayToVector(mono);
                    var results = {};

                    // BPM detection
                    try {
                        var rhythm = essentia.RhythmExtractor2013(vector);
                        results.bpm = Math.round(rhythm.bpm);
                        results.bpm_confidence = Math.round(rhythm.confidence * 100);
                    } catch(e) { results.bpm = null; }

                    // Key detection
                    try {
                        var keyResult = essentia.KeyExtractor(vector);
                        results.key = keyResult.key + ' ' + keyResult.scale;
                        results.key_strength = Math.round(keyResult.strength * 100);
                    } catch(e) { results.key = null; }

                    // Loudness
                    try {
                        var loudness = essentia.Loudness(vector);
                        results.loudness = Math.round(loudness.loudness * 100) / 100;
                    } catch(e) { results.loudness = null; }

                    // Duration
                    results.duration = Math.round(buffer.duration);
                    results.sample_rate = buffer.sampleRate;

                    audioCtx.close();
                    resolve(results);
                }).catch(function(e) { audioCtx.close(); reject(e); });
            }).catch(reject);
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

/* ===== SHARE TO CREW ===== */
function shareTrackToCrew(encodedTitle, encodedArtist) {
    var title = decodeURIComponent(encodedTitle);
    var artist = decodeURIComponent(encodedArtist);
    var text = title + ' by ' + artist;

    // Try native share first (mobile)
    if (navigator.share) {
        navigator.share({ title: 'Check this track', text: text }).catch(function() {});
        return;
    }

    // Fallback: copy to clipboard + post to crew feed
    navigator.clipboard.writeText(text).then(function() {
        sbmToast('Copied to clipboard: ' + text, 'success');
    }).catch(function() {
        sbmToast('Share: ' + text, 'info');
    });

    // Post to crew feed if available
    var token = localStorage.getItem('sbmToken');
    if (token) {
        fetch('/api/crew/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Crew-Token': token },
            body: JSON.stringify({ type: 'track', title: title, artist: artist })
        }).catch(function() {});
    }
}

/* ===== EXPERIENCE BUILDERS ===== */

/* --- JAW DJ Command (Chat) --- */
function buildJAWExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Your AI DJ advisor. Tap a prompt to try it.</p>
        </div>
        <div class="chat-interface">
            <div class="chat-messages" id="chatMessages">
                <div class="chat-msg system">
                    <div class="msg-label">J.A.W.</div>
                    Hey ${name}. I'm your DJ command center. Ask me anything about mixing, sets, keys, or energy flow.
                </div>
            </div>
            <div class="prompt-chips" id="promptChips">
                <div class="prompt-chip" onclick="sendJAWPrompt(this, 0)">Build me a 2-hour deep house set</div>
                <div class="prompt-chip" onclick="sendJAWPrompt(this, 1)">What key goes with Bb minor?</div>
                <div class="prompt-chip" onclick="sendJAWPrompt(this, 2)">Energy check on my tracklist</div>
            </div>
            <div style="display:flex;gap:8px;width:100%;max-width:600px;margin-top:8px;">
                <input type="text" id="jawInput" placeholder="Ask J.A.W. anything..." onkeydown="if(event.key==='Enter')sendJAWFreeInput()" style="flex:1;padding:12px 16px;border-radius:16px;border:2px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#FFFEF7;font-family:'Nunito',sans-serif;font-size:0.9rem;outline:none;">
                <button onclick="sendJAWFreeInput()" style="padding:12px 20px;border-radius:16px;border:none;background:linear-gradient(135deg,#D4A017,#B8860B);color:#0D0D1A;font-weight:800;cursor:pointer;font-family:'Nunito',sans-serif;">Send</button>
            </div>
        </div>`;
}

var JAW_RESPONSES = [
    'Here\'s your 2-hour deep house set structure:<br><br>' +
    '<strong>Hour 1 (Warm-Up):</strong> 118-120 BPM<br>' +
    '&bull; Open with atmospheric pads, minimal percussion<br>' +
    '&bull; Build layered grooves over first 20 min<br>' +
    '&bull; Key path: Am &rarr; Dm &rarr; Gm &rarr; Cm<br><br>' +
    '<strong>Hour 2 (Peak):</strong> 122-124 BPM<br>' +
    '&bull; Driving basslines, vocal chops<br>' +
    '&bull; Peak energy at 1:30 mark<br>' +
    '&bull; Wind down last 15 min<br>' +
    '&bull; Key path: Fm &rarr; Bbm &rarr; Ebm &rarr; Ab<br><br>' +
    '<em>Want me to suggest specific tracks for each slot?</em>',

    'Bb minor (Bbm) works harmonically with:<br><br>' +
    '&bull; <strong>Relative Major:</strong> Db Major (perfect match)<br>' +
    '&bull; <strong>4th:</strong> Eb minor (smooth transition)<br>' +
    '&bull; <strong>5th:</strong> F minor (energy lift)<br>' +
    '&bull; <strong>Parallel:</strong> Bb Major (mood shift)<br><br>' +
    '<strong>Pro tip:</strong> For deep house, Bbm &rarr; Ebm is your money transition. Keeps the vibe locked while subtly shifting the energy up. Use a 16-bar blend.',

    'Energy analysis coming in:<br><br>' +
    'To check your tracklist energy I\'d scan each track for:<br>' +
    '&bull; <strong>BPM curve</strong> - should flow naturally, no sudden jumps over 4 BPM<br>' +
    '&bull; <strong>Key compatibility</strong> - Camelot wheel adjacent keys only<br>' +
    '&bull; <strong>Energy rating</strong> (1-10) - build gradually, peak at 2/3 mark<br>' +
    '&bull; <strong>Vocal density</strong> - avoid stacking two heavy vocal tracks<br><br>' +
    '<em>Paste your tracklist and I\'ll rate the flow.</em>'
];

function sendJAWPrompt(el, idx) {
    if (el.classList.contains('used')) return;
    el.classList.add('used');
    var msgs = document.getElementById('chatMessages');
    var userText = el.textContent;
    msgs.innerHTML += '<div class="chat-msg user">' + userText + '</div>';
    msgs.innerHTML += '<div class="chat-msg assistant" id="jawPending"><div class="msg-label">J.A.W.</div>Thinking...</div>';
    msgs.scrollTop = msgs.scrollHeight;

    fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({messages: [{role: 'user', content: userText}]})
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        var pending = document.getElementById('jawPending');
        if (data.response) {
            pending.innerHTML = '<div class="msg-label">J.A.W.</div>' + data.response.replace(/\n/g, '<br>');
        } else {
            pending.innerHTML = '<div class="msg-label">J.A.W.</div>' + JAW_RESPONSES[idx];
        }
        pending.removeAttribute('id');
        msgs.scrollTop = msgs.scrollHeight;
    })
    .catch(function() {
        var pending = document.getElementById('jawPending');
        if (pending) {
            pending.innerHTML = '<div class="msg-label">J.A.W.</div>' + JAW_RESPONSES[idx];
            pending.removeAttribute('id');
        }
        msgs.scrollTop = msgs.scrollHeight;
    });
}

function sendJAWFreeInput() {
    var input = document.getElementById('jawInput');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    var msgs = document.getElementById('chatMessages');
    msgs.innerHTML += '<div class="chat-msg user">' + text + '</div>';
    msgs.innerHTML += '<div class="chat-msg assistant" id="jawFree"><div class="msg-label">J.A.W.</div>Thinking...</div>';
    msgs.scrollTop = msgs.scrollHeight;

    fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({messages: [{role: 'user', content: text}]})
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        var el = document.getElementById('jawFree');
        if (data.response) {
            el.innerHTML = '<div class="msg-label">J.A.W.</div>' + data.response.replace(/\n/g, '<br>');
        } else {
            el.innerHTML = '<div class="msg-label">J.A.W.</div>AI not connected. Add Azure OpenAI keys to use live chat.';
        }
        el.removeAttribute('id');
        msgs.scrollTop = msgs.scrollHeight;
    })
    .catch(function() {
        var el = document.getElementById('jawFree');
        if (el) {
            el.innerHTML = '<div class="msg-label">J.A.W.</div>AI not connected yet. Configure Azure OpenAI keys to activate live chat.';
            el.removeAttribute('id');
        }
    });
}

/* --- AI Mastering --- */
function buildMasteringExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Upload a track for AI-powered mastering analysis</p>
        </div>
        <div style="width:100%;max-width:600px;">
            <div style="background:rgba(255,255,255,0.03);border:2px dashed rgba(212,160,23,0.3);border-radius:16px;padding:32px;text-align:center;margin-bottom:16px;cursor:pointer;" onclick="document.getElementById('masterFile').click()" id="masterDropZone">
                <div style="font-size:2.5rem;margin-bottom:8px;">🎚️</div>
                <div style="font-family:'Playfair Display',serif;font-size:1.1rem;color:#FFE082;margin-bottom:4px;">Drop your track here</div>
                <div style="font-size:0.75rem;color:#8A7A5A;">MP3, WAV, M4A, FLAC</div>
                <input type="file" id="masterFile" accept="audio/*" style="display:none" onchange="uploadForMastering(this)">
            </div>
            <div id="masterStatus" style="display:none;text-align:center;padding:16px;">
                <div style="font-size:0.85rem;color:#D4A017;" id="masterMsg">Analyzing...</div>
                <div style="width:100%;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:12px;overflow:hidden;">
                    <div id="masterBar" style="width:0%;height:100%;background:linear-gradient(90deg,#D4A017,#FFE082);border-radius:2px;transition:width 0.5s ease;"></div>
                </div>
            </div>
            <div id="masterResults" style="display:none;"></div>
        </div>`;
}

function uploadForMastering(input) {
    var file = input.files[0];
    if (!file) return;
    var dropZone = document.getElementById('masterDropZone');
    var status = document.getElementById('masterStatus');
    var results = document.getElementById('masterResults');
    var msg = document.getElementById('masterMsg');
    var bar = document.getElementById('masterBar');
    dropZone.style.display = 'none';
    status.style.display = 'block';
    results.style.display = 'none';
    msg.textContent = 'Analyzing "' + file.name + '" in browser...';
    bar.style.width = '10%';

    // Phase 1: Client-side analysis with Essentia.js (instant BPM + key)
    var localResults = {};
    analyzeAudioLocal(file).then(function(local) {
        localResults = local;
        msg.textContent = 'BPM: ' + (local.bpm || '?') + ' | Key: ' + (local.key || '?') + ' — Uploading for deep analysis...';
        bar.style.width = '40%';
    }).catch(function() {
        msg.textContent = 'Uploading for server analysis...';
        bar.style.width = '30%';
    }).finally(function() {
        // Phase 2: Upload to server for LUFS + AI recommendations
        var formData = new FormData();
        formData.append('file', file);
        setTimeout(function(){ msg.textContent = 'Running AI mastering analysis...'; bar.style.width = '60%'; }, 1500);
        setTimeout(function(){ msg.textContent = 'Generating recommendations...'; bar.style.width = '80%'; }, 4000);
        fetch('/api/analyze', { method: 'POST', body: formData })
        .then(function(r){ return r.json(); })
        .then(function(data){
            bar.style.width = '100%';
            if (data.error) { msg.textContent = 'Error: ' + data.error; msg.style.color = '#C41E3A'; return; }
            // Merge: prefer client-side BPM/key if server didn't detect
            var bpm = data.bpm || localResults.bpm || '—';
            var key = data.key || localResults.key || '—';
            var bpmSource = localResults.bpm ? ' (Essentia.js)' : '';
            var keySource = localResults.key ? ' (Essentia.js)' : '';
            status.style.display = 'none';
            results.style.display = 'block';
            var recs = (data.recommendations || []).map(function(r){ return '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;"><span style="color:#D4A017;">&#9679;</span><span style="font-size:0.8rem;color:#E0C8A0;">' + r + '</span></div>'; }).join('');
            var scoreColor = data.quality_score >= 70 ? '#4CAF50' : (data.quality_score >= 40 ? '#D4A017' : '#C41E3A');
            results.innerHTML =
                '<div style="text-align:center;margin-bottom:16px;">' +
                    '<span style="font-family:Playfair Display,serif;font-size:1.2rem;color:#FFE082;">Analysis: ' + (data.filename || file.name) + '</span>' +
                    (data.genre_detected ? '<div style="font-size:0.65rem;color:#8A7A5A;margin-top:4px;">Detected genre: ' + data.genre_detected + '</div>' : '') +
                '</div>' +
                '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;">' +
                    buildAnalysisCard('BPM', bpm, 'Tempo' + bpmSource) +
                    buildAnalysisCard('Key', key, (data.camelot ? 'Camelot: ' + data.camelot : '') + keySource) +
                    buildAnalysisCard('LUFS', data.lufs || '—', 'Integrated loudness') +
                    buildAnalysisCard('True Peak', (data.true_peak || '—') + ' dB', data.dynamic_range ? 'DR: ' + data.dynamic_range + ' dB' : '') +
                '</div>' +
                (localResults.duration ? '<div style="text-align:center;font-size:0.7rem;color:#8A7A5A;margin-bottom:12px;">Duration: ' + Math.floor(localResults.duration/60) + ':' + ('0' + (localResults.duration%60)).slice(-2) + (localResults.bpm_confidence ? ' | BPM confidence: ' + localResults.bpm_confidence + '%' : '') + (localResults.key_strength ? ' | Key strength: ' + localResults.key_strength + '%' : '') + '</div>' : '') +
                (data.quality_score ? '<div style="text-align:center;margin-bottom:16px;"><div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:1px;color:#8A7A5A;margin-bottom:6px;">Quality Score</div><div style="display:inline-flex;width:60px;height:60px;border-radius:50%;border:3px solid ' + scoreColor + ';align-items:center;justify-content:center;"><span style="font-family:Playfair Display,serif;font-size:1.3rem;font-weight:700;color:#FFE082;">' + data.quality_score + '</span></div></div>' : '') +
                (recs ? '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;margin-bottom:16px;"><div style="font-family:Playfair Display,serif;font-size:0.9rem;color:#FFE082;margin-bottom:12px;">Mastering Recommendations</div>' + recs + '</div>' : '') +
                '<div style="text-align:center;margin-top:16px;"><button class="btn-primary" onclick="resetMastering()" style="font-size:0.8rem;padding:10px 24px;">Analyze Another Track</button></div>';
        })
        .catch(function(err){ bar.style.width = '100%'; msg.textContent = 'Upload failed: ' + err.message; msg.style.color = '#C41E3A'; });
    });
}

function resetMastering() {
    document.getElementById('masterDropZone').style.display = '';
    document.getElementById('masterStatus').style.display = 'none';
    document.getElementById('masterResults').style.display = 'none';
    document.getElementById('masterFile').value = '';
}

/* --- Music Discovery --- */
function buildDiscoveryExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Pick a mood. Get AI-curated recommendations.</p>
        </div>
        <div class="mood-grid">
            <div class="mood-btn" onclick="showMoodTracks(this, 'release')">
                <span class="mood-emoji">🌊</span>Release
            </div>
            <div class="mood-btn" onclick="showMoodTracks(this, 'focus')">
                <span class="mood-emoji">🎯</span>Focus
            </div>
            <div class="mood-btn" onclick="showMoodTracks(this, 'decompress')">
                <span class="mood-emoji">🌿</span>Decompress
            </div>
            <div class="mood-btn" onclick="showMoodTracks(this, 'brotherhood')">
                <span class="mood-emoji">🤝</span>Brotherhood
            </div>
        </div>
        <div class="track-results" id="trackResults"></div>`;
}

var MOOD_TRACKS = {
    release: [
        { title: 'Opus', artist: 'Eric Prydz', bpm: 126, key: 'Dm', reason: 'Euphoric build-and-release energy' },
        { title: 'Strobe', artist: 'deadmau5', bpm: 128, key: 'Fm', reason: 'Progressive journey that lets go' },
        { title: 'Innerbloom', artist: 'RUFUS DU SOL', bpm: 120, key: 'Cm', reason: 'Deep emotional release' },
        { title: 'Catching Flies', artist: 'Catching Flies', bpm: 116, key: 'Am', reason: 'Gentle unwinding groove' },
        { title: 'Midnight City', artist: 'M83', bpm: 105, key: 'Abm', reason: 'Anthemic atmospheric wash' },
        { title: 'Sun & Moon', artist: 'Above & Beyond', bpm: 138, key: 'Bbm', reason: 'Trance-tinged emotional peak' }
    ],
    focus: [
        { title: 'Testarossa', artist: 'Yotto', bpm: 122, key: 'Gm', reason: 'Driving melodic focus' },
        { title: 'Northern Soul', artist: 'Above & Beyond', bpm: 132, key: 'Ebm', reason: 'Locked-in progressive energy' },
        { title: 'Cola', artist: 'CamelPhat & Elderbrook', bpm: 124, key: 'Am', reason: 'Hypnotic vocal loop' },
        { title: 'All Night', artist: 'Parov Stelar', bpm: 126, key: 'Bbm', reason: 'Electro swing momentum' },
        { title: 'Revolver', artist: 'Klangkarussell', bpm: 123, key: 'Cm', reason: 'Steady groove, zero distractions' },
        { title: 'Rush', artist: 'Tinlicker', bpm: 128, key: 'Dm', reason: 'Clean progressive drive' }
    ],
    decompress: [
        { title: 'Sais', artist: 'Solomun', bpm: 118, key: 'Cm', reason: 'Deep introspective groove' },
        { title: 'Time', artist: 'Ben Bohmer', bpm: 120, key: 'Abm', reason: 'Gentle melodic unwinding' },
        { title: 'Cherry Blossom', artist: 'Lane 8', bpm: 119, key: 'Em', reason: 'Soft textured warmth' },
        { title: 'Sirens', artist: 'Kidnap', bpm: 122, key: 'Fm', reason: 'Downtempo emotional space' },
        { title: 'Petit Biscuit', artist: 'Sunset Lover', bpm: 100, key: 'Gb', reason: 'Ambient chill perfection' },
        { title: 'Tycho', artist: 'Awake', bpm: 112, key: 'A', reason: 'Warm analog decompression' }
    ],
    brotherhood: [
        { title: 'The Nights', artist: 'Avicii', bpm: 126, key: 'Dm', reason: 'Anthem for the crew' },
        { title: "Don't You Worry Child", artist: 'Swedish House Mafia', bpm: 128, key: 'Gm', reason: 'Festival brotherhood energy' },
        { title: 'Alive', artist: 'Krewella', bpm: 128, key: 'Am', reason: 'We-are-in-this-together vibes' },
        { title: 'Levels', artist: 'Avicii', bpm: 126, key: 'Cm', reason: 'Universal hands-up moment' },
        { title: 'One More Time', artist: 'Daft Punk', bpm: 123, key: 'Bbm', reason: 'Timeless celebration' },
        { title: 'Lean On', artist: 'Major Lazer', bpm: 98, key: 'Gm', reason: 'Global unity groove' }
    ]
};

var MOOD_EMOJIS = ['🎵', '🎶', '🎧', '💫', '🌊', '🔥'];

function showMoodTracks(btn, mood) {
    document.querySelectorAll('.mood-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    var container = document.getElementById('trackResults');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#D4A017;font-size:0.85rem;">AI is curating tracks + finding links on Spotify & Tidal...</div>';
    container.classList.add('visible');

    fetch('/api/recommendations?mood=' + encodeURIComponent(mood) + '&limit=8')
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.tracks && data.tracks.length > 0) {
            renderDiscoveryTracks(container, data.tracks, true);
        } else {
            return fetch('/api/discovery', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({mood: mood})
            }).then(function(r) { return r.json(); }).then(function(d) {
                if (d.tracks && d.tracks.length > 0) {
                    renderDiscoveryTracks(container, d.tracks, true);
                } else {
                    renderDiscoveryTracks(container, MOOD_TRACKS[mood] || [], false);
                }
            });
        }
    })
    .catch(function() {
        renderDiscoveryTracks(container, MOOD_TRACKS[mood] || [], false);
    });
}

function renderDiscoveryTracks(container, tracks, isAI) {
    var badge = isAI
        ? '<div style="text-align:center;margin-bottom:12px;"><span style="font-size:0.6rem;background:rgba(212,160,23,0.15);color:#D4A017;padding:4px 10px;border-radius:8px;letter-spacing:1px;text-transform:uppercase;">AI Generated</span></div>'
        : '';
    container.innerHTML = badge + tracks.map(function(t, i) {
        var platforms = [];
        if (t.spotify && t.spotify.url) platforms.push('<a href="' + t.spotify.url + '" target="_blank" style="color:#1DB954;font-size:0.6rem;text-decoration:none;background:rgba(29,185,84,0.15);padding:2px 6px;border-radius:4px;">Spotify</a>');
        if (t.tidal && t.tidal.url) platforms.push('<a href="' + t.tidal.url + '" target="_blank" style="color:#00BFFF;font-size:0.6rem;text-decoration:none;background:rgba(0,191,255,0.1);padding:2px 6px;border-radius:4px;">Tidal</a>');
        var art = (t.spotify && t.spotify.album_art) ? '<img src="' + t.spotify.album_art + '" style="width:40px;height:40px;border-radius:6px;">' : '<div class="track-art">' + MOOD_EMOJIS[i % MOOD_EMOJIS.length] + '</div>';
        return '<div class="track-card">' +
            art +
            '<div class="track-info">' +
                '<div class="ti-name">' + (t.title || t.name || 'Unknown') + '</div>' +
                '<div class="ti-artist">' + (t.artist || 'Unknown') + '</div>' +
                (t.reason ? '<div style="font-size:0.65rem;color:#8A7A5A;margin-top:2px;font-style:italic;">' + t.reason + '</div>' : '') +
                (platforms.length ? '<div style="display:flex;gap:4px;margin-top:3px;">' + platforms.join('') + '</div>' : '') +
            '</div>' +
            '<div class="track-meta">' +
                '<div class="tm-bpm">' + (t.bpm || '?') + ' BPM</div>' +
                '<div>' + (t.key || '?') + '</div>' +
                '<div onclick="event.stopPropagation();shareTrackToCrew(\'' + encodeURIComponent(t.title || t.name || '') + '\',\'' + encodeURIComponent(t.artist || '') + '\')" style="margin-top:4px;cursor:pointer;font-size:0.6rem;color:#D4A017;background:rgba(212,160,23,0.1);padding:2px 8px;border-radius:6px;text-align:center;">📤 Share</div>' +
            '</div>' +
        '</div>';
    }).join('');
    container.classList.add('visible');
}

/* --- AI Generation --- */
function buildGenerationExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Pick a genre or write your own prompt. Generate real audio with AI.</p>
        </div>
        <div class="genre-grid">
            <div class="genre-btn" onclick="generateBeat(this, 'progressive')">🌊 Progressive House</div>
            <div class="genre-btn" onclick="generateBeat(this, 'techno')">⚡ Techno</div>
            <div class="genre-btn" onclick="generateBeat(this, 'deephouse')">🎧 Deep House</div>
            <div class="genre-btn" onclick="generateBeat(this, 'ambient')">🌙 Ambient</div>
        </div>
        <div style="width:100%;max-width:500px;margin-top:16px;">
            <div style="font-size:0.75rem;color:rgba(255,255,255,0.4);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">Custom Prompt</div>
            <div style="display:flex;gap:8px;">
                <input type="text" id="genPrompt" placeholder="melodic techno with driving bassline, 130 BPM" style="flex:1;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-family:inherit;font-size:0.85rem;">
                <select id="genDuration" style="padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-family:inherit;font-size:0.8rem;">
                    <option value="2">2s</option>
                    <option value="4" selected>4s</option>
                    <option value="8">8s</option>
                    <option value="15">15s</option>
                </select>
                <button onclick="generateAudio()" style="padding:10px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#D4A017,#B8860B);color:#0D0D1A;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap;">Generate</button>
            </div>
        </div>
        <div class="gen-result" id="genResult"></div>
        <div id="genAudioResult" style="display:none;margin-top:16px;width:100%;max-width:500px;"></div>`;
}

var GEN_DATA = {
    progressive: { bpm: 128, key: 'Am', bars: 32, name: 'Progressive House Beat' },
    techno: { bpm: 134, key: 'Dm', bars: 16, name: 'Techno Loop' },
    deephouse: { bpm: 122, key: 'Fm', bars: 32, name: 'Deep House Groove' },
    ambient: { bpm: 90, key: 'Cm', bars: 64, name: 'Ambient Texture' }
};

function generateBeat(btn, genre) {
    document.querySelectorAll('.genre-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    var fallback = GEN_DATA[genre];
    var container = document.getElementById('genResult');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#D4A017;font-size:0.85rem;">Generating with AI...</div>';
    container.classList.add('visible');

    fetch('/api/generate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({genre: genre, bpm: fallback.bpm, key: fallback.key})
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.error) throw new Error(data.error);
        renderGenResult(container, data, true);
    })
    .catch(function() {
        renderGenResult(container, fallback, false);
    });
}

function renderGenResult(container, d, isAI) {
    var badge = isAI
        ? '<div style="text-align:center;margin-bottom:8px;"><span style="font-size:0.6rem;background:rgba(212,160,23,0.15);color:#D4A017;padding:4px 10px;border-radius:8px;letter-spacing:1px;text-transform:uppercase;">AI Generated</span></div>'
        : '';
    var descHtml = d.description
        ? '<div style="font-size:0.78rem;color:#E0C8A0;line-height:1.5;margin-top:12px;padding:10px;background:rgba(255,255,255,0.02);border-radius:10px;">' + d.description + '</div>'
        : '';
    var structHtml = d.structure
        ? '<div style="font-size:0.7rem;color:#8A7A5A;margin-top:8px;text-align:center;">' + d.structure + '</div>'
        : '';
    container.innerHTML =
        '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:16px;">' +
            badge +
            '<div style="text-align:center;margin-bottom:8px;">' +
                '<span style="font-family:\'Playfair Display\',serif;font-size:1.1rem;font-weight:700;color:#FFE082;">' + (d.name || 'Generated Beat') + '</span>' +
            '</div>' +
            '<div class="waveform-placeholder"></div>' +
            '<div class="gen-details">' +
                '<div class="gen-detail-item">' +
                    '<div class="gd-label">BPM</div>' +
                    '<div class="gd-value">' + d.bpm + '</div>' +
                '</div>' +
                '<div class="gen-detail-item">' +
                    '<div class="gd-label">Key</div>' +
                    '<div class="gd-value">' + d.key + '</div>' +
                '</div>' +
                '<div class="gen-detail-item">' +
                    '<div class="gd-label">Bars</div>' +
                    '<div class="gd-value">' + d.bars + '</div>' +
                '</div>' +
            '</div>' +
            structHtml +
            descHtml +
        '</div>';
    container.classList.add('visible');
}

function generateAudio() {
    var prompt = (document.getElementById('genPrompt').value || '').trim();
    if (!prompt) { showToast('Enter a prompt first', true); return; }
    var duration = parseInt(document.getElementById('genDuration').value) || 8;
    var container = document.getElementById('genAudioResult');
    container.style.display = 'block';
    container.innerHTML =
        '<div style="text-align:center;padding:20px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;">' +
            '<div style="font-size:0.85rem;color:#D4A017;margin-bottom:8px;">Generating ' + duration + 's of audio...</div>' +
            '<div style="font-size:0.7rem;color:rgba(255,255,255,0.4);">This can take 30-60 seconds. MusicGen is working.</div>' +
            '<div style="width:100%;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:12px;overflow:hidden;">' +
                '<div style="width:30%;height:100%;background:linear-gradient(90deg,#D4A017,#FFE082);border-radius:2px;animation:genPulse 2s ease-in-out infinite;"></div>' +
            '</div>' +
        '</div>';

    fetch('/api/generate/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt, duration: duration })
    })
    .then(function(r) {
        if (!r.ok) {
            return r.json().then(function(d) { throw new Error(d.detail || d.error || 'HTTP ' + r.status); });
        }
        return r.json();
    })
    .then(function(data) {
        if (data.error) {
            container.innerHTML = '<div style="text-align:center;padding:16px;color:#EF4444;font-size:0.85rem;">' + data.error + '</div>';
            return;
        }
        container.innerHTML =
            '<div style="background:rgba(212,160,23,0.06);border:1px solid rgba(212,160,23,0.2);border-radius:14px;padding:20px;text-align:center;">' +
                '<div style="font-family:\'Playfair Display\',serif;font-size:1rem;color:#FFE082;margin-bottom:4px;">Audio Generated</div>' +
                '<div style="font-size:0.75rem;color:rgba(255,255,255,0.4);margin-bottom:12px;">' + data.duration + 's | ' + (data.model || 'AI') + '</div>' +
                '<audio controls style="width:100%;margin-bottom:12px;border-radius:8px;" src="' + data.audio_url + '"></audio>' +
                '<div style="font-size:0.7rem;color:rgba(255,255,255,0.3);margin-bottom:10px;word-break:break-all;">"' + (data.prompt || prompt) + '"</div>' +
                (data.audio_url.indexOf('data:') === 0 ? '' : '<a href="' + data.audio_url + '" download="generated_audio.wav" style="display:inline-block;padding:8px 20px;background:linear-gradient(135deg,#D4A017,#B8860B);color:#0D0D1A;border-radius:8px;text-decoration:none;font-weight:800;font-size:0.8rem;">Download</a>') +
            '</div>';
    })
    .catch(function(err) {
        container.innerHTML = '<div style="text-align:center;padding:16px;color:#EF4444;font-size:0.85rem;">Failed: ' + err.message + '</div>';
    });
}

/* --- Stem Separation --- */
function buildStemsExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Upload a track. Get vocals, drums, bass, and other stems.</p>
        </div>
        <div style="width:100%;max-width:600px;">
            <div style="background:rgba(255,255,255,0.03);border:2px dashed rgba(212,160,23,0.3);border-radius:16px;padding:32px;text-align:center;margin-bottom:16px;cursor:pointer;" onclick="document.getElementById('stemFile').click()" id="stemDropZone">
                <div style="font-size:2.5rem;margin-bottom:8px;">🔀</div>
                <div style="font-family:'Playfair Display',serif;font-size:1.1rem;color:#FFE082;margin-bottom:4px;">Drop your track here</div>
                <div style="font-size:0.75rem;color:#8A7A5A;">MP3, WAV, M4A, FLAC — powered by Demucs AI</div>
                <input type="file" id="stemFile" accept="audio/*" style="display:none" onchange="uploadForStems(this)">
            </div>
            <div id="stemStatus" style="display:none;text-align:center;padding:16px;">
                <div style="font-size:0.85rem;color:#D4A017;" id="stemMsg">Processing...</div>
                <div style="width:100%;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:12px;overflow:hidden;">
                    <div id="stemBar" style="width:0%;height:100%;background:linear-gradient(90deg,#D4A017,#FFE082);border-radius:2px;transition:width 0.5s ease;"></div>
                </div>
            </div>
            <div id="stemResults" style="display:none;"></div>
        </div>`;
}

function uploadForStems(input) {
    var file = input.files[0];
    if (!file) return;
    var dropZone = document.getElementById('stemDropZone');
    var status = document.getElementById('stemStatus');
    var results = document.getElementById('stemResults');
    var msg = document.getElementById('stemMsg');
    var bar = document.getElementById('stemBar');
    dropZone.style.display = 'none';
    status.style.display = 'block';
    results.style.display = 'none';
    msg.textContent = 'Uploading "' + file.name + '"...';
    bar.style.width = '10%';
    var formData = new FormData();
    formData.append('file', file);
    setTimeout(function(){ msg.textContent = 'Sending to Demucs AI...'; bar.style.width = '25%'; }, 2000);
    setTimeout(function(){ msg.textContent = 'Separating stems (this can take 1-3 minutes)...'; bar.style.width = '40%'; }, 5000);
    setTimeout(function(){ bar.style.width = '55%'; }, 15000);
    setTimeout(function(){ bar.style.width = '70%'; }, 30000);
    setTimeout(function(){ msg.textContent = 'Almost there...'; bar.style.width = '85%'; }, 60000);
    fetch('/api/stems', { method: 'POST', body: formData })
    .then(function(r){ return r.json(); })
    .then(function(data){
        bar.style.width = '100%';
        if (data.error) { msg.textContent = 'Error: ' + data.error; msg.style.color = '#C41E3A'; return; }
        status.style.display = 'none';
        results.style.display = 'block';
        var stemItems = [
            { label: 'Vocals', icon: '🎤', url: data.vocals_url },
            { label: 'Drums', icon: '🥁', url: data.drums_url },
            { label: 'Bass', icon: '🎸', url: data.bass_url },
            { label: 'Other', icon: '🎹', url: data.other_url }
        ];
        results.innerHTML =
            '<div style="text-align:center;margin-bottom:16px;">' +
                '<span style="font-family:Playfair Display,serif;font-size:1.2rem;color:#FFE082;">Stems Ready: ' + (data.filename || file.name) + '</span>' +
                '<div style="font-size:0.65rem;color:#8A7A5A;margin-top:4px;">4 stems separated via Demucs AI</div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;">' +
            stemItems.map(function(s){
                return '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;text-align:center;">' +
                    '<div style="font-size:1.8rem;margin-bottom:6px;">' + s.icon + '</div>' +
                    '<div style="font-family:Playfair Display,serif;font-size:1rem;color:#FFE082;margin-bottom:8px;">' + s.label + '</div>' +
                    (s.url ? '<a href="' + s.url + '" target="_blank" download style="display:inline-block;padding:8px 16px;border-radius:10px;background:linear-gradient(135deg,#D4A017,#B8860B);color:#0D0D1A;font-weight:800;font-size:0.75rem;text-decoration:none;font-family:Nunito,sans-serif;">Download</a>' :
                    '<span style="font-size:0.7rem;color:#6A6A7A;">Not available</span>') +
                '</div>';
            }).join('') +
            '</div>' +
            '<div style="text-align:center;margin-top:16px;"><button class="btn-primary" onclick="resetStems()" style="font-size:0.8rem;padding:10px 24px;">Separate Another Track</button></div>';
    })
    .catch(function(err){ bar.style.width = '100%'; msg.textContent = 'Upload failed: ' + err.message; msg.style.color = '#C41E3A'; });
}

function resetStems() {
    document.getElementById('stemDropZone').style.display = '';
    document.getElementById('stemStatus').style.display = 'none';
    document.getElementById('stemResults').style.display = 'none';
    document.getElementById('stemFile').value = '';
}

/* --- Live ID (mic-based track identification) --- */
function buildShazamExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>Live ID</h2>
            <p>Hold your phone up to the speaker. We'll identify the track.</p>
        </div>
        <div style="width:100%;max-width:500px;">
            <div id="shazamDrop" style="text-align:center;">
                <button id="listenBtn" onclick="startListening()" style="width:140px;height:140px;border-radius:50%;border:3px solid rgba(212,160,23,0.4);background:rgba(212,160,23,0.08);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0 auto 16px;transition:all 0.3s;">
                    <div style="font-size:3rem;">🎧</div>
                    <div style="font-size:0.75rem;font-weight:700;color:#FFE082;margin-top:4px;">TAP TO LISTEN</div>
                </button>
                <div style="font-size:0.7rem;color:#8A7A5A;">Listens for ~10 seconds, then identifies the track</div>
            </div>
            <div id="shazamListening" style="display:none;text-align:center;">
                <div id="listenCircle" style="width:140px;height:140px;border-radius:50%;border:3px solid #D4A017;background:rgba(212,160,23,0.15);margin:0 auto 16px;display:flex;flex-direction:column;align-items:center;justify-content:center;animation:pulseGlow 1.5s ease-in-out infinite;">
                    <div style="font-size:3rem;">🎵</div>
                    <div style="font-size:0.75rem;font-weight:700;color:#FFE082;" id="listenTimer">10</div>
                </div>
                <div style="font-size:0.85rem;color:#D4A017;font-weight:700;">Listening...</div>
                <button onclick="stopListening()" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#8A7A5A;cursor:pointer;font-size:0.75rem;">Cancel</button>
            </div>
            <div id="shazamStatus" style="display:none;text-align:center;padding:20px;">
                <div style="font-size:0.85rem;color:#D4A017;" id="shazamMsg">Identifying...</div>
                <div style="width:100%;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:12px;overflow:hidden;">
                    <div id="shazamBar" style="width:0%;height:100%;background:linear-gradient(90deg,#D4A017,#FFE082);border-radius:2px;transition:width 0.5s ease;"></div>
                </div>
            </div>
            <div id="shazamResult" style="display:none;"></div>
        </div>`;
}

var _listenStream = null;
var _listenRecorder = null;
var _listenTimer = null;
var _listenChunks = [];

function startListening() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Microphone not supported on this device');
        return;
    }
    var dropEl = document.getElementById('shazamDrop');
    var listenEl = document.getElementById('shazamListening');
    dropEl.style.display = 'none';
    listenEl.style.display = 'block';
    _listenChunks = [];

    var countdown = 10;
    var timerEl = document.getElementById('listenTimer');
    timerEl.textContent = countdown;
    _listenTimer = setInterval(function() {
        countdown--;
        timerEl.textContent = countdown;
        if (countdown <= 0) stopListening();
    }, 1000);

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
        _listenStream = stream;
        // Try webm first, fall back to mp4
        var mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/mp4';
            if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';
        }
        var options = mimeType ? { mimeType: mimeType } : {};
        _listenRecorder = new MediaRecorder(stream, options);
        _listenRecorder.ondataavailable = function(e) {
            if (e.data.size > 0) _listenChunks.push(e.data);
        };
        _listenRecorder.onstop = function() {
            submitListening();
        };
        _listenRecorder.start();
    }).catch(function(err) {
        showToast('Mic access denied: ' + err.message);
        resetShazam();
    });
}

function stopListening() {
    if (_listenTimer) { clearInterval(_listenTimer); _listenTimer = null; }
    if (_listenRecorder && _listenRecorder.state === 'recording') {
        _listenRecorder.stop();
    }
    if (_listenStream) {
        _listenStream.getTracks().forEach(function(t) { t.stop(); });
        _listenStream = null;
    }
}

function submitListening() {
    var listenEl = document.getElementById('shazamListening');
    var status = document.getElementById('shazamStatus');
    var msg = document.getElementById('shazamMsg');
    var bar = document.getElementById('shazamBar');

    if (_listenChunks.length === 0) {
        showToast('No audio captured');
        resetShazam();
        return;
    }

    listenEl.style.display = 'none';
    status.style.display = 'block';
    msg.textContent = 'Identifying track...';
    msg.style.color = '#D4A017';
    bar.style.width = '40%';

    var blob = new Blob(_listenChunks, { type: _listenChunks[0].type || 'audio/webm' });
    var ext = (blob.type || '').indexOf('mp4') !== -1 ? 'mp4' : 'webm';
    var formData = new FormData();
    formData.append('file', blob, 'mic_capture.' + ext);

    setTimeout(function() { msg.textContent = 'AI is analyzing...'; bar.style.width = '70%'; }, 2000);

    fetch('/api/shazam', { method: 'POST', body: formData })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        bar.style.width = '100%';
        if (data.error) {
            msg.textContent = 'Error: ' + data.error;
            msg.style.color = '#EF4444';
            setTimeout(resetShazam, 3000);
            return;
        }
        status.style.display = 'none';
        var r = data.result || {};
        var conf = r.confidence || 'low';
        var confColor = conf === 'high' ? '#10B981' : conf === 'medium' ? '#F59E0B' : '#EF4444';
        var result = document.getElementById('shazamResult');

        // Auto-add to music profile
        if (r.title && r.title !== 'Unknown' && typeof addTracksToSaved === 'function') {
            addTracksToSaved([{ name: r.title, artist: r.artist || '', source: 'live_id' }]);
        }

        result.style.display = 'block';
        result.innerHTML =
            '<div style="background:rgba(212,160,23,0.06);border:1px solid rgba(212,160,23,0.2);border-radius:16px;padding:24px;text-align:center;">' +
                '<div style="font-size:2rem;margin-bottom:8px;">🎯</div>' +
                '<div style="font-family:\'Playfair Display\',serif;font-size:1.3rem;color:#FFE082;margin-bottom:4px;">' + (r.title || 'Unknown') + '</div>' +
                '<div style="font-size:0.95rem;color:rgba(255,255,255,0.7);margin-bottom:12px;">' + (r.artist || 'Unknown Artist') + '</div>' +
                (r.album ? '<div style="font-size:0.8rem;color:rgba(255,255,255,0.4);margin-bottom:4px;">Album: ' + r.album + '</div>' : '') +
                (r.year ? '<div style="font-size:0.8rem;color:rgba(255,255,255,0.4);margin-bottom:4px;">Year: ' + r.year + '</div>' : '') +
                (r.genre ? '<div style="font-size:0.8rem;color:rgba(255,255,255,0.4);margin-bottom:8px;">Genre: ' + r.genre + '</div>' : '') +
                '<div style="display:inline-block;font-size:0.7rem;font-weight:700;padding:4px 12px;border-radius:12px;background:rgba(0,0,0,0.3);color:' + confColor + ';border:1px solid ' + confColor + ';">' + conf.toUpperCase() + ' MATCH</div>' +
            '</div>' +
            '<div style="text-align:center;margin-top:16px;">' +
                '<button onclick="resetShazam()" style="padding:10px 24px;border-radius:12px;border:none;background:linear-gradient(135deg,#D4A017,#B8860B);color:#0D0D1A;font-weight:800;cursor:pointer;font-family:inherit;font-size:0.85rem;">Listen Again</button>' +
            '</div>';
    })
    .catch(function(err) {
        bar.style.width = '100%';
        msg.textContent = 'Failed: ' + err.message;
        msg.style.color = '#EF4444';
        setTimeout(resetShazam, 3000);
    });
}

/* shazamUpload removed — Live ID uses microphone now */

function resetShazam() {
    // Stop any active recording
    if (_listenTimer) { clearInterval(_listenTimer); _listenTimer = null; }
    if (_listenStream) { _listenStream.getTracks().forEach(function(t) { t.stop(); }); _listenStream = null; }
    _listenRecorder = null;
    _listenChunks = [];
    var drop = document.getElementById('shazamDrop');
    var listenEl = document.getElementById('shazamListening');
    var status = document.getElementById('shazamStatus');
    var result = document.getElementById('shazamResult');
    if (drop) drop.style.display = 'block';
    if (listenEl) listenEl.style.display = 'none';
    if (status) status.style.display = 'none';
    if (result) result.style.display = 'none';
}

/* --- Mix Digestor --- */
function buildDigestorExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Upload a mix or paste a link. Get the full tracklist.</p>
        </div>
        <div style="width:100%;max-width:600px;">
            <div style="display:flex;gap:0;margin-bottom:16px;background:rgba(255,255,255,0.03);border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">
                <button id="digestTabUpload" onclick="switchDigestTab('upload')" style="flex:1;padding:12px;border:none;background:rgba(212,160,23,0.15);color:#D4A017;font-family:'Nunito',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;transition:all 0.3s;">Upload a Mix</button>
                <button id="digestTabUrl" onclick="switchDigestTab('url')" style="flex:1;padding:12px;border:none;background:transparent;color:#666;font-family:'Nunito',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;transition:all 0.3s;">Paste a Link</button>
            </div>
            <div id="digestUploadPane">
                <div style="background:rgba(255,255,255,0.03);border:2px dashed rgba(212,160,23,0.3);border-radius:16px;padding:32px;text-align:center;margin-bottom:16px;cursor:pointer;" onclick="document.getElementById('mixFile').click()" id="dropZone">
                    <div style="font-size:2.5rem;margin-bottom:8px;">🔬</div>
                    <div style="font-family:'Playfair Display',serif;font-size:1.1rem;color:#FFE082;margin-bottom:4px;">Drop your mix here</div>
                    <div style="font-size:0.75rem;color:#8A7A5A;">MP3, WAV, M4A, FLAC — up to 500MB</div>
                    <input type="file" id="mixFile" accept="audio/*" style="display:none" onchange="uploadMix(this)">
                </div>
            </div>
            <div id="digestUrlPane" style="display:none;">
                <div style="background:rgba(212,160,23,0.06);border:1px solid rgba(212,160,23,0.2);border-radius:16px;padding:24px;text-align:center;margin-bottom:16px;">
                    <div style="font-size:2rem;margin-bottom:8px;">🔗</div>
                    <div style="font-family:'Playfair Display',serif;font-size:1rem;color:#FFE082;margin-bottom:4px;">Paste a set URL</div>
                    <div style="font-size:0.7rem;color:#8A7A5A;margin-bottom:12px;">YouTube, SoundCloud, or Mixcloud</div>
                    <div style="display:flex;gap:8px;">
                        <input type="text" id="digestUrlInput" placeholder="https://youtube.com/watch?v=..." style="flex:1;padding:10px 14px;border-radius:10px;border:1px solid #333;background:#1a1a2e;color:#fff;font-family:'Nunito',sans-serif;font-size:0.85rem;" onkeydown="if(event.key==='Enter')digestUrl()">
                        <button onclick="digestUrl()" style="padding:10px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#D4A017,#B8860B);color:#0D0D1A;font-weight:800;cursor:pointer;font-family:'Nunito',sans-serif;">Digest</button>
                        <button onclick="downloadAudioStep3()" style="padding:10px 14px;border-radius:10px;border:1px solid rgba(212,160,23,0.4);background:transparent;color:#D4A017;font-weight:700;cursor:pointer;font-family:'Nunito',sans-serif;font-size:0.75rem;white-space:nowrap;">MP3</button>
                    </div>
                    <div style="display:flex;gap:6px;justify-content:center;margin-top:10px;">
                        <span style="font-size:0.6rem;background:rgba(255,0,0,0.15);color:#FF4444;padding:3px 8px;border-radius:6px;">YouTube</span>
                        <span style="font-size:0.6rem;background:rgba(255,85,0,0.15);color:#FF5500;padding:3px 8px;border-radius:6px;">SoundCloud</span>
                        <span style="font-size:0.6rem;background:rgba(124,58,237,0.15);color:#7C3AED;padding:3px 8px;border-radius:6px;">Mixcloud</span>
                    </div>
                </div>
            </div>
            <div id="digestorStatus" style="display:none;text-align:center;padding:16px;">
                <div style="font-size:0.85rem;color:#D4A017;" id="digestorMsg">Processing...</div>
                <div style="width:100%;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:12px;overflow:hidden;">
                    <div id="digestorBar" style="width:0%;height:100%;background:linear-gradient(90deg,#D4A017,#FFE082);border-radius:2px;transition:width 0.5s ease;"></div>
                </div>
            </div>
            <div id="digestorMeta" style="display:none;"></div>
            <div id="digestorResults" style="display:none;"></div>
        </div>`;
}

function uploadMix(input) {
    var file = input.files[0];
    if (!file) return;
    var dropZone = document.getElementById('dropZone');
    var status = document.getElementById('digestorStatus');
    var results = document.getElementById('digestorResults');
    var meta = document.getElementById('digestorMeta');
    var msg = document.getElementById('digestorMsg');
    var bar = document.getElementById('digestorBar');
    dropZone.style.display = 'none';
    status.style.display = 'block';
    results.style.display = 'none';
    if (meta) { meta.style.display = 'none'; meta.innerHTML = ''; }
    msg.textContent = 'Uploading "' + file.name + '"...';
    bar.style.width = '20%';
    var formData = new FormData();
    formData.append('file', file);
    setTimeout(function() { msg.textContent = 'Scanning with AudD Enterprise...'; bar.style.width = '50%'; }, 2000);
    setTimeout(function() { msg.textContent = 'Fingerprinting audio segments...'; bar.style.width = '70%'; }, 8000);
    fetch('/api/digestor', { method: 'POST', body: formData })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        bar.style.width = '100%';
        if (data.error) { msg.textContent = 'Error: ' + data.error; msg.style.color = '#C41E3A'; return; }
        status.style.display = 'none';
        renderDigestResults(results, data, meta);
    })
    .catch(function(err) { bar.style.width = '100%'; msg.textContent = 'Upload failed: ' + err.message; msg.style.color = '#C41E3A'; });
}

function switchDigestTab(tab) {
    var uploadPane = document.getElementById('digestUploadPane');
    var urlPane = document.getElementById('digestUrlPane');
    var uploadTab = document.getElementById('digestTabUpload');
    var urlTab = document.getElementById('digestTabUrl');
    if (tab === 'upload') {
        uploadPane.style.display = 'block';
        urlPane.style.display = 'none';
        uploadTab.style.background = 'rgba(212,160,23,0.15)';
        uploadTab.style.color = '#D4A017';
        urlTab.style.background = 'transparent';
        urlTab.style.color = '#666';
    } else {
        uploadPane.style.display = 'none';
        urlPane.style.display = 'block';
        urlTab.style.background = 'rgba(212,160,23,0.15)';
        urlTab.style.color = '#D4A017';
        uploadTab.style.background = 'transparent';
        uploadTab.style.color = '#666';
    }
}

function renderDigestResults(container, data, metaContainer) {
    if (data.metadata && metaContainer) {
        var meta = data.metadata;
        var durStr = meta.duration ? formatDuration(meta.duration) : '';
        metaContainer.style.display = 'block';
        metaContainer.innerHTML =
            '<div style="display:flex;gap:12px;align-items:center;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:12px;margin-bottom:12px;">' +
            (meta.thumbnail ? '<img src="' + meta.thumbnail + '" style="width:80px;height:60px;border-radius:8px;object-fit:cover;">' : '') +
            '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:0.85rem;font-weight:700;color:#FFFEF7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (meta.title || 'Unknown') + '</div>' +
                '<div style="font-size:0.7rem;color:#8A7A5A;">' + (meta.uploader || '') + (durStr ? ' &bull; ' + durStr : '') + '</div>' +
            '</div></div>';
    }
    if (!data.tracks || data.tracks.length === 0) {
        container.style.display = 'block';
        container.innerHTML = '<div style="text-align:center;padding:16px;color:#C41E3A;font-size:0.85rem;">No tracks identified. Try a mix with more well-known tracks.</div>';
        return;
    }
    container.style.display = 'block';
    container.innerHTML =
        '<div style="text-align:center;margin-bottom:16px;">' +
            '<span style="font-family:\'Playfair Display\',serif;font-size:1.2rem;color:#FFE082;">' + data.unique_tracks + ' Tracks Identified</span>' +
            '<div style="font-size:0.65rem;color:#8A7A5A;margin-top:4px;">' + data.raw_matches + ' fingerprint matches processed</div>' +
        '</div>' +
        data.tracks.map(function(t) {
            return '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;margin-bottom:8px;">' +
                (t.album_art ? '<img src="' + t.album_art + '" style="width:48px;height:48px;border-radius:8px;">' : '<div style="width:48px;height:48px;border-radius:8px;background:rgba(212,160,23,0.1);display:flex;align-items:center;justify-content:center;">🎵</div>') +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-size:0.85rem;font-weight:700;color:#FFFEF7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + t.title + '</div>' +
                    '<div style="font-size:0.7rem;color:#8A7A5A;">' + t.artist + '</div>' +
                '</div>' +
                '<div style="text-align:right;flex-shrink:0;">' +
                    '<div style="font-size:0.8rem;color:#D4A017;font-weight:700;">' + t.timestamp + '</div>' +
                    '<div style="display:flex;gap:6px;margin-top:4px;">' +
                        (t.spotify_url ? '<a href="' + t.spotify_url + '" target="_blank" style="font-size:0.6rem;color:#1DB954;text-decoration:none;">Spotify</a>' : '') +
                        (t.apple_music_url ? '<a href="' + t.apple_music_url + '" target="_blank" style="font-size:0.6rem;color:#FC3C44;text-decoration:none;">Apple</a>' : '') +
                    '</div>' +
                '</div></div>';
        }).join('') +
        '<div style="text-align:center;margin-top:16px;">' +
            '<button class="btn-primary" onclick="resetDigestor()" style="font-size:0.8rem;padding:10px 24px;">Analyze Another</button>' +
        '</div>';

    // Auto-feed identified tracks into music profile
    if (typeof addTracksToSaved === 'function') {
        var profileTracks = data.tracks.map(function(t) { return { name: t.title, artist: t.artist, source: 'digestor' }; });
        var added = addTracksToSaved(profileTracks);
        if (added > 0) {
            showToast(added + ' track' + (added !== 1 ? 's' : '') + ' added to your music profile');
            // Trigger background profile rebuild
            if (typeof autoRebuildProfile === 'function') setTimeout(autoRebuildProfile, 1000);
        }
    }
}

function resetDigestor() {
    var dropZone = document.getElementById('dropZone');
    if (dropZone) dropZone.style.display = '';
    var status = document.getElementById('digestorStatus');
    if (status) status.style.display = 'none';
    var results = document.getElementById('digestorResults');
    if (results) { results.style.display = 'none'; results.innerHTML = ''; }
    var meta = document.getElementById('digestorMeta');
    if (meta) { meta.style.display = 'none'; meta.innerHTML = ''; }
    var mixFile = document.getElementById('mixFile');
    if (mixFile) mixFile.value = '';
}

var _digestPollTimers = {};

function _digestUrlCommon(urlInputId, statusId, metaId, resultsId, onSuccess) {
    var url = document.getElementById(urlInputId).value.trim();
    if (!url) return;
    var status = document.getElementById(statusId);
    var meta = document.getElementById(metaId);
    var results = document.getElementById(resultsId);
    status.style.display = 'block';
    status.innerHTML = '<div style="font-size:0.85rem;color:#D4A017;">Submitting URL...</div>' +
        '<div style="width:100%;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:12px;overflow:hidden;">' +
        '<div id="' + statusId + 'Bar" style="width:5%;height:100%;background:linear-gradient(90deg,#D4A017,#FFE082);border-radius:2px;transition:width 0.5s ease;"></div></div>' +
        '<div id="' + statusId + 'Elapsed" style="font-size:0.65rem;color:#666;margin-top:6px;"></div>';
    if (meta) { meta.style.display = 'none'; meta.innerHTML = ''; }
    if (results) { results.style.display = 'none'; results.innerHTML = ''; }

    fetch('/api/digest/url', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url: url})
    })
    .then(function(r){ return r.json(); })
    .then(function(data){
        if (data.error) { status.innerHTML = '<div style="font-size:0.85rem;color:#C41E3A;">Error: ' + data.error + '</div>'; return; }
        var jobId = data.job_id;
        if (!jobId) { status.innerHTML = '<div style="font-size:0.85rem;color:#C41E3A;">No job ID returned</div>'; return; }

        var pollKey = statusId + '_poll';
        if (_digestPollTimers[pollKey]) clearInterval(_digestPollTimers[pollKey]);

        var STATUS_MESSAGES = {
            'queued': 'Queued for processing...',
            'extracting': 'Checking for tracklist...',
            'downloading': 'Downloading audio stream...',
            'scanning': 'AudD is fingerprinting the mix...',
            'parsing': 'Parsing tracklist results...'
        };

        _digestPollTimers[pollKey] = setInterval(function() {
            fetch('/api/digest/url/status/' + jobId)
            .then(function(r){ return r.json(); })
            .then(function(poll){
                var bar = document.getElementById(statusId + 'Bar');
                var msgEl = status.querySelector('div');
                var elapsedEl = document.getElementById(statusId + 'Elapsed');
                var elapsed = poll.elapsed_seconds || 0;
                if (elapsedEl) elapsedEl.textContent = elapsed + 's elapsed';

                if (poll.metadata && meta && meta.innerHTML === '') {
                    var m = poll.metadata;
                    var dur = m.duration ? formatDuration(m.duration) : '';
                    meta.style.display = 'block';
                    meta.innerHTML = '<div style="display:flex;gap:12px;align-items:center;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:12px;margin-bottom:8px;">' +
                        (m.thumbnail ? '<img src="' + m.thumbnail + '" style="width:80px;height:60px;border-radius:8px;object-fit:cover;">' : '') +
                        '<div style="flex:1;min-width:0;"><div style="font-size:0.85rem;font-weight:700;color:#FFFEF7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (m.title || 'Unknown') + '</div>' +
                        '<div style="font-size:0.7rem;color:#8A7A5A;">' + (m.uploader || '') + (dur ? ' &bull; ' + dur : '') + '</div></div></div>';
                }

                if (poll.status === 'extracting') { if(bar) bar.style.width = '15%'; }
                else if (poll.status === 'downloading') { if(bar) bar.style.width = '20%'; }
                else if (poll.status === 'scanning') {
                    if (poll.scan_progress) {
                        var parts = poll.scan_progress.split('/');
                        var done = parseInt(parts[0]), total = parseInt(parts[1]);
                        var scanPct = Math.min(88, 25 + (done / total) * 63);
                        if(bar) bar.style.width = scanPct + '%';
                    } else {
                        var duration = (poll.metadata && poll.metadata.duration) || 7200;
                        var scanPct = Math.min(85, 20 + (elapsed / (duration / 15)) * 65);
                        if(bar) bar.style.width = scanPct + '%';
                    }
                }
                else if (poll.status === 'parsing') { if(bar) bar.style.width = '90%'; }

                var statusMsg = STATUS_MESSAGES[poll.status] || poll.status;
                if (poll.status === 'scanning' && poll.scan_progress) {
                    statusMsg = 'Fingerprinting chunk ' + poll.scan_progress + '...';
                }
                if (msgEl) msgEl.textContent = statusMsg;

                if (poll.status === 'done') {
                    clearInterval(_digestPollTimers[pollKey]);
                    if(bar) bar.style.width = '100%';
                    status.style.display = 'none';
                    if (poll.result) {
                        renderDigestResults(results, poll.result, null);
                        if (onSuccess) onSuccess(poll.result);
                    }
                }
                if (poll.status === 'failed') {
                    clearInterval(_digestPollTimers[pollKey]);
                    if(bar) bar.style.width = '100%';
                    status.innerHTML = '<div style="font-size:0.85rem;color:#C41E3A;">Error: ' + (poll.error || 'Unknown error') + '</div>';
                }
            })
            .catch(function(){});
        }, 4000);
    })
    .catch(function(err){
        status.innerHTML = '<div style="font-size:0.85rem;color:#C41E3A;">Failed to submit: ' + err.message + '</div>';
    });
}

function digestUrl() {
    var dropZone = document.getElementById('dropZone');
    if (dropZone) dropZone.style.display = 'none';
    _digestUrlCommon('digestUrlInput', 'digestorStatus', 'digestorMeta', 'digestorResults', null);
}

/* --- Audio Download (MP3) --- */
var _dlPollTimers = {};

function _downloadAudio(urlInputId, statusId) {
    var url = document.getElementById(urlInputId).value.trim();
    if (!url) return;
    var status = document.getElementById(statusId);
    status.style.display = 'block';
    status.innerHTML = '<div style="font-size:0.85rem;color:#D4A017;">Starting download...</div>' +
        '<div style="width:100%;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:12px;overflow:hidden;">' +
        '<div id="' + statusId + 'DlBar" style="width:5%;height:100%;background:linear-gradient(90deg,#7C3AED,#A78BFA);border-radius:2px;transition:width 0.5s ease;"></div></div>' +
        '<div id="' + statusId + 'DlElapsed" style="font-size:0.65rem;color:#666;margin-top:6px;"></div>';

    fetch('/api/download/audio', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url: url})
    })
    .then(function(r){ return r.json(); })
    .then(function(data){
        if (data.error) { status.innerHTML = '<div style="font-size:0.85rem;color:#C41E3A;">Error: ' + data.error + '</div>'; return; }
        var jobId = data.job_id;
        var pollKey = statusId + '_dl';
        if (_dlPollTimers[pollKey]) clearInterval(_dlPollTimers[pollKey]);
        var DL_STATUS = { 'queued': 'Queued...', 'extracting': 'Extracting metadata...', 'downloading': 'Downloading & converting to MP3...' };
        _dlPollTimers[pollKey] = setInterval(function() {
            fetch('/api/download/audio/status/' + jobId)
            .then(function(r){ return r.json(); })
            .then(function(poll){
                var bar = document.getElementById(statusId + 'DlBar');
                var elapsedEl = document.getElementById(statusId + 'DlElapsed');
                var elapsed = poll.elapsed_seconds || 0;
                if (elapsedEl) elapsedEl.textContent = elapsed + 's elapsed';
                if (poll.status === 'extracting') { if(bar) bar.style.width = '15%'; }
                else if (poll.status === 'downloading') { var pct = Math.min(85, 20 + elapsed * 1.5); if(bar) bar.style.width = pct + '%'; }
                var msg = status.querySelector('div');
                if (msg) msg.textContent = DL_STATUS[poll.status] || poll.status;
                if (poll.status === 'done') {
                    clearInterval(_dlPollTimers[pollKey]);
                    if(bar) bar.style.width = '100%';
                    var title = (poll.metadata && poll.metadata.title) || 'audio';
                    status.innerHTML = '<div style="text-align:center;padding:16px;">' +
                        '<div style="font-size:0.85rem;color:#1DB954;margin-bottom:12px;">Ready!</div>' +
                        '<a href="' + poll.download_url + '" download style="display:inline-block;padding:12px 28px;border-radius:12px;background:linear-gradient(135deg,#7C3AED,#A78BFA);color:#fff;font-weight:800;text-decoration:none;font-family:\'Nunito\',sans-serif;font-size:0.9rem;">Download MP3</a>' +
                        '<div style="font-size:0.7rem;color:#8A7A5A;margin-top:8px;">' + title + '</div></div>';
                }
                if (poll.status === 'failed') {
                    clearInterval(_dlPollTimers[pollKey]);
                    status.innerHTML = '<div style="font-size:0.85rem;color:#C41E3A;">Error: ' + (poll.error || 'Download failed') + '</div>';
                }
            })
            .catch(function(){});
        }, 3000);
    })
    .catch(function(err){
        status.innerHTML = '<div style="font-size:0.85rem;color:#C41E3A;">Network error: ' + err.message + '</div>';
    });
}

function downloadAudioStep3() {
    _downloadAudio('digestUrlInput', 'digestorStatus');
}

/* --- Events Radar --- */
function buildEventsExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Enter a city. Find upcoming electronic music events.</p>
        </div>
        <div style="width:100%;max-width:600px;">
            <div style="display:flex;gap:8px;margin-bottom:16px;">
                <input type="text" id="eventsCity" placeholder="Enter a city (e.g. Chicago, Miami, Berlin)" style="flex:1;padding:12px 16px;border-radius:16px;border:2px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#FFFEF7;font-family:'Nunito',sans-serif;font-size:0.9rem;outline:none;" onkeydown="if(event.key==='Enter')searchEvents()">
                <button onclick="searchEvents()" class="btn-primary" style="font-size:0.85rem;padding:12px 24px;border-radius:16px;">Search</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
                <span class="prompt-chip" onclick="document.getElementById('eventsCity').value='Miami';searchEvents()">Miami</span>
                <span class="prompt-chip" onclick="document.getElementById('eventsCity').value='Chicago';searchEvents()">Chicago</span>
                <span class="prompt-chip" onclick="document.getElementById('eventsCity').value='Berlin';searchEvents()">Berlin</span>
                <span class="prompt-chip" onclick="document.getElementById('eventsCity').value='Ibiza';searchEvents()">Ibiza</span>
            </div>
            <div id="eventsResults"></div>
        </div>`;
}

var FALLBACK_EVENTS = [
    { name: 'Deep House Collective', venue: 'The Underground', date: 'Mar 15, 2026', genre: 'Deep House', link: '#' },
    { name: 'Techno Warehouse Sessions', venue: 'Industrial Park', date: 'Mar 22, 2026', genre: 'Techno', link: '#' },
    { name: 'Melodic Sundays', venue: 'Rooftop Lounge', date: 'Mar 29, 2026', genre: 'Melodic House', link: '#' },
    { name: 'Bass Culture Festival', venue: 'City Arena', date: 'Apr 5, 2026', genre: 'Bass House', link: '#' },
    { name: 'Ambient Nights', venue: 'Gallery Space', date: 'Apr 12, 2026', genre: 'Ambient / Downtempo', link: '#' },
    { name: 'Spring Awakening', venue: 'Waterfront Park', date: 'Apr 19, 2026', genre: 'Multi-genre', link: '#' }
];

function searchEvents() {
    var city = document.getElementById('eventsCity').value.trim();
    if (!city) return;
    var container = document.getElementById('eventsResults');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#D4A017;font-size:0.85rem;">Scanning events in ' + city + '...</div>';
    fetch('/api/events', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({city: city})
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.events && data.events.length > 0) { renderEvents(container, data.events, city, true); }
        else { renderEvents(container, FALLBACK_EVENTS, city, false); }
    })
    .catch(function() { renderEvents(container, FALLBACK_EVENTS, city, false); });
}

function renderEvents(container, events, city, isAI) {
    var badge = isAI
        ? '<span style="font-size:0.6rem;background:rgba(212,160,23,0.15);color:#D4A017;padding:4px 10px;border-radius:8px;letter-spacing:1px;text-transform:uppercase;">AI Generated</span>'
        : '<span style="font-size:0.6rem;background:rgba(255,255,255,0.06);color:#666;padding:4px 10px;border-radius:8px;letter-spacing:1px;text-transform:uppercase;">Sample Data</span>';
    container.innerHTML =
        '<div style="text-align:center;margin-bottom:16px;">' +
            '<div style="font-family:\'Playfair Display\',serif;font-size:1.1rem;color:#FFE082;margin-bottom:6px;">Events near ' + city + '</div>' +
            badge +
        '</div>' +
        events.map(function(e) {
            return '<div style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;margin-bottom:8px;">' +
                '<div style="width:44px;height:44px;border-radius:8px;background:linear-gradient(135deg,rgba(196,30,58,0.2),rgba(196,30,58,0.05));display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">📍</div>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-size:0.85rem;font-weight:700;color:#FFFEF7;">' + e.name + '</div>' +
                    '<div style="font-size:0.7rem;color:#8A7A5A;">' + e.venue + '</div>' +
                    '<div style="font-size:0.6rem;color:#666;margin-top:2px;">' + e.genre + '</div>' +
                '</div>' +
                '<div style="text-align:right;flex-shrink:0;">' +
                    '<div style="font-size:0.8rem;color:#D4A017;font-weight:700;">' + e.date + '</div>' +
                '</div>' +
            '</div>';
        }).join('');
}

/* --- Set Builder --- */
function buildSetBuilderExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Pick a vibe and duration. Get a full set structure.</p>
        </div>
        <div style="width:100%;max-width:600px;">
            <div style="margin-bottom:16px;">
                <div style="font-size:0.7rem;color:#8A7A5A;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Vibe</div>
                <div class="mood-grid" id="vibeGrid">
                    <div class="mood-btn" onclick="selectVibe(this, 'deep')" data-vibe="deep"><span class="mood-emoji">🌊</span>Deep</div>
                    <div class="mood-btn" onclick="selectVibe(this, 'melodic')" data-vibe="melodic"><span class="mood-emoji">🎹</span>Melodic</div>
                    <div class="mood-btn" onclick="selectVibe(this, 'peak time')" data-vibe="peak time"><span class="mood-emoji">🔥</span>Peak Time</div>
                    <div class="mood-btn" onclick="selectVibe(this, 'journey')" data-vibe="journey"><span class="mood-emoji">🚀</span>Journey</div>
                </div>
            </div>
            <div style="margin-bottom:16px;">
                <div style="font-size:0.7rem;color:#8A7A5A;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Duration</div>
                <div style="display:flex;gap:8px;">
                    <button class="prompt-chip" onclick="selectDuration(this, '1 hour')" data-dur="1 hour">1 Hour</button>
                    <button class="prompt-chip" onclick="selectDuration(this, '90 minutes')" data-dur="90 minutes">90 Min</button>
                    <button class="prompt-chip" onclick="selectDuration(this, '2 hours')" data-dur="2 hours">2 Hours</button>
                    <button class="prompt-chip" onclick="selectDuration(this, '3 hours')" data-dur="3 hours">3 Hours</button>
                </div>
            </div>
            <div style="text-align:center;margin-bottom:16px;">
                <button class="btn-primary" id="buildSetBtn" onclick="buildSet()" disabled>Build My Set</button>
            </div>
            <div id="setResults"></div>
        </div>`;
}

var selectedVibe = null;
var selectedDuration = null;

function selectVibe(btn, vibe) {
    document.querySelectorAll('#vibeGrid .mood-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    selectedVibe = vibe;
    checkSetReady();
}

function selectDuration(btn, dur) {
    btn.parentElement.querySelectorAll('.prompt-chip').forEach(function(b) { b.style.borderColor = 'rgba(212,160,23,0.3)'; b.style.background = 'rgba(212,160,23,0.06)'; });
    btn.style.borderColor = '#D4A017';
    btn.style.background = 'rgba(212,160,23,0.15)';
    selectedDuration = dur;
    checkSetReady();
}

function checkSetReady() {
    var btn = document.getElementById('buildSetBtn');
    if (btn) btn.disabled = !(selectedVibe && selectedDuration);
}

var FALLBACK_SET = {
    tracks: [
        { position: 1, artist: 'Lane 8', title: 'Cherry Blossom', bpm: 119, key: 'Em', energy: 3, transition_note: 'Opener. Soft pads, set the tone.' },
        { position: 2, artist: 'Ben Bohmer', title: 'Time', bpm: 120, key: 'Abm', energy: 4, transition_note: 'Gentle BPM lift. Blend the melodics.' },
        { position: 3, artist: 'Yotto', title: 'Testarossa', bpm: 122, key: 'Gm', energy: 5, transition_note: 'Energy starts building. Driving groove.' },
        { position: 4, artist: 'RUFUS DU SOL', title: 'Innerbloom', bpm: 120, key: 'Cm', energy: 6, transition_note: 'Peak approach. Long blend.' },
        { position: 5, artist: 'Eric Prydz', title: 'Opus', bpm: 126, key: 'Dm', energy: 8, transition_note: 'Peak moment. Let it breathe.' },
        { position: 6, artist: 'Solomun', title: 'Sais', bpm: 118, key: 'Cm', energy: 5, transition_note: 'Cool down. Pull energy back.' },
        { position: 7, artist: 'Kidnap', title: 'Sirens', bpm: 122, key: 'Fm', energy: 4, transition_note: 'Gentle close. Atmospheric.' },
        { position: 8, artist: 'Catching Flies', title: 'Satisfied', bpm: 116, key: 'Am', energy: 3, transition_note: 'Final track. Let it fade.' }
    ]
};

function buildSet() {
    if (!selectedVibe || !selectedDuration) return;
    var container = document.getElementById('setResults');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#D4A017;font-size:0.85rem;">Building your ' + selectedDuration + ' ' + selectedVibe + ' set...</div>';
    fetch('/api/setbuilder', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({vibe: selectedVibe, duration: selectedDuration})
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        var tracks = data.set && data.set.tracks && data.set.tracks.length > 0 ? data.set.tracks : null;
        if (tracks) { renderSet(container, tracks, true); }
        else { renderSet(container, FALLBACK_SET.tracks, false); }
    })
    .catch(function() { renderSet(container, FALLBACK_SET.tracks, false); });
}

function renderSet(container, tracks, isAI) {
    var badge = isAI
        ? '<span style="font-size:0.6rem;background:rgba(212,160,23,0.15);color:#D4A017;padding:4px 10px;border-radius:8px;letter-spacing:1px;text-transform:uppercase;">AI Generated</span>'
        : '<span style="font-size:0.6rem;background:rgba(255,255,255,0.06);color:#666;padding:4px 10px;border-radius:8px;letter-spacing:1px;text-transform:uppercase;">Sample Set</span>';
    var energyBars = tracks.map(function(t) {
        var pct = ((t.energy || 5) / 10) * 100;
        var color = t.energy >= 7 ? '#C41E3A' : t.energy >= 4 ? '#D4A017' : '#4CAF50';
        return '<div style="flex:1;background:' + color + ';border-radius:4px 4px 0 0;height:' + pct + '%;opacity:0.7;transition:height 0.5s ease;" title="Track ' + t.position + ': Energy ' + t.energy + '/10"></div>';
    }).join('');
    var trackCards = tracks.map(function(t) {
        return '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;margin-bottom:8px;">' +
            '<div style="width:32px;height:32px;border-radius:50%;background:rgba(212,160,23,0.1);display:flex;align-items:center;justify-content:center;font-size:0.75rem;color:#D4A017;font-weight:800;flex-shrink:0;">' + t.position + '</div>' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:0.85rem;font-weight:700;color:#FFFEF7;">' + t.artist + ' — ' + t.title + '</div>' +
                '<div style="font-size:0.65rem;color:#8A7A5A;margin-top:2px;font-style:italic;">' + (t.transition_note || '') + '</div>' +
            '</div>' +
            '<div style="text-align:right;flex-shrink:0;">' +
                '<div style="font-size:0.75rem;color:#D4A017;font-weight:700;">' + t.bpm + ' BPM</div>' +
                '<div style="font-size:0.65rem;color:#8A7A5A;">' + t.key + '</div>' +
                '<div style="font-size:0.6rem;color:#666;">Energy: ' + t.energy + '/10</div>' +
            '</div>' +
        '</div>';
    }).join('');
    container.innerHTML =
        '<div style="text-align:center;margin-bottom:16px;">' +
            '<div style="font-family:\'Playfair Display\',serif;font-size:1.1rem;color:#FFE082;margin-bottom:6px;">' + tracks.length + '-Track Set</div>' +
            badge +
        '</div>' +
        '<div style="display:flex;align-items:flex-end;gap:4px;height:60px;margin-bottom:16px;padding:0 8px;">' +
            energyBars +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:0.55rem;color:#666;margin-bottom:16px;padding:0 8px;">' +
            '<span>LOW ENERGY</span><span>ENERGY CURVE</span><span>HIGH ENERGY</span>' +
        '</div>' +
        trackCards;
}

/* --- Producer Tools --- */
function buildToolsExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Ask any music theory or production question.</p>
        </div>
        <div style="width:100%;max-width:600px;">
            <div style="display:flex;gap:8px;margin-bottom:16px;">
                <input type="text" id="toolsInput" placeholder="e.g. What scale works for dark techno in D minor?" onkeydown="if(event.key==='Enter')sendToolsQuery()" style="flex:1;padding:12px 16px;border-radius:16px;border:2px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#FFFEF7;font-family:'Nunito',sans-serif;font-size:0.9rem;outline:none;">
                <button onclick="sendToolsQuery()" style="padding:12px 20px;border-radius:16px;border:none;background:linear-gradient(135deg,#D4A017,#B8860B);color:#0D0D1A;font-weight:800;cursor:pointer;font-family:'Nunito',sans-serif;">Ask</button>
            </div>
            <div class="prompt-chips" style="margin-bottom:16px;">
                <div class="prompt-chip" onclick="fillToolsQuery(this, 'What scale works for dark techno in D minor?')">Dark techno scales</div>
                <div class="prompt-chip" onclick="fillToolsQuery(this, 'Best chord progression for melodic house in A minor?')">Melodic house chords</div>
                <div class="prompt-chip" onclick="fillToolsQuery(this, 'How do I create a Reese bass sound?')">Reese bass design</div>
                <div class="prompt-chip" onclick="fillToolsQuery(this, 'What frequencies should I cut for a clean mix?')">Mix EQ tips</div>
            </div>
            <div id="toolsResult" style="display:none;"></div>
        </div>`;
}

function fillToolsQuery(chip, query) {
    document.getElementById('toolsInput').value = query;
    sendToolsQuery();
}

function sendToolsQuery() {
    var input = document.getElementById('toolsInput');
    var query = input.value.trim();
    if (!query) return;
    var result = document.getElementById('toolsResult');
    result.style.display = 'block';
    result.innerHTML = '<div style="text-align:center;padding:16px;color:#D4A017;font-size:0.85rem;">Analyzing...</div>';
    fetch('/api/tools/analyze', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({query: query})
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.error) { result.innerHTML = '<div style="padding:16px;color:#C41E3A;font-size:0.85rem;">Error: ' + data.error + '</div>'; return; }
        var text = (data.response || 'No response').replace(/\n/g, '<br>');
        result.innerHTML =
            '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:16px;">' +
                '<div style="font-size:0.65rem;color:#D4A017;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Music Theory AI</div>' +
                '<div style="font-size:0.85rem;color:#E0C8A0;line-height:1.6;">' + text + '</div>' +
            '</div>';
    })
    .catch(function(err) { result.innerHTML = '<div style="padding:16px;color:#C41E3A;font-size:0.85rem;">Connection error. Try again.</div>'; });
}

/* --- Dashboard --- */
function buildDashboardExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Your production stats at a glance.</p>
        </div>
        <div style="width:100%;max-width:600px;">
            <div id="dashboardGrid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
                <div class="analysis-card">
                    <div class="ac-label">Tracks Mastered</div>
                    <div class="ac-value" id="val-mastered">--</div>
                </div>
                <div class="analysis-card">
                    <div class="ac-label">Sets Built</div>
                    <div class="ac-value" id="val-sets">--</div>
                </div>
                <div class="analysis-card">
                    <div class="ac-label">Stems Separated</div>
                    <div class="ac-value" id="val-stems">--</div>
                </div>
                <div class="analysis-card">
                    <div class="ac-label">Mixes Archived</div>
                    <div class="ac-value" id="val-archive">--</div>
                </div>
                <div class="analysis-card" style="grid-column:span 2;">
                    <div class="ac-label">Discovery Sessions</div>
                    <div class="ac-value" id="val-discovery">--</div>
                </div>
            </div>
        </div>`;
}

function loadDashboardStats() {
    var hdrs = typeof getAuthHeaders === 'function' ? getAuthHeaders() : {};
    fetch('/api/dashboard', { headers: hdrs })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        var animate = function(id, target) {
            var el = document.getElementById(id);
            if (!el) return;
            var current = 0;
            var step = Math.max(1, Math.ceil(target / 20));
            var interval = setInterval(function() {
                current += step;
                if (current >= target) { current = target; clearInterval(interval); }
                el.textContent = current;
            }, 40);
        };
        animate('val-mastered', data.tracks_mastered || 0);
        animate('val-sets', data.sets_built || 0);
        animate('val-stems', data.stems_separated || 0);
        animate('val-archive', data.mixes_archived || 0);
        animate('val-discovery', data.discovery_sessions || 0);
    })
    .catch(function() {
        ['val-mastered','val-sets','val-stems','val-archive','val-discovery'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.textContent = '?';
        });
    });
}

/* --- Default Experience (sample cards for modes without custom UI) --- */
var MODE_SAMPLES = {
    stems: [
        { icon: '🔀', title: 'Separate a track', body: 'Drop any audio file and split it into vocals, drums, bass, and other.', response: 'Processing "Opus - Eric Prydz"... Separation complete.<br><br><strong>4 stems extracted:</strong><br>&bull; Vocals (isolated pads and vocal chops)<br>&bull; Drums (kick, hi-hats, claps)<br>&bull; Bass (sub-bass and mid-bass)<br>&bull; Other (synths, effects, atmospherics)<br><br>Each stem exported as 48kHz WAV. Ready for remix.' },
        { icon: '🎛️', title: 'Re-balance a mix', body: 'Adjust individual stem volumes after separation.', response: 'Stem mixer loaded. Current levels:<br>&bull; Vocals: 0 dB<br>&bull; Drums: +2 dB<br>&bull; Bass: -1 dB<br>&bull; Other: 0 dB<br><br>Drag sliders to rebalance. Export when ready.' },
        { icon: '🎤', title: 'Extract acapella', body: 'Pull clean vocals from any track for remixes.', response: 'Acapella extraction uses our vocal isolation AI. Results are studio-quality at 48kHz. Works best on tracks with clear vocal sections. Processing time: ~30 seconds per track.' }
    ],
    events: [
        { icon: '📍', title: 'Find events near me', body: 'Discover DJ sets, festivals, and live shows in your area.', response: 'Scanning events near Chicago, IL:<br><br>&bull; <strong>Prydz HOLOSPHERE</strong> - United Center, Mar 15<br>&bull; <strong>Lane 8 Brightest Lights Tour</strong> - Concord Music Hall, Mar 22<br>&bull; <strong>Spring Awakening Festival</strong> - Addams Park, Jun 12-14<br>&bull; <strong>Solomun +1</strong> - Radius Chicago, Apr 5' },
        { icon: '🎟️', title: 'Track an artist', body: 'Get notified when your favorite artists announce shows.', response: 'Artist tracking enabled. We monitor tour announcements, festival lineups, and pop-up events. You\'ll get alerts for any artist in your library.' },
        { icon: '🌍', title: 'Festival calendar', body: 'See all major electronic music festivals worldwide.', response: 'Global festival calendar loaded. Filtered to electronic/dance:<br><br>&bull; Tomorrowland (Belgium) - Jul 18-27<br>&bull; Movement (Detroit) - May 24-26<br>&bull; ADE (Amsterdam) - Oct 15-19<br>&bull; Ultra (Miami) - Mar 28-30' }
    ],
    setbuilder: [
        { icon: '📋', title: 'Build a set from scratch', body: 'Start with a vibe, end with a complete tracklist.', response: 'Set Builder wizard started.<br><br><strong>Step 1:</strong> Choose your vibe (Deep / Melodic / Peak Time / Journey)<br><strong>Step 2:</strong> Set duration (1hr / 2hr / 3hr / Custom)<br><strong>Step 3:</strong> Pick opening track<br><strong>Step 4:</strong> AI suggests next tracks based on key, energy, and BPM flow<br><br>Each suggestion includes transition notes.' },
        { icon: '🔑', title: 'Harmonic matching', body: 'Find tracks that mix perfectly with your current selection.', response: 'Harmonic matching uses the Camelot wheel system. For your current track in 8A (Am), compatible keys:<br><br>&bull; 8A (Am) - same key<br>&bull; 7A (Dm) - energy down<br>&bull; 9A (Em) - energy up<br>&bull; 8B (C) - mood shift<br><br>29 tracks in your library match these keys.' },
        { icon: '📊', title: 'Energy flow analysis', body: 'Visualize the energy curve of your entire set.', response: 'Energy flow maps each track on a 1-10 scale. The ideal set follows a wave pattern: build &rarr; peak &rarr; breathe &rarr; build higher &rarr; peak &rarr; cool down. Upload your tracklist for a full analysis.' }
    ],
    archive: [
        { icon: '💾', title: 'Upload a recorded mix', body: 'Store your mixes with auto-tagged metadata.', response: 'Mix uploaded. Auto-analysis complete:<br><br>&bull; Duration: 1:47:32<br>&bull; Average BPM: 123<br>&bull; Key range: Am - Fm<br>&bull; Track count: ~22 (detected)<br>&bull; Energy peak: 1:12:00 mark<br><br>Mix stored in your archive. Accessible from any device.' },
        { icon: '📈', title: 'Compare mixes', body: 'See how your mixing style has evolved over time.', response: 'Mix comparison shows your progression across uploads. We track transition smoothness, energy flow consistency, key compatibility percentage, and crowd engagement patterns.' },
        { icon: '🔍', title: 'Search your archive', body: 'Find mixes by date, genre, BPM range, or mood.', response: 'Search your full archive with filters:<br>&bull; Date range<br>&bull; Genre tags<br>&bull; BPM range<br>&bull; Duration<br>&bull; Venue/event name<br><br>All mixes are timestamped and searchable.' }
    ],
    tools: [
        { icon: '🛠️', title: 'Reference track analysis', body: 'Analyze any track for production insights.', response: 'Reference analysis breaks down:<br><br>&bull; Frequency spectrum (sub, low, mid, high, air)<br>&bull; Stereo imaging per band<br>&bull; Dynamic range and compression<br>&bull; Arrangement structure (intro, build, drop, breakdown)<br>&bull; Sound design elements detected<br><br>Compare against your own tracks for A/B mastering.' },
        { icon: '🎼', title: 'Scale finder', body: 'Find the right scale for your melody.', response: 'Hum or play a melody. The scale finder identifies:<br>&bull; Root note<br>&bull; Scale type (major, minor, dorian, mixolydian, etc.)<br>&bull; Compatible chord progressions<br>&bull; Suggested bassline patterns<br><br>Works with audio input or MIDI.' },
        { icon: '🥁', title: 'Drum pattern grid', body: 'Build drum patterns with genre-specific templates.', response: 'Drum grid loaded with templates:<br><br>&bull; Four-on-the-floor (House)<br>&bull; Offbeat hi-hats (Techno)<br>&bull; Broken beat (UK Garage)<br>&bull; Polyrhythmic (Afro House)<br>&bull; Minimal (Deep Tech)<br><br>16-step sequencer with swing and velocity control.' }
    ],
    digestor: [
        { icon: '🔬', title: 'Extract tracklist from a mix', body: 'Upload a recorded DJ mix and identify every track with timestamps.', response: 'Processing "Pete\'s Late Night Session 47"...<br><br>AudD Enterprise scan complete. <strong>22 tracks identified:</strong><br><br>&bull; 00:00 - Yotto &mdash; "Testarossa" (122 BPM, Gm)<br>&bull; 05:12 - Lane 8 &mdash; "Cherry Blossom" (119 BPM, Em)<br>&bull; 10:45 - Ben Bohmer &mdash; "Time" (120 BPM, Abm)<br>&bull; 16:30 - RUFUS DU SOL &mdash; "Innerbloom" (120 BPM, Cm)<br>&bull; ... 18 more tracks<br><br>Export as text, CSV, or send to Set Builder.' },
        { icon: '📊', title: 'Tracklist analysis', body: 'Get BPM flow, key compatibility, and energy mapping from your extracted tracklist.', response: 'Tracklist analysis:<br><br>&bull; <strong>BPM range:</strong> 118-126 (smooth flow)<br>&bull; <strong>Key compatibility:</strong> 91% Camelot-adjacent<br>&bull; <strong>Energy curve:</strong> Gradual build, peak at track 14, smooth cooldown<br>&bull; <strong>Genre mix:</strong> 60% melodic house, 25% deep house, 15% progressive<br><br>Overall rating: 9.2/10 &mdash; excellent set structure.' },
        { icon: '📋', title: 'Export & share', body: 'Export your tracklist to share on social media or archive.', response: 'Export options:<br><br>&bull; <strong>1001tracklists format</strong> &mdash; ready to submit<br>&bull; <strong>Plain text</strong> &mdash; for social posts<br>&bull; <strong>CSV</strong> &mdash; for spreadsheets and analysis<br>&bull; <strong>Set Builder import</strong> &mdash; rebuild the set with transition notes<br><br>Tracklist copied to clipboard.' }
    ],
    dashboard: [
        { icon: '📊', title: 'Your production stats', body: 'Track your workflow, output, and growth.', response: 'Dashboard shows your activity:<br><br>&bull; Tracks mastered this month: 12<br>&bull; Sets built: 3<br>&bull; Stems separated: 8<br>&bull; Discovery sessions: 15<br>&bull; Total production time: 47 hours<br><br>You\'re 23% more productive than last month.' },
        { icon: '🎯', title: 'Goals and streaks', body: 'Set production goals and track your consistency.', response: 'Active goals:<br>&bull; Master 1 track per week (3/4 complete)<br>&bull; Build 2 sets per month (1/2 complete)<br>&bull; 30-day production streak (day 18)<br><br>Consistency is the secret. Keep going.' },
        { icon: '📁', title: 'Project overview', body: 'See all your active projects in one place.', response: 'Active projects:<br><br>&bull; "Late Night Sessions EP" - 3/5 tracks mastered<br>&bull; "Summer Festival Set" - tracklist 80% done<br>&bull; "Remix Pack Vol. 2" - stems separated, mixing next<br><br>All projects sync across devices.' }
    ]
};

/* ===== LIVE DJ SET AUDIT ===== */
function buildLiveAuditExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Upload a DJ set for full analysis — tracklist, BPM flow, key transitions, energy curve, and transition recommendations.</p>
        </div>
        <div style="width:100%;max-width:600px;">

            <!-- Upload -->
            <div style="background:rgba(255,255,255,0.03);border:2px dashed rgba(196,30,58,0.3);border-radius:16px;padding:32px;text-align:center;margin-bottom:16px;cursor:pointer;" onclick="document.getElementById('auditMixFile').click()">
                <div style="font-size:2.5rem;margin-bottom:8px;">🔍</div>
                <div style="font-family:'Playfair Display',serif;font-size:1.1rem;color:#FFE082;margin-bottom:4px;">Drop your set here</div>
                <div style="font-size:0.75rem;color:#8A7A5A;">MP3, WAV, M4A — we'll analyze everything</div>
                <input type="file" id="auditMixFile" accept="audio/*" style="display:none" onchange="startLiveAudit(this)">
            </div>

            <!-- Pipeline status -->
            <div id="auditPipeline" style="display:none;">
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;">
                    <div style="font-size:0.85rem;font-weight:700;color:#FFE082;margin-bottom:12px;">Pipeline</div>
                    <div id="auditStep1" class="audit-step" style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                        <span style="font-size:1rem;">⏳</span>
                        <span style="font-size:0.8rem;color:#666;">Step 1: Audio analysis (BPM, key, loudness)</span>
                    </div>
                    <div id="auditStep2" class="audit-step" style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                        <span style="font-size:1rem;">⏳</span>
                        <span style="font-size:0.8rem;color:#666;">Step 2: Track identification (AudD fingerprinting)</span>
                    </div>
                    <div id="auditStep3" class="audit-step" style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                        <span style="font-size:1rem;">⏳</span>
                        <span style="font-size:0.8rem;color:#666;">Step 3: Transition analysis & recommendations</span>
                    </div>
                    <div id="auditStep4" class="audit-step" style="display:flex;gap:10px;align-items:center;padding:8px 0;">
                        <span style="font-size:1rem;">⏳</span>
                        <span style="font-size:0.8rem;color:#666;">Step 4: Set report generation</span>
                    </div>
                </div>
            </div>

            <!-- Results -->
            <div id="auditResults"></div>
        </div>`;
}

function startLiveAudit(input) {
    var file = input.files[0];
    if (!file) return;

    document.getElementById('auditPipeline').style.display = 'block';
    var results = document.getElementById('auditResults');
    results.innerHTML = '';

    // Step 1: Client-side audio analysis
    updateAuditStep('auditStep1', 'running', 'Analyzing audio...');
    analyzeAudioLocal(file).then(function(localAnalysis) {
        updateAuditStep('auditStep1', 'done', 'BPM: ' + (localAnalysis.bpm || '?') + ' | Key: ' + (localAnalysis.key || '?'));

        // Step 2: Upload for track ID via digestor
        updateAuditStep('auditStep2', 'running', 'Identifying tracks...');
        var formData = new FormData();
        formData.append('file', file);

        fetch('/api/digestor', { method: 'POST', body: formData })
        .then(function(r) { return r.json(); })
        .then(function(digestData) {
            var tracks = digestData.tracks || digestData.tracklist || [];
            updateAuditStep('auditStep2', 'done', tracks.length + ' tracks identified');

            // Step 3: Transition analysis via AI
            updateAuditStep('auditStep3', 'running', 'Analyzing transitions...');
            var trackNames = tracks.map(function(t) { return (t.title || t.name || 'Unknown') + ' by ' + (t.artist || 'Unknown'); });

            fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'Analyze this DJ set tracklist for transition quality. For each transition between tracks, rate it (smooth/decent/rough) and suggest what could improve it. Also note the overall BPM flow and energy curve. Tracklist: ' + trackNames.join(' → '),
                    context: 'dj_set_audit'
                })
            })
            .then(function(r) { return r.json(); })
            .then(function(aiData) {
                updateAuditStep('auditStep3', 'done', 'Transitions analyzed');
                updateAuditStep('auditStep4', 'done', 'Report ready');

                // Render full report
                renderAuditReport(results, {
                    file: file.name,
                    bpm: localAnalysis.bpm,
                    key: localAnalysis.key,
                    loudness: localAnalysis.loudness,
                    tracks: tracks,
                    analysis: aiData.response || aiData.reply || 'Analysis complete.'
                });
            })
            .catch(function() {
                updateAuditStep('auditStep3', 'done', 'AI analysis unavailable — showing tracklist');
                updateAuditStep('auditStep4', 'done', 'Report ready');
                renderAuditReport(results, {
                    file: file.name, bpm: localAnalysis.bpm, key: localAnalysis.key,
                    loudness: localAnalysis.loudness, tracks: tracks, analysis: null
                });
            });
        })
        .catch(function() {
            updateAuditStep('auditStep2', 'error', 'Track ID failed — try a shorter clip');
        });
    }).catch(function() {
        updateAuditStep('auditStep1', 'error', 'Audio analysis failed');
    });
}

function updateAuditStep(stepId, status, text) {
    var el = document.getElementById(stepId);
    if (!el) return;
    var icons = { running: '🔄', done: '✅', error: '❌' };
    var colors = { running: '#D4A017', done: '#22c55e', error: '#EF4444' };
    el.innerHTML = '<span style="font-size:1rem;">' + (icons[status] || '⏳') + '</span>' +
        '<span style="font-size:0.8rem;color:' + (colors[status] || '#666') + ';">' + text + '</span>';
}

function renderAuditReport(container, data) {
    var tracksHtml = '';
    if (data.tracks && data.tracks.length) {
        tracksHtml = data.tracks.map(function(t, i) {
            return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">' +
                '<div style="width:28px;text-align:center;font-family:\'JetBrains Mono\',monospace;font-size:0.7rem;color:#666;">' + (i + 1) + '</div>' +
                '<div style="flex:1;">' +
                    '<div style="font-size:0.8rem;color:#fff;font-weight:600;">' + (t.title || t.name || 'Unknown') + '</div>' +
                    '<div style="font-size:0.65rem;color:#8A7A5A;">' + (t.artist || '') + '</div>' +
                '</div>' +
                (t.timestamp ? '<div style="font-size:0.65rem;color:#666;font-family:\'JetBrains Mono\',monospace;">' + t.timestamp + '</div>' : '') +
            '</div>';
        }).join('');
    }

    container.innerHTML =
        '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(212,160,23,0.2);border-radius:16px;padding:20px;margin-bottom:16px;">' +
            '<div style="font-family:\'Playfair Display\',serif;font-size:1.1rem;color:#FFE082;margin-bottom:12px;">Set Report: ' + data.file + '</div>' +
            '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;">' +
                '<div style="background:rgba(212,160,23,0.1);border-radius:10px;padding:10px 16px;text-align:center;">' +
                    '<div style="font-size:0.6rem;color:#8A7A5A;text-transform:uppercase;letter-spacing:1px;">BPM</div>' +
                    '<div style="font-size:1.2rem;font-weight:700;color:#FFE082;">' + (data.bpm || '?') + '</div>' +
                '</div>' +
                '<div style="background:rgba(212,160,23,0.1);border-radius:10px;padding:10px 16px;text-align:center;">' +
                    '<div style="font-size:0.6rem;color:#8A7A5A;text-transform:uppercase;letter-spacing:1px;">Key</div>' +
                    '<div style="font-size:1.2rem;font-weight:700;color:#FFE082;">' + (data.key || '?') + '</div>' +
                '</div>' +
                '<div style="background:rgba(212,160,23,0.1);border-radius:10px;padding:10px 16px;text-align:center;">' +
                    '<div style="font-size:0.6rem;color:#8A7A5A;text-transform:uppercase;letter-spacing:1px;">Tracks</div>' +
                    '<div style="font-size:1.2rem;font-weight:700;color:#FFE082;">' + (data.tracks ? data.tracks.length : 0) + '</div>' +
                '</div>' +
            '</div>' +
            (tracksHtml ? '<div style="margin-bottom:16px;">' + tracksHtml + '</div>' : '') +
            (data.analysis ? '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;margin-top:12px;">' +
                '<div style="font-size:0.75rem;font-weight:700;color:#D4A017;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">AI Transition Analysis</div>' +
                '<div style="font-size:0.8rem;color:#ccc;line-height:1.6;white-space:pre-wrap;">' + data.analysis + '</div>' +
            '</div>' : '') +
        '</div>';
}

function buildDefaultExperience(name, modeName) {
    var samples = MODE_SAMPLES[selectedMode] || MODE_SAMPLES.tools;
    var cards = samples.map(function(s, i) {
        return '<div class="sample-card" onclick="toggleSampleCard(this)">' +
            '<div class="sc-header">' +
                '<span class="sc-icon">' + s.icon + '</span>' +
                '<span class="sc-title">' + s.title + '</span>' +
            '</div>' +
            '<div class="sc-body">' + s.body + '</div>' +
            '<div class="sc-response">' + s.response + '</div>' +
        '</div>';
    }).join('');
    return '<div class="experience-title">' +
            '<h2>' + modeName + '</h2>' +
            '<p>Tap a card to see it in action</p>' +
        '</div>' +
        '<div class="sample-cards">' + cards + '</div>';
}

/* ===== PRESS KIT (EPK) ===== */
function buildPressKitExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Build your electronic press kit for bookings and promotions.</p>
        </div>
        <div style="width:100%;max-width:600px;">

            <!-- Photo Upload -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;">
                <div style="font-size:0.9rem;font-weight:700;color:#FFE082;margin-bottom:12px;">📸 Promo Photos</div>
                <div id="pressKitPhotos" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;"></div>
                <label style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:rgba(212,160,23,0.15);border:1px dashed rgba(212,160,23,0.3);border-radius:12px;cursor:pointer;color:#D4A017;font-size:0.8rem;font-weight:600;">
                    <input type="file" accept="image/*" multiple onchange="handlePressKitPhotos(this.files)" style="display:none;">
                    + Upload Photos
                </label>
            </div>

            <!-- DJ Bio -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;">
                <div style="font-size:0.9rem;font-weight:700;color:#FFE082;margin-bottom:12px;">🎤 Bio</div>
                <textarea id="pressKitBio" placeholder="Write your DJ bio... (genres, style, influences, history)" style="width:100%;min-height:100px;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-family:'Nunito',sans-serif;font-size:0.85rem;resize:vertical;box-sizing:border-box;"></textarea>
            </div>

            <!-- SoundCloud -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;">
                <div style="font-size:0.9rem;font-weight:700;color:#FFE082;margin-bottom:12px;">🔊 SoundCloud</div>
                <input type="text" id="pressKitSoundcloud" placeholder="https://soundcloud.com/your-profile" style="width:100%;padding:12px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-family:'Nunito',sans-serif;font-size:0.85rem;box-sizing:border-box;">
                <div id="pressKitSCTracks" style="margin-top:10px;"></div>
            </div>

            <!-- Festival History -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;">
                <div style="font-size:0.9rem;font-weight:700;color:#FFE082;margin-bottom:12px;">🎪 Festival & Event History</div>
                <div id="pressKitEvents" style="margin-bottom:10px;"></div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <input type="text" id="pressKitEventName" placeholder="Event name" style="flex:2;min-width:120px;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-size:0.8rem;box-sizing:border-box;">
                    <input type="text" id="pressKitEventYear" placeholder="Year" style="flex:0.5;min-width:60px;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-size:0.8rem;box-sizing:border-box;">
                    <button onclick="addPressKitEvent()" style="padding:10px 16px;background:#D4A017;color:#0D0D1A;border:none;border-radius:8px;font-weight:700;font-size:0.8rem;cursor:pointer;">Add</button>
                </div>
            </div>

            <!-- Socials -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;">
                <div style="font-size:0.9rem;font-weight:700;color:#FFE082;margin-bottom:12px;">🔗 Social Links</div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <input type="text" id="pressKitIG" placeholder="Instagram @handle" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-size:0.8rem;box-sizing:border-box;">
                    <input type="text" id="pressKitTwitter" placeholder="X (Twitter) @handle" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-size:0.8rem;box-sizing:border-box;">
                    <input type="text" id="pressKitWebsite" placeholder="Website URL" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-size:0.8rem;box-sizing:border-box;">
                </div>
            </div>

            <!-- Collaborators -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;">
                <div style="font-size:0.9rem;font-weight:700;color:#FFE082;margin-bottom:12px;">👥 Collaborators & Guests</div>
                <textarea id="pressKitCollabs" placeholder="List collaborators, guest mixes, affiliated crews..." style="width:100%;min-height:60px;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-family:'Nunito',sans-serif;font-size:0.85rem;resize:vertical;box-sizing:border-box;"></textarea>
            </div>

            <!-- Genre Tags -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;">
                <div style="font-size:0.9rem;font-weight:700;color:#FFE082;margin-bottom:12px;">🎵 Genres</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;" id="pressKitGenres">
                    ${['House','Deep House','Tech House','Techno','Trance','Progressive','DnB','Ambient','Afro House','Melodic Techno'].map(g =>
                        '<span onclick="this.classList.toggle(\'picked\')" class="prompt-chip" style="cursor:pointer;">' + g + '</span>'
                    ).join('')}
                </div>
            </div>

            <!-- Export -->
            <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
                <button onclick="savePressKit()" class="btn-primary" style="padding:14px 28px;border-radius:16px;font-size:0.9rem;">💾 Save Press Kit</button>
                <button onclick="exportPressKit()" class="btn-primary" style="padding:14px 28px;border-radius:16px;font-size:0.9rem;background:rgba(255,255,255,0.08);color:#FFE082;">📤 Export / Share</button>
            </div>
            <div id="pressKitStatus" style="text-align:center;margin-top:12px;font-size:0.75rem;color:#666;"></div>
        </div>`;
}

var pressKitPhotoURLs = [];
var pressKitEventsList = [];

function handlePressKitPhotos(files) {
    var container = document.getElementById('pressKitPhotos');
    for (var i = 0; i < files.length; i++) {
        (function(file) {
            var reader = new FileReader();
            reader.onload = function(e) {
                pressKitPhotoURLs.push(e.target.result);
                var img = document.createElement('div');
                img.style.cssText = 'width:80px;height:80px;border-radius:10px;background-size:cover;background-position:center;border:1px solid rgba(255,255,255,0.1);';
                img.style.backgroundImage = 'url(' + e.target.result + ')';
                container.appendChild(img);
            };
            reader.readAsDataURL(file);
        })(files[i]);
    }
}

function addPressKitEvent() {
    var name = document.getElementById('pressKitEventName').value.trim();
    var year = document.getElementById('pressKitEventYear').value.trim();
    if (!name) return;
    pressKitEventsList.push({ name: name, year: year || '' });
    document.getElementById('pressKitEventName').value = '';
    document.getElementById('pressKitEventYear').value = '';
    renderPressKitEvents();
}

function renderPressKitEvents() {
    var container = document.getElementById('pressKitEvents');
    container.innerHTML = pressKitEventsList.map(function(e, i) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;">' +
            '<span style="color:#FFE082;font-size:0.8rem;">🎪</span>' +
            '<span style="color:#fff;font-size:0.8rem;flex:1;">' + e.name + (e.year ? ' (' + e.year + ')' : '') + '</span>' +
            '<span onclick="pressKitEventsList.splice(' + i + ',1);renderPressKitEvents()" style="color:#EF4444;font-size:0.7rem;cursor:pointer;">✕</span>' +
        '</div>';
    }).join('');
}

function savePressKit() {
    var genres = [];
    document.querySelectorAll('#pressKitGenres .picked').forEach(function(el) { genres.push(el.textContent); });
    var data = {
        bio: document.getElementById('pressKitBio').value,
        soundcloud: document.getElementById('pressKitSoundcloud').value,
        instagram: document.getElementById('pressKitIG').value,
        twitter: document.getElementById('pressKitTwitter').value,
        website: document.getElementById('pressKitWebsite').value,
        collaborators: document.getElementById('pressKitCollabs').value,
        genres: genres,
        events: pressKitEventsList,
        photos: pressKitPhotoURLs.length
    };
    fetch('/api/presskit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Crew-Token': localStorage.getItem('sbmToken') || '' },
        body: JSON.stringify(data)
    }).then(function(r) { return r.json(); })
    .then(function(d) {
        document.getElementById('pressKitStatus').textContent = 'Press kit saved!';
        document.getElementById('pressKitStatus').style.color = '#22c55e';
        if (typeof sbmToast === 'function') sbmToast('Press kit saved!', 'success');
    }).catch(function() {
        document.getElementById('pressKitStatus').textContent = 'Saved locally (server sync later)';
        document.getElementById('pressKitStatus').style.color = '#D4A017';
        localStorage.setItem('sbm_presskit', JSON.stringify(data));
    });
}

function exportPressKit() {
    sbmToast('Press kit export coming soon — shareable link & PDF download.', 'info');
}

/* ===== VIBE CHECK (DJ Side) ===== */
var vibeSessionCode = null;

function buildVibeCheckExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Start a live session. Audience joins from their phone to see what you're playing and request songs.</p>
        </div>
        <div style="width:100%;max-width:500px;">
            <div id="vibeControls">
                <button onclick="startVibeSession()" class="btn-primary" style="padding:16px 32px;border-radius:16px;font-size:1rem;width:100%;">
                    Start Live Session
                </button>
            </div>
            <div id="vibeSession" style="display:none;">
                <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:16px;padding:20px;text-align:center;margin-bottom:16px;">
                    <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.4);margin-bottom:4px;">Share This Link</div>
                    <div id="vibeJoinURL" style="font-size:1.1rem;color:#22c55e;font-weight:800;word-break:break-all;cursor:pointer;" onclick="copyVibeLink()"></div>
                    <div style="font-size:0.7rem;color:rgba(255,255,255,0.3);margin-top:8px;">Tap to copy. Audience opens this on their phone.</div>
                </div>

                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;">
                    <div style="font-size:0.9rem;font-weight:700;color:#FFE082;margin-bottom:12px;">Now Playing</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input type="text" id="vibeTrackTitle" placeholder="Track title" style="flex:2;min-width:120px;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-size:0.85rem;box-sizing:border-box;">
                        <input type="text" id="vibeTrackArtist" placeholder="Artist" style="flex:1;min-width:80px;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-size:0.85rem;box-sizing:border-box;">
                    </div>
                    <div style="display:flex;gap:8px;margin-top:8px;">
                        <input type="text" id="vibeTrackBPM" placeholder="BPM" style="flex:1;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-size:0.85rem;box-sizing:border-box;">
                        <input type="text" id="vibeTrackKey" placeholder="Key" style="flex:1;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-size:0.85rem;box-sizing:border-box;">
                        <button onclick="updateVibeNowPlaying()" style="padding:10px 20px;background:#D4A017;color:#0D0D1A;border:none;border-radius:8px;font-weight:700;font-size:0.85rem;cursor:pointer;white-space:nowrap;">Update</button>
                    </div>
                </div>

                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;">
                    <div style="font-size:0.9rem;font-weight:700;color:#FFE082;margin-bottom:12px;">Song Requests</div>
                    <div id="vibeRequests" style="color:rgba(255,255,255,0.4);font-size:0.82rem;">No requests yet.</div>
                </div>

                <button onclick="endVibeSession()" style="width:100%;padding:14px;border-radius:12px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);color:#EF4444;font-weight:700;font-size:0.85rem;cursor:pointer;">End Session</button>
            </div>
        </div>`;
}

function startVibeSession() {
    fetch('/api/vibe/create', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ dj_name: (sbmProfile || {}).display_name || 'DJ' })
    }).then(function(r) { return r.json(); }).then(function(data) {
        vibeSessionCode = data.code;
        document.getElementById('vibeControls').style.display = 'none';
        document.getElementById('vibeSession').style.display = 'block';
        var url = window.location.origin + '/vibe/' + data.code;
        document.getElementById('vibeJoinURL').textContent = url;
        // Start polling requests
        setInterval(pollVibeRequests, 5000);
        sbmToast('Session started! Share the link with your audience.', 'success');
    }).catch(function() {
        sbmToast('Failed to start session', 'error');
    });
}

function copyVibeLink() {
    var url = document.getElementById('vibeJoinURL').textContent;
    navigator.clipboard.writeText(url).then(function() {
        sbmToast('Link copied!', 'success');
    }).catch(function() {
        sbmToast('Copy failed — select and copy manually', 'info');
    });
}

function updateVibeNowPlaying() {
    if (!vibeSessionCode) return;
    var title = document.getElementById('vibeTrackTitle').value.trim();
    if (!title) { sbmToast('Enter a track title', 'error'); return; }
    fetch('/api/vibe/' + vibeSessionCode + '/now-playing', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            title: title,
            artist: document.getElementById('vibeTrackArtist').value.trim(),
            bpm: document.getElementById('vibeTrackBPM').value.trim(),
            key: document.getElementById('vibeTrackKey').value.trim()
        })
    }).then(function(r) { return r.json(); }).then(function() {
        sbmToast('Now playing updated', 'success');
        document.getElementById('vibeTrackTitle').value = '';
        document.getElementById('vibeTrackArtist').value = '';
        document.getElementById('vibeTrackBPM').value = '';
        document.getElementById('vibeTrackKey').value = '';
    }).catch(function() {
        sbmToast('Update failed', 'error');
    });
}

function pollVibeRequests() {
    if (!vibeSessionCode) return;
    fetch('/api/vibe/' + vibeSessionCode + '/requests')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var container = document.getElementById('vibeRequests');
            if (!container) return;
            var reqs = data.requests || [];
            if (reqs.length === 0) { container.innerHTML = 'No requests yet.'; return; }
            container.innerHTML = reqs.map(function(r) {
                var statusColor = r.status === 'approved' ? '#22c55e' : r.status === 'denied' ? '#EF4444' : '#D4A017';
                var statusLabel = r.status === 'pending' ? 'Pending' : r.status.charAt(0).toUpperCase() + r.status.slice(1);
                var actions = r.status === 'pending'
                    ? '<div style="display:flex;gap:4px;margin-top:6px;">' +
                        '<button onclick="respondVibeRequest(' + r.id + ',\'approved\')" style="padding:6px 12px;border-radius:6px;border:none;background:#22c55e;color:#0D0D1A;font-weight:700;font-size:0.7rem;cursor:pointer;">Play</button>' +
                        '<button onclick="respondVibeRequest(' + r.id + ',\'denied\')" style="padding:6px 12px;border-radius:6px;border:none;background:rgba(239,68,68,0.2);color:#EF4444;font-weight:600;font-size:0.7rem;cursor:pointer;">Skip</button>' +
                      '</div>'
                    : '';
                return '<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                        '<div><span style="color:#fff;font-size:0.85rem;font-weight:600;">' + r.song + '</span>' +
                            '<span style="color:rgba(255,255,255,0.3);font-size:0.7rem;margin-left:8px;">from ' + r.from + '</span></div>' +
                        '<span style="font-size:0.65rem;color:' + statusColor + ';font-weight:700;text-transform:uppercase;">' + statusLabel + '</span>' +
                    '</div>' + actions + '</div>';
            }).join('');
        });
}

function respondVibeRequest(reqId, status) {
    if (!vibeSessionCode) return;
    fetch('/api/vibe/' + vibeSessionCode + '/requests/' + reqId, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ status: status })
    }).then(function() {
        pollVibeRequests();
    });
}

function endVibeSession() {
    if (!vibeSessionCode) return;
    fetch('/api/vibe/' + vibeSessionCode + '/end', { method: 'POST' })
        .then(function() {
            vibeSessionCode = null;
            document.getElementById('vibeControls').style.display = 'block';
            document.getElementById('vibeSession').style.display = 'none';
            sbmToast('Session ended', 'info');
        });
}

/* ===== SAMPLE SAVER ===== */
function buildSampleSaverExperience(name, modeName) {
    return `
        <div class="experience-title">
            <h2>${modeName}</h2>
            <p>Record samples from your phone. Auto-ID tracks. Weekly re-checks.</p>
        </div>
        <div style="width:100%;max-width:600px;">

            <!-- Record -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;text-align:center;">
                <div style="font-size:0.9rem;font-weight:700;color:#FFE082;margin-bottom:16px;">🎙️ Record a Sample</div>
                <button id="sampleRecordBtn" onclick="toggleSampleRecord()" style="width:80px;height:80px;border-radius:50%;border:3px solid #EF4444;background:transparent;color:#EF4444;font-size:2rem;cursor:pointer;transition:all 0.3s;">⏺</button>
                <div id="sampleRecordStatus" style="margin-top:8px;font-size:0.75rem;color:#666;">Tap to start recording</div>
                <div style="display:flex;gap:8px;margin-top:12px;justify-content:center;">
                    <input type="text" id="sampleTag" placeholder="Tag (vibe, BPM guess, location...)" style="flex:1;max-width:250px;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#fff;font-size:0.8rem;box-sizing:border-box;">
                </div>
            </div>

            <!-- Upload -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;">
                <div style="font-size:0.9rem;font-weight:700;color:#FFE082;margin-bottom:12px;">📁 Or Upload a Sample</div>
                <label style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:rgba(212,160,23,0.15);border:1px dashed rgba(212,160,23,0.3);border-radius:12px;cursor:pointer;color:#D4A017;font-size:0.8rem;font-weight:600;">
                    <input type="file" accept="audio/*" onchange="handleSampleUpload(this.files[0])" style="display:none;">
                    + Choose Audio File
                </label>
            </div>

            <!-- Saved Samples -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <div style="font-size:0.9rem;font-weight:700;color:#FFE082;">💾 Saved Samples</div>
                    <button onclick="recheckSamples()" style="padding:6px 14px;background:rgba(212,160,23,0.15);border:1px solid rgba(212,160,23,0.3);border-radius:8px;color:#D4A017;font-size:0.7rem;font-weight:600;cursor:pointer;">Re-check All</button>
                </div>
                <div id="sampleList" style="color:#666;font-size:0.8rem;">No samples yet. Record or upload to get started.</div>
            </div>
        </div>`;
}

var sampleMediaRecorder = null;
var sampleChunks = [];

function toggleSampleRecord() {
    var btn = document.getElementById('sampleRecordBtn');
    var status = document.getElementById('sampleRecordStatus');
    if (sampleMediaRecorder && sampleMediaRecorder.state === 'recording') {
        sampleMediaRecorder.stop();
        btn.style.borderColor = '#EF4444';
        btn.style.color = '#EF4444';
        btn.textContent = '⏺';
        status.textContent = 'Processing...';
        return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
        sampleChunks = [];
        sampleMediaRecorder = new MediaRecorder(stream);
        sampleMediaRecorder.ondataavailable = function(e) { sampleChunks.push(e.data); };
        sampleMediaRecorder.onstop = function() {
            stream.getTracks().forEach(function(t) { t.stop(); });
            var blob = new Blob(sampleChunks, { type: 'audio/webm' });
            var tag = document.getElementById('sampleTag').value.trim() || 'Untitled';
            status.textContent = 'Saved! Running ID check...';
            saveSampleLocally(blob, tag);
        };
        sampleMediaRecorder.start();
        btn.style.borderColor = '#22c55e';
        btn.style.color = '#22c55e';
        btn.textContent = '⏹';
        status.textContent = 'Recording... tap to stop';
    }).catch(function() {
        status.textContent = 'Microphone access denied';
    });
}

function handleSampleUpload(file) {
    if (!file) return;
    var tag = file.name.replace(/\.[^.]+$/, '');
    saveSampleLocally(file, tag);
}

function saveSampleLocally(blob, tag) {
    var samples = JSON.parse(localStorage.getItem('sbm_samples') || '[]');
    var reader = new FileReader();
    reader.onload = function() {
        samples.push({
            id: Date.now(),
            tag: tag,
            date: new Date().toISOString().split('T')[0],
            status: 'no_id',
            match: null,
            size: blob.size
        });
        localStorage.setItem('sbm_samples', JSON.stringify(samples));
        renderSampleList();
        sbmToast('Sample saved: ' + tag, 'success');
    };
    reader.readAsDataURL(blob);
}

function renderSampleList() {
    var container = document.getElementById('sampleList');
    if (!container) return;
    var samples = JSON.parse(localStorage.getItem('sbm_samples') || '[]');
    if (samples.length === 0) {
        container.innerHTML = '<div style="color:#666;font-size:0.8rem;">No samples yet. Record or upload to get started.</div>';
        return;
    }
    container.innerHTML = samples.map(function(s) {
        var statusBadge = s.status === 'matched'
            ? '<span style="color:#22c55e;font-size:0.65rem;font-weight:700;">MATCHED</span>'
            : '<span style="color:#F59E0B;font-size:0.65rem;font-weight:700;">NO ID</span>';
        return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">' +
            '<div style="font-size:1rem;">🎵</div>' +
            '<div style="flex:1;">' +
                '<div style="font-size:0.8rem;color:#fff;font-weight:600;">' + s.tag + '</div>' +
                '<div style="font-size:0.65rem;color:#666;">' + s.date + '</div>' +
            '</div>' +
            statusBadge +
            (s.match ? '<div style="font-size:0.7rem;color:#D4A017;">' + s.match + '</div>' : '') +
        '</div>';
    }).join('');
}

function recheckSamples() {
    sbmToast('Re-checking all samples against AudD + 1001 Tracklists...', 'info');
    fetch('/api/scheduler/track-id-check', { method: 'POST', headers: { 'X-Crew-Token': localStorage.getItem('sbmToken') || '' } })
    .then(function(r) { return r.json(); })
    .then(function(d) { sbmToast('Re-check complete: ' + (d.matches || 0) + ' new matches', d.matches > 0 ? 'success' : 'info'); })
    .catch(function() { sbmToast('Re-check scheduled — results will appear next time you open Samples.', 'info'); });
}

/* ===== STATUS BOARD ===== */
var _sbmBoard = {
    sections: [
        {
            title: "NEXT UP — BUILD THESE",
            color: "#1DB954",
            items: [
                {id:"n1", text:"Vibe Check v2 — QR codes + audience voting", done:false,
                 steps:["Add QR code generation (qrcode.js, client-side) so audience scans from DJ screen","Audience can upvote/downvote song requests — most popular float to top","DJ sees ranked request queue sorted by votes","Add 'now playing' history with timestamps for set documentation"]},
                {id:"n2", text:"Serato Deep Integration — read the actual library", done:false,
                 steps:["Parse Serato _Serato_ database folder from USB or laptop path","Extract full track library: title, artist, BPM, key, cue points, play count","Import into SBM as a browseable collection","Detect played tracks during live sets from Serato's history","Auto-feed played tracks into Vibe Check 'now playing'"]},
                {id:"n3", text:"AI Generate v2 — better models + preview player", done:false,
                 steps:["Current: HuggingFace MusicGen (503 cold starts) + Replicate stable-audio","Add audio preview player so you hear it before downloading","Try newer models: MusicGen-Large, Stable Audio 2.0","Add style presets: 'deep house', 'techno', 'ambient', 'hip-hop beat'","Save generated tracks to library with metadata"]},
                {id:"n4", text:"Mix Recorder — record DJ mixes in-browser", done:false,
                 steps:["Use Web Audio API + MediaRecorder to capture mic/line-in","Real-time waveform display during recording","Auto-detect track boundaries using silence detection","Tag transitions with BPM/key data from Serato import","Export as WAV/MP3 with embedded metadata"]},
                {id:"n5", text:"Stems v2 — batch processing + better UI", done:false,
                 steps:["Current: one track at a time through Replicate demucs","Add batch queue — drop multiple tracks, process sequentially","Preview individual stems in-browser before downloading","Add remix mode: mute/solo/volume per stem in real time","Save stem sets to library for later use"]},
            ]
        },
        {
            title: "MAKE IT BETTER",
            color: "#F59E0B",
            items: [
                {id:"s1", text:"J.A.W. improvements — smarter music AI assistant", done:false,
                 steps:["Feed J.A.W. your Spotify/Tidal library for personalized suggestions","Add context: 'I'm playing a deep house set at 124 BPM' and get track recs","Connect to Beatport for purchase links on suggested tracks","Let J.A.W. build playlists directly into your Spotify/Tidal"]},
                {id:"s2", text:"Discovery engine — better recommendation algorithm", done:false,
                 steps:["Current: Azure OpenAI generates suggestions based on prompt","Add audio analysis: BPM, key, energy level matching","Cross-reference with Spotify audio features API","Build a 'similar to this track' search that actually works","Save discovery sessions so you can revisit them"]},
                {id:"s3", text:"EPK (Press Kit) — export + share", done:false,
                 steps:["Current: builds EPK page in-app","Add PDF export for booking agents","Add shareable public URL (simple-balance-demo.onrender.com/epk/peter)","Include embedded audio player with top tracks","Add event history pulled from Casa Events"]},
                {id:"s4", text:"Live Audit improvements — deeper playlist analysis", done:false,
                 steps:["Add BPM flow graph — show energy arc of the set","Key compatibility check between consecutive tracks","Flag clashing keys or BPM jumps > 8","Compare against 1001 Tracklists for track ID verification","Export audit report as PDF"]},
                {id:"s5", text:"Mobile experience — PWA + offline", done:false,
                 steps:["Add proper manifest.json + service worker for PWA install","Offline access to library, saved stems, generated tracks","Push notifications for completed stem processing","Responsive touch targets across all tools","'Add to Home Screen' prompt on first mobile visit"]},
            ]
        },
        {
            title: "INTEGRATIONS TO ADD",
            color: "#C084FC",
            items: [
                {id:"i1", text:"Beatport — charts, purchase links, track metadata", done:false,
                 steps:["Beatport has a partner API (apply at beatport.com/developers)","Pull top charts by genre for Discovery recommendations","Add purchase links when J.A.W. recommends a track","Import Beatport collection if user connects account"]},
                {id:"i2", text:"Ticketmaster / Eventbrite — find gigs to play", done:false,
                 steps:["Search venues by location and genre","Find open slots, promoter contacts","Track upcoming events you're booked for","Auto-populate Casa Events calendar from bookings"]},
                {id:"i3", text:"SoundCloud — upload mixes + tracks", done:false,
                 steps:["OAuth connect to SoundCloud account","Upload generated tracks or recorded mixes directly","Pull play counts and comments back into SBM dashboard","Share links from within the app"]},
                {id:"i4", text:"Rekordbox / Traktor import — not just Serato", done:false,
                 steps:["Rekordbox uses an SQLite database (rekordbox.db)","Traktor uses NML (XML) collection files","Parse both formats same as Serato","Auto-detect which DJ software the user has"]},
            ]
        },
        {
            title: "BIG PICTURE",
            color: "#818cf8",
            items: [
                {id:"b1", text:"Multi-user — let other DJs sign up and use it", done:false,
                 steps:["Supabase auth already exists — extend registration flow","Each user gets their own library, stems, sets, EPK","Admin panel for Peter to manage users","Free tier with limits, Pro tier for full access"]},
                {id:"b2", text:"Collaborative sets — co-build playlists with other DJs", done:false,
                 steps:["Invite another DJ to collaborate on a set","Both add tracks, reorder, annotate transitions","Real-time sync like Google Docs","Export final setlist to both users' libraries"]},
                {id:"b3", text:"Analytics dashboard — know your music", done:false,
                 steps:["Track most played genres, BPM ranges, keys","Show set duration trends, peak energy moments","Compare your library against trending charts","Monthly digest: 'You played 47 sets, avg 2.1 hours, top genre: tech house'"]},
                {id:"b4", text:"Monetization — premium features for paying DJs", done:false,
                 steps:["Free: basic library, J.A.W. (limited), Vibe Check","Pro ($14.99/mo): unlimited stems, batch processing, AI generate, full analytics","Add Stripe checkout","Landing page with feature comparison"]},
            ]
        }
    ]
};

function buildStatusBoardExperience(name, modeName) {
    return '<div class="experience-container" style="max-width:600px;margin:0 auto;">' +
        '<div class="experience-title">' +
        '<h2 style="color:#1DB954;">Status Board</h2>' +
        '<p>What we\'re building, what needs doing, and where to go.</p>' +
        '</div>' +
        '<div id="sbmBoardContent"></div>' +
    '</div>';
}

function initSBMBoard() {
    var container = document.getElementById('sbmBoardContent');
    if (!container) return;
    var checked = JSON.parse(localStorage.getItem('sbmBoardChecked') || '{}');

    var html = '';
    _sbmBoard.sections.forEach(function(section) {
        html += '<div style="margin-bottom:20px;">';
        html += '<div style="font-size:13px;font-weight:800;color:' + section.color + ';letter-spacing:1px;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid ' + section.color + '33;">' + section.title + '</div>';

        section.items.forEach(function(item) {
            var isChecked = checked[item.id] || false;
            var checkStyle = isChecked ? 'text-decoration:line-through;opacity:0.4;' : '';
            html += '<div style="margin-bottom:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px 12px;">';

            html += '<div style="display:flex;align-items:flex-start;gap:10px;">';
            html += '<input type="checkbox" ' + (isChecked ? 'checked' : '') + ' onchange="toggleSBMBoardItem(\'' + item.id + '\',this)" style="width:18px;height:18px;accent-color:' + section.color + ';cursor:pointer;flex-shrink:0;margin-top:1px;">';
            html += '<div style="flex:1;min-width:0;">';
            html += '<div style="font-size:13px;font-weight:600;color:#fff;' + checkStyle + '">' + item.text + '</div>';

            if (item.steps && item.steps.length) {
                html += '<div style="margin-top:6px;padding-left:4px;">';
                item.steps.forEach(function(step, idx) {
                    html += '<div style="font-size:11px;color:rgba(255,255,255,0.45);padding:2px 0;display:flex;gap:6px;">';
                    html += '<span style="color:' + section.color + ';font-weight:700;flex-shrink:0;">' + (idx+1) + '.</span>';
                    html += '<span>' + step + '</span>';
                    html += '</div>';
                });
                html += '</div>';
            }

            if (item.link) {
                html += '<a href="' + item.link + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;font-size:11px;color:' + section.color + ';text-decoration:none;font-weight:700;padding:3px 10px;border:1px solid ' + section.color + '44;border-radius:5px;background:' + section.color + '11;">' + (item.linkLabel || 'Open') + ' &rarr;</a>';
            }

            html += '</div></div>';
            html += '</div>';
        });

        html += '</div>';
    });

    html += '<div style="text-align:center;font-size:10px;color:rgba(255,255,255,0.2);margin-top:16px;">Last code update: March 7, 2026 | Check states saved in your browser</div>';
    container.innerHTML = html;
}

function toggleSBMBoardItem(id, checkbox) {
    var checked = JSON.parse(localStorage.getItem('sbmBoardChecked') || '{}');
    checked[id] = checkbox.checked;
    localStorage.setItem('sbmBoardChecked', JSON.stringify(checked));
    initSBMBoard();
}
