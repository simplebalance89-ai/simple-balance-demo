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
                    <option value="8">8s</option>
                    <option value="15">15s</option>
                    <option value="30">30s</option>
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
