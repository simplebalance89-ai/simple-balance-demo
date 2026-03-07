import os
import time
import json
import secrets
import logging
import subprocess
import tempfile
import httpx
import replicate
from urllib.parse import urlencode
import asyncio
from fastapi import FastAPI, UploadFile, File, HTTPException, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from openai import AzureOpenAI
from auth import get_current_user
from db import get_supabase

logger = logging.getLogger(__name__)

_SERVER_START_TIME = time.time()

app = FastAPI(title="Simple Balance Music")

# ── YouTube Cookies (decoded from env var at startup) ─────────────────────────
COOKIES_PATH = "/tmp/yt_cookies.txt"

def _init_youtube_cookies():
    """Decode base64 YOUTUBE_COOKIES env var to a file for yt-dlp."""
    import base64
    raw = os.environ.get("YOUTUBE_COOKIES", "")
    if not raw:
        return
    try:
        decoded = base64.b64decode(raw)
        with open(COOKIES_PATH, "wb") as f:
            f.write(decoded)
        logger.info("YouTube cookies written to %s (%d bytes)", COOKIES_PATH, len(decoded))
    except Exception as e:
        logger.error("Failed to decode YOUTUBE_COOKIES: %s", e)

_init_youtube_cookies()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.endswith(".html"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


def get_secret(key, default=""):
    return os.environ.get(key, default)


# ── Azure OpenAI ──────────────────────────────────────────────────────────────

def get_ai_client():
    endpoint = get_secret("AZURE_OPENAI_ENDPOINT")
    key = get_secret("AZURE_OPENAI_KEY")
    if not endpoint or not key:
        return None
    return AzureOpenAI(azure_endpoint=endpoint, api_key=key, api_version="2024-12-01-preview")


# ── JAW System Prompt (2026 Unified Build) ────────────────────────────────────

JAW_SYSTEM_PROMPT = """You are J.A.W. (Just Add Wax) — the personal DJ intelligence and melodic techno discovery engine for Simple Balance Music.

## CORE IDENTITY
- Role: Track digging advisor, set builder, harmonic mixing guide, energy flow guardian
- Workflow: Serato DJ Pro (2-channel) + Tidal streaming
- Sound era focus: 2023–2026 Cinematic / Hybrid Melodic Techno
- Tone: Knowledgeable, direct, music-obsessed. You talk like a DJ who lives in the booth.

## SOUND ARCHITECTURE (2026 Tier System)

### Tier 1 — Core Modern Sound (2025–2026) 🔥
Artists: Son of Son, Aladag, HNTR, Fezzo, Ivory (IT), Oppaacha
Labels: Running Clouds, Oddity Records, Siona Records, Radikon, Eklektisch, Atlant, Monaberry, Frau Blau, Frequenza Black, Scenarios
Profile: Cinematic tension, midrange drive, club-ready 4–6 min edits, emotional breakdowns, 122–126 BPM, peak-driving energy

### Tier 2 — Transitional Bridge (2023–2024) 🌗
Artists: Rafael Cerato, Dyzen, 8Kays, Argy, Fideles, Township Rebellion, Solee
Labels: Oddity, Radikon, Atlant, Parquet
Use: Blending Afterlife-era melodic with modern hybrid techno, journey-building sets, 121–125 BPM

### Tier 3 — Legacy Era (2019–2023 Afterlife Wave) 🌊
Artists: Massano, Colyn, Anyma, Innellea, Adriatique, Mind Against, Tale Of Us, Kevin de Vries
Labels: Afterlife, Innervisions, Einmusika, Diynamic, Anjunadeep, Stil Vor Talent
Use: Emotional nostalgia moments, closing or sunrise sets, 120–125 BPM

## HARMONIC MIXING (Camelot System)
- Same key = perfect match
- ±1 on Camelot wheel = harmonic transition
- Relative major/minor (e.g., 8A ↔ 8B) = smooth mood shift
- +7 on Camelot wheel = energy lift
Always provide both Camelot code AND open key notation (e.g., "8A / Am").

## ENERGY CURVE (Set Structure)
- 118–121 BPM → Hypnotic / Warm-up
- 122–125 BPM → Driving / Build
- 125–128 BPM → Emotional peak / Main room
Arc: Warm → Fezzo/Ivory, Drive → Aladag/HNTR, Peak → Son of Son/Oppaacha
Dominant key range: 1A–8A on Camelot wheel.

## CRATE ORGANIZATION
Energy crates: Warm-Up | Build | Peak | Closing
Key crates: 1A–3A | 4A–6A | 7A–9A | 10A–12A
Label crates: Afterlife | Innervisions | Running Clouds | Oddity | Siona

## TRACK RECOMMENDATION FORMAT
When recommending tracks, ALWAYS include:
- Artist — Title
- Label
- BPM
- Camelot code + Open Key (e.g., "8A / Am")
- Energy level (1-10)
- Tier (1/2/3)
- Why it fits the context

## AVOID RECOMMENDING
- Industrial techno, big room EDM, minimal-only tracks
- 8+ min marathon cuts (unless specifically requested)
- Anything outside the melodic/progressive/deep house spectrum

## DJ WATCHLIST (Priority Names)
Weekly scan artists: Vintage Culture, Solomun, Adriatique, Magdalena, Kevin de Vries, Miss Monique
If a track appears in 2+ DJ charts → Watchlist. 3+ sources → Rising Priority.

Be concise, practical, and music-first. Every recommendation should be mixable and club-tested."""


# ── URL Audio Extraction ──────────────────────────────────────────────────────

def _yt_dlp_base_args():
    """Common yt-dlp args. Adds --cookies if YouTube cookies file exists."""
    args = ["yt-dlp"]
    if os.path.isfile(COOKIES_PATH):
        args += ["--cookies", COOKIES_PATH]
    return args


def extract_audio_url(url: str) -> dict:
    """Use yt-dlp to extract a direct audio stream URL from YouTube/SoundCloud/Mixcloud.
    Returns dict with audio_url, title, uploader, duration, thumbnail or error."""
    try:
        cmd = _yt_dlp_base_args() + [
            "--no-download",
            "--print-json",
            "-f", "bestaudio/best",
            "--no-playlist",
            "--no-warnings",
            "--extractor-args", "youtube:player_client=android",
            "--geo-bypass",
            url,
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            lower = stderr.lower()
            if "sign in to confirm your age" in lower or "age-restricted" in lower or "age-gated" in lower:
                return {"error": "Age-restricted content. Try a different link."}
            logger.error("yt-dlp failed for %s: %s", url, stderr[:500])
            return {"error": f"yt-dlp failed: {stderr[:300]}"}

        info = json.loads(result.stdout)
        return {
            "audio_url": info.get("url"),
            "title": info.get("title", "Unknown"),
            "uploader": info.get("uploader", info.get("channel", "Unknown")),
            "duration": info.get("duration", 0),
            "thumbnail": info.get("thumbnail"),
        }
    except subprocess.TimeoutExpired:
        return {"error": "URL extraction timed out (30s). Try a shorter video."}
    except json.JSONDecodeError:
        return {"error": "Failed to parse video metadata."}
    except FileNotFoundError:
        return {"error": "yt-dlp not installed on server."}
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/chat")
async def chat(payload: dict):
    """AI chat endpoint for JAW DJ Command and other modes."""
    client = get_ai_client()
    if not client:
        return JSONResponse({"error": "Azure OpenAI not configured"}, status_code=503)

    model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")
    system_prompt = payload.get("system", JAW_SYSTEM_PROMPT)
    messages = payload.get("messages", [])

    api_messages = [{"role": "system", "content": system_prompt}]
    api_messages.extend(messages)

    try:
        response = client.chat.completions.create(
            model=model, messages=api_messages, temperature=0.4
        )
        return {"response": response.choices[0].message.content}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Audio Download (YouTube/SoundCloud/Mixcloud → MP3) ───────────────────────

_download_jobs = {}  # {job_id: {status, metadata, file_path, error, started_at}}

# ── Job History (for admin dashboard) ────────────────────────────────────────
_job_history = []  # max 100 entries, FIFO


def _record_job_history(job_type: str, job_id: str, status: str, metadata: dict | None = None,
                        error: str | None = None, started_at: float = 0, **extras):
    """Record a completed/failed job for admin visibility."""
    entry = {
        "type": job_type,
        "job_id": job_id,
        "status": status,
        "title": (metadata or {}).get("title", "Unknown"),
        "error": error,
        "elapsed": round(time.time() - started_at) if started_at else 0,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    entry.update(extras)
    _job_history.append(entry)
    if len(_job_history) > 100:
        _job_history.pop(0)


async def _run_download_job(job_id: str, url: str):
    """Background coroutine: download audio via yt-dlp and convert to mp3."""
    job = _download_jobs[job_id]
    tmp_dir = "/tmp"

    try:
        # Step 1: Extract metadata
        job["status"] = "extracting"
        info = extract_audio_url(url)
        if "error" in info:
            job["status"] = "failed"
            job["error"] = info["error"]
            _record_job_history("download", job_id, "failed", error=info["error"], started_at=job["started_at"])
            return

        title = info.get("title", "audio")
        # Sanitize filename
        safe_title = "".join(c if c.isalnum() or c in " -_" else "" for c in title).strip()[:80] or "audio"
        job["metadata"] = {
            "title": title,
            "safe_title": safe_title,
            "uploader": info.get("uploader", "Unknown"),
            "duration": info.get("duration", 0),
            "thumbnail": info.get("thumbnail"),
        }

        # Step 2: Download + convert to mp3 via yt-dlp
        job["status"] = "downloading"
        out_path = os.path.join(tmp_dir, f"dl_{job_id}.mp3")

        dl_cmd = _yt_dlp_base_args() + [
            "-f", "bestaudio/best",
            "--no-playlist",
            "--no-warnings",
            "--extractor-args", "youtube:player_client=android",
            "--geo-bypass",
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "-o", os.path.join(tmp_dir, f"dl_{job_id}.%(ext)s"),
            url,
        ]
        dl_result = subprocess.run(
            dl_cmd,
            capture_output=True, text=True, timeout=600,
        )

        if dl_result.returncode != 0:
            job["status"] = "failed"
            job["error"] = f"Download failed: {dl_result.stderr.strip()[:300]}"
            _record_job_history("download", job_id, "failed", job["metadata"], job["error"], job["started_at"])
            return

        # yt-dlp may output as .mp3 directly or we need to find the file
        import glob as glob_mod
        matches = glob_mod.glob(os.path.join(tmp_dir, f"dl_{job_id}.*"))
        if not matches:
            job["status"] = "failed"
            job["error"] = "Download completed but no file found."
            _record_job_history("download", job_id, "failed", job["metadata"], job["error"], job["started_at"])
            return

        job["file_path"] = matches[0]
        job["status"] = "done"
        file_size = os.path.getsize(matches[0])
        logger.info("Download complete: %s (%.1f MB)", safe_title, file_size / 1024 / 1024)
        _record_job_history("download", job_id, "done", job["metadata"], started_at=job["started_at"],
                            file_size=f"{file_size / 1024 / 1024:.1f} MB")

    except subprocess.TimeoutExpired:
        job["status"] = "failed"
        job["error"] = "Download timed out (10 min). Try a shorter video."
        _record_job_history("download", job_id, "failed", job.get("metadata"), job["error"], job["started_at"])
    except Exception as e:
        logger.error("Download job %s failed: %s", job_id, e)
        job["status"] = "failed"
        job["error"] = str(e)
        _record_job_history("download", job_id, "failed", job.get("metadata"), str(e), job["started_at"])


@app.post("/api/download/audio")
async def download_audio_start(payload: dict):
    """Submit a URL for audio download. Returns job_id for polling."""
    url = (payload.get("url") or "").strip()
    if not url:
        return JSONResponse({"error": "No URL provided"}, status_code=400)

    job_id = secrets.token_urlsafe(12)
    _download_jobs[job_id] = {
        "status": "queued",
        "metadata": None,
        "file_path": None,
        "error": None,
        "started_at": time.time(),
    }
    asyncio.create_task(_run_download_job(job_id, url))
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/download/audio/status/{job_id}")
async def download_audio_status(job_id: str):
    """Poll for download job status."""
    job = _download_jobs.get(job_id)
    if not job:
        return JSONResponse({"error": "Job not found"}, status_code=404)

    elapsed = round(time.time() - job["started_at"])
    response = {
        "status": job["status"],
        "elapsed_seconds": elapsed,
        "metadata": job["metadata"],
    }

    if job["status"] == "done":
        response["download_url"] = f"/api/download/audio/file/{job_id}"
    elif job["status"] == "failed":
        response["error"] = job["error"]

    # Clean up stale jobs (file + entry) after 10 minutes
    if elapsed > 600 and job["status"] in ("done", "failed"):
        if job.get("file_path") and os.path.exists(job["file_path"]):
            try:
                os.remove(job["file_path"])
            except OSError:
                pass
        _download_jobs.pop(job_id, None)

    return response


@app.get("/api/download/audio/file/{job_id}")
async def download_audio_file(job_id: str):
    """Serve the downloaded audio file. Auto-cleans after serving."""
    job = _download_jobs.get(job_id)
    if not job or job["status"] != "done" or not job.get("file_path"):
        return JSONResponse({"error": "File not ready or not found"}, status_code=404)

    file_path = job["file_path"]
    if not os.path.exists(file_path):
        return JSONResponse({"error": "File expired"}, status_code=410)

    safe_title = job.get("metadata", {}).get("safe_title", "audio")
    filename = f"{safe_title}.mp3"

    def iterfile():
        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                yield chunk
        # Clean up after streaming
        try:
            os.remove(file_path)
        except OSError:
            pass
        _download_jobs.pop(job_id, None)

    return StreamingResponse(
        iterfile(),
        media_type="audio/mpeg",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── AudD Mix Digestor ─────────────────────────────────────────────────────────

AUDD_API_URL = "https://enterprise.audd.io/"
MUSICGEN_MODEL = "meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedbd"


def format_timestamp(seconds):
    if isinstance(seconds, str) and ':' in seconds:
        return seconds
    seconds = int(float(seconds))
    if seconds >= 3600:
        h = seconds // 3600
        m = (seconds % 3600) // 60
        s = seconds % 60
        return f"{h}:{m:02d}:{s:02d}"
    else:
        m = seconds // 60
        s = seconds % 60
        return f"{m:02d}:{s:02d}"


def parse_enterprise_result(results):
    if not results:
        return {"tracks": [], "raw_matches": 0}

    seen_tracks = {}
    raw_count = len(results)

    for match in results:
        if not match or "songs" not in match or not match["songs"]:
            continue

        song = match["songs"][0]
        offset = match.get("offset", 0)
        artist = song.get("artist", "Unknown")
        title = song.get("title", "Unknown")
        track_key = f"{artist}|{title}".lower()

        spotify_data = song.get("spotify", {})
        spotify_url = None
        album_art = None

        if spotify_data and isinstance(spotify_data, dict):
            spotify_url = spotify_data.get("external_urls", {}).get("spotify")
            album = spotify_data.get("album", {})
            images = album.get("images", [])
            if images:
                album_art = images[0].get("url")

        apple_data = song.get("apple_music", {})
        apple_url = None
        if apple_data and isinstance(apple_data, dict):
            apple_url = apple_data.get("url")

        if track_key not in seen_tracks:
            seen_tracks[track_key] = {
                "artist": artist,
                "title": title,
                "first_offset": offset,
                "offsets": [offset],
                "spotify_url": spotify_url,
                "apple_music_url": apple_url,
                "album_art": album_art,
                "label": song.get("label", ""),
                "album": song.get("album", ""),
            }
        else:
            seen_tracks[track_key]["offsets"].append(offset)

    # Filter: track must appear in 3+ scan windows to be real (removes noise/fragments)
    tracks = [t for t in seen_tracks.values() if len(t.get("offsets", [t["first_offset"]])) >= 3]
    tracks = sorted(tracks, key=lambda t: t["first_offset"])
    for i, track in enumerate(tracks):
        track["position"] = i + 1
        track["timestamp"] = format_timestamp(track["first_offset"])
        track.pop("offsets", None)

    return {"tracks": tracks, "raw_matches": raw_count, "unique_tracks": len(tracks)}


# ── Chunked AudD Scanning ────────────────────────────────────────────────────
CHUNK_DURATION = 300   # 5 minutes per chunk
CHUNK_CONCURRENCY = 3  # max parallel AudD calls


def _split_audio_chunks(audio_path: str, chunk_secs: int = CHUNK_DURATION) -> list:
    """Split audio file into chunks using ffmpeg. Returns list of (chunk_path, start_offset_secs)."""
    import glob as glob_mod
    base = os.path.splitext(audio_path)[0]
    ext = os.path.splitext(audio_path)[1] or ".mp3"
    pattern = f"{base}_chunk_%03d{ext}"

    result = subprocess.run(
        ["ffmpeg", "-i", audio_path, "-f", "segment", "-segment_time", str(chunk_secs),
         "-c", "copy", "-y", "-loglevel", "error", pattern],
        capture_output=True, text=True, timeout=120,
    )

    if result.returncode != 0:
        logger.error("ffmpeg chunking failed: %s", result.stderr[:500])
        return []

    chunks = sorted(glob_mod.glob(f"{base}_chunk_*{ext}"))
    return [(path, i * chunk_secs) for i, path in enumerate(chunks)]


async def _scan_chunk(chunk_path: str, token: str, offset_secs: int) -> list:
    """Send one audio chunk to AudD, return results with adjusted offsets."""
    data = {
        "api_token": token,
        "accurate_offsets": "true",
        "return": "spotify,apple_music,deezer",
        "skip": "1",
        "every": "3",
    }

    with open(chunk_path, "rb") as f:
        file_data = f.read()

    async with httpx.AsyncClient(timeout=300) as client:
        response = await client.post(
            AUDD_API_URL,
            data=data,
            files={"file": (os.path.basename(chunk_path), file_data, "audio/mpeg")},
        )
        response.raise_for_status()
        result = response.json()

    if "result" not in result or not result["result"]:
        return []

    # Adjust offsets by chunk start time
    for match in result["result"]:
        if "offset" in match:
            match["offset"] = int(float(match["offset"])) + offset_secs

    return result["result"]


async def _scan_audio_chunked(audio_path: str, token: str, progress_cb=None) -> dict:
    """Split audio into chunks, scan each via AudD in parallel, merge results.
    progress_cb(completed, total) called after each chunk finishes."""
    chunks = _split_audio_chunks(audio_path)

    if not chunks:
        # Fallback: scan whole file as single chunk (ffmpeg failed or tiny file)
        logger.info("Chunking failed or unnecessary, scanning whole file")
        chunks = [(audio_path, 0)]

    total = len(chunks)
    logger.info("Scanning %d chunks of %s", total, os.path.basename(audio_path))

    all_results = []
    completed = 0
    sem = asyncio.Semaphore(CHUNK_CONCURRENCY)

    async def scan_one(chunk_path, offset):
        nonlocal completed
        async with sem:
            try:
                results = await _scan_chunk(chunk_path, token, offset)
                return results
            except Exception as e:
                logger.error("Chunk scan failed (%s offset %ds): %s", chunk_path, offset, e)
                return []
            finally:
                completed += 1
                if progress_cb:
                    progress_cb(completed, total)

    tasks = [scan_one(path, offset) for path, offset in chunks]
    chunk_results = await asyncio.gather(*tasks)

    for r in chunk_results:
        all_results.extend(r)

    # Clean up chunk files (but not the original audio)
    for path, _ in chunks:
        if path != audio_path:
            try:
                os.remove(path)
            except OSError:
                pass

    parsed = parse_enterprise_result(all_results)
    parsed["chunks_scanned"] = total
    return parsed


# ── Shazam via Azure OpenAI ───────────────────────────────────────────────────

@app.post("/api/shazam")
async def shazam_identify(file: UploadFile = File(...)):
    """Identify a song from an audio clip using Azure OpenAI gpt-4o audio."""
    import base64 as b64mod

    client = get_ai_client()
    if not client:
        return JSONResponse({"error": "Azure OpenAI not configured"}, status_code=503)

    file_data = await file.read()
    if len(file_data) == 0:
        return JSONResponse({"error": "Empty file"}, status_code=400)
    if len(file_data) > 25 * 1024 * 1024:
        return JSONResponse({"error": "File too large (max 25MB)"}, status_code=400)

    # Determine mime type
    content_type = file.content_type or "audio/mpeg"
    audio_b64 = b64mod.b64encode(file_data).decode()

    model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a music identification expert. Listen to the audio and identify the song. Return JSON with fields: title, artist, album (if known), year (if known), genre, confidence (high/medium/low). If you cannot identify it, return {\"title\": \"Unknown\", \"artist\": \"Unknown\", \"confidence\": \"low\", \"notes\": \"reason\"}."},
                {"role": "user", "content": [
                    {"type": "text", "text": "Identify this song:"},
                    {"type": "input_audio", "input_audio": {"data": audio_b64, "format": content_type.split("/")[-1] if "/" in content_type else "mp3"}}
                ]}
            ],
            temperature=0.1,
            max_tokens=500,
        )
        result_text = resp.choices[0].message.content.strip()
        # Try to parse as JSON
        try:
            if "```json" in result_text:
                result_text = result_text.split("```json")[1].split("```")[0].strip()
            elif "```" in result_text:
                result_text = result_text.split("```")[1].split("```")[0].strip()
            result = json.loads(result_text)
        except json.JSONDecodeError:
            result = {"raw": result_text, "confidence": "low"}
        return {"status": "ok", "result": result, "source": "azure_openai"}
    except Exception as e:
        logger.error(f"Shazam Azure error: {e}")
        # Fallback to AudD if available
        audd_token = get_secret("AUDD_API_TOKEN")
        if audd_token:
            try:
                async with httpx.AsyncClient(timeout=15) as hc:
                    audd_resp = await hc.post(
                        "https://api.audd.io/",
                        data={"api_token": audd_token, "return": "apple_music,spotify"},
                        files={"file": ("clip.mp3", file_data, content_type)},
                    )
                    audd_data = audd_resp.json()
                    if audd_data.get("result"):
                        r = audd_data["result"]
                        return {"status": "ok", "result": {
                            "title": r.get("title", "Unknown"),
                            "artist": r.get("artist", "Unknown"),
                            "album": r.get("album", ""),
                            "year": r.get("release_date", "")[:4] if r.get("release_date") else "",
                            "confidence": "high",
                        }, "source": "audd_fallback"}
            except Exception:
                pass
        return JSONResponse({"error": f"Identification failed: {str(e)}"}, status_code=500)


@app.post("/api/digestor")
async def digestor(file: UploadFile = File(...)):
    """Extract tracklist from uploaded DJ mix via AudD Enterprise."""
    token = get_secret("AUDD_API_TOKEN")
    if not token:
        return JSONResponse({"error": "AudD API token not configured"}, status_code=503)

    file_data = await file.read()
    if len(file_data) == 0:
        return JSONResponse({"error": "Empty file"}, status_code=400)

    # Write to temp file for chunked scanning
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3", dir="/tmp")
    tmp.write(file_data)
    tmp.close()

    try:
        parsed = await _scan_audio_chunked(tmp.name, token)
        return parsed
    except httpx.TimeoutException:
        return JSONResponse({"error": "Request timed out. Mix may be too large.", "tracks": []}, status_code=200)
    except Exception as e:
        return JSONResponse({"error": str(e), "tracks": []}, status_code=500)
    finally:
        try:
            os.remove(tmp.name)
        except OSError:
            pass


# ── YouTube Description Tracklist Extractor ───────────────────────────────────

def _extract_youtube_id(url: str) -> str | None:
    """Extract YouTube video ID from various URL formats."""
    import re as _re
    patterns = [
        r'(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([A-Za-z0-9_-]{11})',
    ]
    for p in patterns:
        m = _re.search(p, url)
        if m:
            return m.group(1)
    return None


async def _try_youtube_description(url: str) -> dict | None:
    """Try to extract tracklist from YouTube video description.
    Returns parsed tracks dict or None if no tracklist found."""
    import re as _re

    video_id = _extract_youtube_id(url)
    if not video_id:
        return None

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Use YouTube's 'next' endpoint (video page data) — less restricted than 'player'
            api_resp = await client.post(
                "https://www.youtube.com/youtubei/v1/next?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
                json={
                    "videoId": video_id,
                    "context": {"client": {"clientName": "WEB", "clientVersion": "2.20240101.00.00"}},
                },
                headers={"Content-Type": "application/json"},
            )
            api_data = api_resp.json()

        # Extract description from structured engagement panels
        raw_desc = ""
        title = ""
        for panel in api_data.get("engagementPanels", []):
            renderer = panel.get("engagementPanelSectionListRenderer", {})
            items = renderer.get("content", {}).get("structuredDescriptionContentRenderer", {}).get("items", [])
            for item in items:
                body = item.get("expandableVideoDescriptionBodyRenderer", {})
                desc_text = body.get("attributedDescriptionBodyText", {}).get("content", "")
                if desc_text:
                    raw_desc = desc_text
                    break
            if raw_desc:
                break

        # Get title from currentVideoEndpoint or playerOverlays
        results = api_data.get("contents", {}).get("twoColumnWatchNextResults", {}).get("results", {}).get("results", {}).get("contents", [])
        for item in results:
            primary = item.get("videoPrimaryInfoRenderer", {})
            title_runs = primary.get("title", {}).get("runs", [])
            if title_runs:
                title = title_runs[0].get("text", "")
                break

        if not raw_desc:
            logger.warning("No description from YouTube next API for %s", video_id)
            return None

        logger.info("YouTube next API: got description (%d chars) for %s", len(raw_desc), video_id)

        # Look for timestamped tracklist lines: "00:00 Artist – Title" or "1. 00:00 Artist - Title"
        track_pattern = _re.compile(
            r'(?:^|\n)\s*(?:\d+[\.\)]\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)',
        )
        matches = track_pattern.findall(raw_desc)
        logger.info("YouTube description: %d timestamp matches for %s", len(matches), video_id)
        if len(matches) < 3:
            # Not enough timestamp lines to be a real tracklist
            return None

        tracks = []
        for i, (timestamp, raw_track) in enumerate(matches):
            raw_track = raw_track.strip()
            # Try to split "Artist – Title" or "Artist - Title"
            parts = _re.split(r'\s*[–—-]\s*', raw_track, maxsplit=1)
            artist = parts[0].strip() if parts else raw_track
            title = parts[1].strip() if len(parts) > 1 else ""

            tracks.append({
                "position": i + 1,
                "timestamp": timestamp,
                "artist": artist,
                "title": title,
                "source": "youtube_description",
            })

        # Get duration + thumbnail from oEmbed (always works from cloud)
        async with httpx.AsyncClient(timeout=10) as client:
            oembed_resp = await client.get(f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json")
            oembed = oembed_resp.json() if oembed_resp.status_code == 200 else {}

        metadata = {
            "title": title or oembed.get("title", "Unknown"),
            "uploader": oembed.get("author_name", "Unknown"),
            "duration": 0,  # oEmbed doesn't provide duration
            "thumbnail": oembed.get("thumbnail_url"),
        }

        return {
            "tracks": tracks,
            "raw_matches": len(matches),
            "unique_tracks": len(tracks),
            "metadata": metadata,
            "source": "youtube_description",
        }

    except Exception as e:
        logger.warning("YouTube description extraction failed: %s", e)
        return None


# ── URL Digest (YouTube / SoundCloud / Mixcloud) ─────────────────────────────
# Strategy:
#   1. YouTube URLs → try description tracklist first (fast, free, works from cloud)
#   2. If no description tracklist → fall back to yt-dlp + AudD audio fingerprinting
#   3. SoundCloud/Mixcloud → yt-dlp + AudD directly

_digest_jobs = {}  # {job_id: {status, metadata, result, error, started_at}}


async def _run_digest_job(job_id: str, url: str):
    """Background coroutine. Strategy:
    1. YouTube with description tracklist → instant free result
    2. YouTube with cookies configured → yt-dlp + AudD fingerprint
    3. YouTube without cookies → error with guidance
    4. SoundCloud/Mixcloud → yt-dlp + AudD directly"""
    job = _digest_jobs[job_id]
    token = get_secret("AUDD_API_TOKEN")
    tmp_path = None
    is_youtube = bool(_extract_youtube_id(url))
    has_cookies = os.path.isfile(COOKIES_PATH)

    try:
        # Strategy 1: YouTube description tracklist (fast path — free bonus)
        if is_youtube:
            job["status"] = "extracting"
            yt_result = await _try_youtube_description(url)
            if yt_result and len(yt_result.get("tracks", [])) >= 3:
                job["metadata"] = yt_result["metadata"]
                job["result"] = yt_result
                job["status"] = "done"
                logger.info("YouTube description tracklist: %s — %d tracks", yt_result["metadata"]["title"], len(yt_result["tracks"]))
                _record_job_history("digest", job_id, "done", yt_result["metadata"], started_at=job["started_at"],
                                    tracks_found=len(yt_result["tracks"]))
                return

            # No description tracklist — try audio fingerprinting if cookies available
            if not has_cookies:
                logger.info("No tracklist in YouTube description and no cookies for %s", url)
                try:
                    async with httpx.AsyncClient(timeout=10) as client:
                        oembed_resp = await client.get(f"https://www.youtube.com/oembed?url={url}&format=json")
                        oembed = oembed_resp.json() if oembed_resp.status_code == 200 else {}
                    job["metadata"] = {
                        "title": oembed.get("title", "Unknown"),
                        "uploader": oembed.get("author_name", "Unknown"),
                        "duration": 0,
                        "thumbnail": oembed.get("thumbnail_url"),
                    }
                except Exception:
                    pass
                job["status"] = "failed"
                job["error"] = "YouTube audio fingerprinting isn't available yet. Try a SoundCloud or Mixcloud link instead — those work instantly. Or upload the audio file directly using the Upload tab."
                _record_job_history("digest", job_id, "failed", job.get("metadata"), job["error"], job["started_at"])
                return
            # Has cookies — fall through to yt-dlp + AudD pipeline
            logger.info("YouTube: no description tracklist, trying audio fingerprint with cookies for %s", url)

        # Strategy 2: yt-dlp + AudD audio fingerprinting (SC/MC always, YT with cookies)
        # Step 1: Extract metadata via yt-dlp (quick, no download)
        job["status"] = "extracting"
        info = extract_audio_url(url)
        if "error" in info:
            job["status"] = "failed"
            job["error"] = info["error"]
            _record_job_history("digest", job_id, "failed", error=info["error"], started_at=job["started_at"])
            return

        job["metadata"] = {
            "title": info.get("title", "Unknown"),
            "uploader": info.get("uploader", info.get("channel", "Unknown")),
            "duration": info.get("duration", 0),
            "thumbnail": info.get("thumbnail"),
        }

        # Step 2: Download audio to temp file via yt-dlp
        job["status"] = "downloading"
        logger.info("Downloading audio: %s", job["metadata"]["title"])
        tmp_dir = "/tmp"
        tmp_template = os.path.join(tmp_dir, f"digest_{job_id}.%(ext)s")

        dl_cmd = _yt_dlp_base_args() + [
            "-f", "bestaudio/best",
            "--no-playlist",
            "--no-warnings",
            "--extractor-args", "youtube:player_client=android",
            "--geo-bypass",
            "-o", tmp_template,
            url,
        ]
        dl_result = subprocess.run(
            dl_cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 min download timeout
        )

        if dl_result.returncode != 0:
            job["status"] = "failed"
            job["error"] = f"Download failed: {dl_result.stderr.strip()[:300]}"
            _record_job_history("digest", job_id, "failed", job["metadata"], job["error"], job["started_at"])
            return

        # Find the downloaded file
        import glob as glob_mod
        matches = glob_mod.glob(os.path.join(tmp_dir, f"digest_{job_id}.*"))
        if not matches:
            job["status"] = "failed"
            job["error"] = "Download completed but no file found."
            _record_job_history("digest", job_id, "failed", job["metadata"], job["error"], job["started_at"])
            return
        tmp_path = matches[0]
        file_size = os.path.getsize(tmp_path)
        logger.info("Downloaded %s (%.1f MB)", tmp_path, file_size / 1024 / 1024)

        # Step 3: Chunked AudD fingerprinting
        job["status"] = "scanning"
        logger.info("AudD chunked scan: %s", job["metadata"]["title"])

        def on_chunk_progress(done, total):
            job["scan_progress"] = f"{done}/{total}"

        parsed = await _scan_audio_chunked(tmp_path, token, progress_cb=on_chunk_progress)

        # Step 4: Finalize
        job["status"] = "parsing"
        parsed["metadata"] = job["metadata"]
        job["result"] = parsed
        job["status"] = "done"
        logger.info("Digest complete: %s — %d tracks from %d chunks",
                     job["metadata"]["title"], len(parsed.get("tracks", [])), parsed.get("chunks_scanned", 1))
        _record_job_history("digest", job_id, "done", job["metadata"], started_at=job["started_at"],
                            tracks_found=len(parsed.get("tracks", [])), chunks=parsed.get("chunks_scanned", 1))

    except subprocess.TimeoutExpired:
        job["status"] = "failed"
        job["error"] = "Audio download timed out (5 min). Try a shorter mix."
        _record_job_history("digest", job_id, "failed", job.get("metadata"), job["error"], job["started_at"])
    except httpx.TimeoutException:
        job["status"] = "failed"
        job["error"] = "AudD processing timed out (15 min). The mix may be too long."
        _record_job_history("digest", job_id, "failed", job.get("metadata"), job["error"], job["started_at"])
    except Exception as e:
        logger.error("Digest job %s failed: %s", job_id, e)
        job["status"] = "failed"
        job["error"] = str(e)
        _record_job_history("digest", job_id, "failed", job.get("metadata"), str(e), job["started_at"])
    finally:
        # Clean up temp file
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@app.post("/api/digest/url")
async def digest_url(payload: dict):
    """Submit a URL for async tracklist extraction. Returns job_id immediately."""
    url = (payload.get("url") or "").strip()
    if not url:
        return JSONResponse({"error": "No URL provided"}, status_code=400)

    token = get_secret("AUDD_API_TOKEN")
    if not token:
        return JSONResponse({"error": "AudD API token not configured"}, status_code=503)

    job_id = secrets.token_urlsafe(12)
    _digest_jobs[job_id] = {
        "status": "queued",
        "metadata": None,
        "result": None,
        "error": None,
        "scan_progress": None,
        "started_at": time.time(),
    }

    # Fire and forget — runs in the event loop background
    asyncio.create_task(_run_digest_job(job_id, url))

    return {"job_id": job_id, "status": "queued"}


@app.get("/api/digest/url/status/{job_id}")
async def digest_url_status(job_id: str):
    """Poll for digest job status. Returns metadata as soon as extraction is done, full results when scanning completes."""
    job = _digest_jobs.get(job_id)
    if not job:
        return JSONResponse({"error": "Job not found"}, status_code=404)

    elapsed = round(time.time() - job["started_at"])
    response = {
        "status": job["status"],
        "elapsed_seconds": elapsed,
        "metadata": job["metadata"],
        "scan_progress": job.get("scan_progress"),
    }

    if job["status"] == "done":
        response["result"] = job["result"]
        # Clean up old jobs (keep for 5 min after completion)
        if elapsed > 300:
            _digest_jobs.pop(job_id, None)
    elif job["status"] == "failed":
        response["error"] = job["error"]

    return response


# ── AI Mastering Analysis ─────────────────────────────────────────────────────

@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    """Analyze an audio file for mastering using Azure OpenAI."""
    client = get_ai_client()
    if not client:
        return JSONResponse({"error": "Azure OpenAI not configured"}, status_code=503)

    filename = file.filename or "unknown.mp3"
    file_data = await file.read()
    file_size_mb = round(len(file_data) / (1024 * 1024), 2)

    model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")

    system_prompt = """You are an expert audio mastering engineer AI. Given an audio filename and file metadata, provide a realistic mastering analysis. Return ONLY valid JSON with this exact structure:
{
  "bpm": <number>,
  "key": "<musical key like F minor, A major, etc>",
  "camelot": "<camelot code like 4A, 8B, etc>",
  "lufs": <number, negative, typical range -6 to -14>,
  "true_peak": <number, negative, typical range -0.1 to -2.0>,
  "dynamic_range": <number, in dB, typical 4-12>,
  "recommendations": [
    "<recommendation 1>",
    "<recommendation 2>",
    "<recommendation 3>",
    "<recommendation 4>"
  ],
  "genre_detected": "<detected genre>",
  "quality_score": <number 1-100>
}
Infer genre, BPM, and key from the filename. If the filename has no useful info, generate plausible values for an electronic music track. Make recommendations specific and actionable."""

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Analyze this audio file for mastering:\nFilename: {filename}\nFile size: {file_size_mb} MB\nContent type: {file.content_type or 'audio/mpeg'}"}
            ],
            temperature=0.3,
            response_format={"type": "json_object"}
        )
        result = json.loads(response.choices[0].message.content)
        result["filename"] = filename
        result["file_size_mb"] = file_size_mb
        return result
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Stem Separation (Replicate Demucs) ───────────────────────────────────────

@app.post("/api/stems")
async def stems(file: UploadFile = File(...)):
    """Separate audio into stems using Replicate Demucs model."""
    token = get_secret("REPLICATE_API_TOKEN")
    if not token:
        return JSONResponse({"error": "Replicate API token not configured"}, status_code=503)

    os.environ["REPLICATE_API_TOKEN"] = token

    file_data = await file.read()
    if len(file_data) == 0:
        return JSONResponse({"error": "Empty file"}, status_code=400)

    filename = file.filename or "track.mp3"
    content_type = file.content_type or "audio/mpeg"

    try:
        import io
        import base64

        # Replicate accepts file URLs or data URIs
        b64 = base64.b64encode(file_data).decode("utf-8")
        data_uri = f"data:{content_type};base64,{b64}"

        output = replicate.run(
            "cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81571db50571f6d7",
            input={"audio": data_uri}
        )

        # Demucs returns a dict with stem URLs
        # Output format: {"bass": url, "drums": url, "other": url, "vocals": url}
        result = {
            "filename": filename,
            "vocals_url": output.get("vocals", ""),
            "drums_url": output.get("drums", ""),
            "bass_url": output.get("bass", ""),
            "other_url": output.get("other", ""),
        }
        return result

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Discovery ─────────────────────────────────────────────────────────────────

@app.post("/api/discovery")
async def discovery(payload: dict):
    """AI-powered music discovery by mood."""
    mood = payload.get("mood", "chill")
    client = get_ai_client()
    if not client:
        return JSONResponse({"error": "Azure OpenAI not configured"}, status_code=503)

    model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")
    system_prompt = (
        "You are a music discovery AI. Given a mood, recommend 6 tracks with artist, title, BPM, key, "
        "and why it fits the mood. Return as JSON array: [{artist, title, bpm, key, reason}]"
    )

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Mood: {mood}"},
            ],
            temperature=0.7,
        )
        content = response.choices[0].message.content
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            cleaned = cleaned.rsplit("```", 1)[0]
        tracks = json.loads(cleaned)
        return {"tracks": tracks}
    except json.JSONDecodeError:
        return {"tracks": [], "raw": content}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Events Radar ──────────────────────────────────────────────────────────────

@app.post("/api/events")
async def events(payload: dict):
    """AI-generated upcoming electronic music events for a city."""
    city = payload.get("city", "Miami")
    client = get_ai_client()
    if not client:
        return JSONResponse({"error": "Azure OpenAI not configured"}, status_code=503)

    model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")
    system_prompt = (
        "You are an electronic music events expert. Given a city, generate 6 realistic upcoming "
        "electronic music events. Return as JSON object: {events: [{name, venue, date, genre, link}]}. "
        "Use realistic venue names and plausible dates in the next 3 months. For link, use '#' as placeholder."
    )

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"City: {city}"},
            ],
            temperature=0.7,
        )
        content = response.choices[0].message.content
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            cleaned = cleaned.rsplit("```", 1)[0]
        result = json.loads(cleaned)
        return result
    except json.JSONDecodeError:
        return {"events": [], "raw": content}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Set Builder ───────────────────────────────────────────────────────────────

@app.post("/api/setbuilder")
async def setbuilder(payload: dict):
    """AI-generated DJ set structure with track suggestions."""
    vibe = payload.get("vibe", "melodic")
    duration = payload.get("duration", "1 hour")
    client = get_ai_client()
    if not client:
        return JSONResponse({"error": "Azure OpenAI not configured"}, status_code=503)

    model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")
    system_prompt = (
        "You are a DJ set architect. Given a vibe and duration, generate a DJ set structure with track "
        "suggestions, key flow, and energy curve. Return as JSON object: "
        "{set: {tracks: [{position, artist, title, bpm, key, energy, transition_note}]}}. "
        "Energy is 1-10. Include 8-12 tracks. Make BPM and key transitions smooth and realistic."
    )

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Vibe: {vibe}, Duration: {duration}"},
            ],
            temperature=0.7,
        )
        content = response.choices[0].message.content
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            cleaned = cleaned.rsplit("```", 1)[0]
        result = json.loads(cleaned)
        return result
    except json.JSONDecodeError:
        return {"set": {"tracks": []}, "raw": content}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── AI Generation ─────────────────────────────────────────────────────────────

@app.post("/api/generate")
async def generate(payload: dict):
    """Generate a musical description/structure for a given genre using Azure OpenAI."""
    genre = payload.get("genre", "progressive house")
    bpm = payload.get("bpm", 128)
    key = payload.get("key", "Am")

    client = get_ai_client()
    if not client:
        return {
            "name": f"{genre.replace('_', ' ').title()} Beat",
            "bpm": bpm,
            "key": key,
            "bars": 32,
            "structure": "Intro (8 bars) > Build (8 bars) > Drop (8 bars) > Outro (8 bars)",
            "description": f"A {genre.replace('_', ' ')} track at {bpm} BPM in {key}. AI description unavailable — configure Azure OpenAI for full generation."
        }

    model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")
    system_prompt = (
        "You are an expert music producer and sound designer for Simple Balance Music. "
        "When given a genre, BPM, and key, generate a detailed musical description and structure. "
        "Respond ONLY with valid JSON (no markdown, no code fences) with these fields: "
        "name (creative track name), bpm (int), key (string), bars (int), "
        "structure (string describing arrangement sections), "
        "description (2-3 sentences about the sound, texture, and vibe)."
    )
    user_msg = f"Generate a {genre} track at {bpm} BPM in the key of {key}."

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg}
            ],
            temperature=0.7
        )
        raw = response.choices[0].message.content.strip()
        try:
            result = json.loads(raw)
        except json.JSONDecodeError:
            result = {
                "name": f"{genre.replace('_', ' ').title()} Beat",
                "bpm": bpm, "key": key, "bars": 32,
                "structure": "AI-generated",
                "description": raw
            }
        return result
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── AI Audio Generation (MusicGen via Replicate) ─────────────────────────────

@app.post("/api/generate/audio")
async def generate_audio(payload: dict):
    """Generate actual audio from a text prompt using Meta's MusicGen model."""
    token = get_secret("REPLICATE_API_TOKEN")
    if not token:
        return JSONResponse({"error": "Replicate API token not configured"}, status_code=503)

    os.environ["REPLICATE_API_TOKEN"] = token

    prompt = payload.get("prompt", "")
    if not prompt:
        return JSONResponse({"error": "No prompt provided"}, status_code=400)

    duration = payload.get("duration", 8)
    if not isinstance(duration, (int, float)):
        try:
            duration = int(duration)
        except (ValueError, TypeError):
            duration = 8
    duration = max(1, min(int(duration), 30))

    try:
        output = replicate.run(
            MUSICGEN_MODEL,
            input={
                "prompt": prompt,
                "duration": duration,
                "model_version": "stereo-melody-large",
            },
        )

        # MusicGen returns a single audio URL (FileOutput or string)
        audio_url = str(output) if output else None
        if not audio_url:
            return JSONResponse({"error": "No audio generated"}, status_code=500)

        return {"audio_url": audio_url, "prompt": prompt, "duration": duration}

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Mix Archive ───────────────────────────────────────────────────────────────

mix_archive = []


@app.post("/api/archive/upload")
async def archive_upload(request: Request, file: UploadFile = File(...)):
    """Accept audio file upload, store filename + metadata."""
    file_data = await file.read()
    if len(file_data) == 0:
        return JSONResponse({"error": "Empty file"}, status_code=400)

    size_mb = round(len(file_data) / (1024 * 1024), 2)
    entry = {
        "id": len(mix_archive) + 1,
        "filename": file.filename or "unknown.mp3",
        "size_mb": size_mb,
        "content_type": file.content_type or "audio/mpeg",
        "uploaded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    mix_archive.append(entry)

    # Persist to Supabase if logged in
    user = await get_current_user(request)
    if user:
        sb = get_supabase()
        if sb:
            try:
                sb.table("mix_archive").insert({
                    "user_id": user["id"],
                    "filename": entry["filename"],
                    "size_mb": size_mb,
                }).execute()
            except Exception:
                pass

    return {"message": "Mix archived successfully", "entry": entry, "total": len(mix_archive)}


@app.get("/api/archive")
async def archive_list(request: Request):
    """Return list of archived mixes."""
    user = await get_current_user(request)
    if user:
        sb = get_supabase()
        if sb:
            try:
                result = sb.table("mix_archive").select("*").eq("user_id", user["id"]).order("uploaded_at", desc=True).execute()
                mixes = [{"id": r["id"], "filename": r["filename"], "size_mb": r.get("size_mb"), "uploaded_at": str(r.get("uploaded_at", ""))} for r in (result.data or [])]
                return {"mixes": mixes, "total": len(mixes)}
            except Exception:
                pass
    return {"mixes": mix_archive, "total": len(mix_archive)}


# ── Producer Tools ────────────────────────────────────────────────────────────

@app.post("/api/tools/analyze")
async def tools_analyze(payload: dict):
    """Answer music theory questions using Azure OpenAI."""
    query = payload.get("query", "")
    if not query:
        return JSONResponse({"error": "No query provided"}, status_code=400)

    client = get_ai_client()
    if not client:
        return {"response": "Azure OpenAI not configured. Connect your API keys for live music theory analysis."}

    model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")
    system_prompt = (
        "You are a world-class music theory expert and production mentor for Simple Balance Music. "
        "You specialize in electronic music production, DJ techniques, harmonic theory, sound design, "
        "mixing, mastering, and arrangement. Give concise, practical answers. "
        "Use examples when helpful. Reference scales, chords, and frequencies when relevant."
    )

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": query}
            ],
            temperature=0.4
        )
        return {"response": response.choices[0].message.content}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.get("/api/dashboard")
async def dashboard(request: Request):
    """Return production stats — real stats if logged in, mock otherwise."""
    user = await get_current_user(request)
    if user:
        sb = get_supabase()
        if sb:
            try:
                jobs_result = sb.table("jobs").select("job_type", count="exact").eq("user_id", user["id"]).execute()
                archive_result = sb.table("mix_archive").select("id", count="exact").eq("user_id", user["id"]).execute()
                sets_result = sb.table("saved_sets").select("id", count="exact").eq("user_id", user["id"]).execute()

                job_counts = {}
                for j in (jobs_result.data or []):
                    jt = j.get("job_type", "other")
                    job_counts[jt] = job_counts.get(jt, 0) + 1

                return {
                    "tracks_mastered": job_counts.get("mastering", 0),
                    "sets_built": len(sets_result.data or []),
                    "stems_separated": job_counts.get("stems", 0),
                    "mixes_archived": len(archive_result.data or []),
                    "discovery_sessions": job_counts.get("discovery", 0) + job_counts.get("chat", 0),
                }
            except Exception:
                pass
    return {
        "tracks_mastered": 0,
        "sets_built": 0,
        "stems_separated": 0,
        "mixes_archived": len(mix_archive),
        "discovery_sessions": 0,
    }


# ── Spotify (Client Credentials) ─────────────────────────────────────────────

import base64
import hashlib
from datetime import datetime, timedelta

_spotify_token = {"access_token": None, "expires_at": datetime.min}


async def get_spotify_token():
    """Get a Spotify access token using Client Credentials flow. Caches until expiry."""
    global _spotify_token
    if _spotify_token["access_token"] and datetime.now() < _spotify_token["expires_at"]:
        return _spotify_token["access_token"]

    client_id = get_secret("SPOTIFY_CLIENT_ID")
    client_secret = get_secret("SPOTIFY_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None

    auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://accounts.spotify.com/api/token",
                headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
                data={"grant_type": "client_credentials"},
            )
            resp.raise_for_status()
            data = resp.json()
            _spotify_token["access_token"] = data["access_token"]
            _spotify_token["expires_at"] = datetime.now() + timedelta(seconds=data["expires_in"] - 60)
            return _spotify_token["access_token"]
    except Exception as e:
        logger.error("Spotify token fetch failed: %s", e)
        return None


@app.get("/api/spotify/search")
async def spotify_search(q: str, type: str = "track", limit: int = 10, session: str = ""):
    """Search Spotify for tracks, artists, or albums."""
    # Prefer user token (with refresh) if logged in, else fall back to client credentials
    token = await _spotify_get_token(session) if session else None
    if not token:
        token = await get_spotify_token()
    if not token:
        return JSONResponse({"error": "Spotify not configured"}, status_code=503)

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.spotify.com/v1/search",
            headers={"Authorization": f"Bearer {token}"},
            params={"q": q, "type": type, "limit": limit},
        )
        resp.raise_for_status()
        data = resp.json()

    # Normalize response — frontend expects {tracks: [{name, artist, album, album_image, ...}]}
    tracks = []
    for item in data.get("tracks", {}).get("items", []):
        artists = ", ".join(a.get("name", "") for a in item.get("artists", []))
        images = item.get("album", {}).get("images", [])
        tracks.append({
            "name": item.get("name", ""),
            "artist": artists,
            "album": item.get("album", {}).get("name", ""),
            "album_image": images[0]["url"] if images else None,
            "preview_url": item.get("preview_url"),
            "spotify_url": item.get("external_urls", {}).get("spotify"),
            "id": item.get("id"),
        })

    return {"tracks": tracks}


# ── Spotify OAuth (User Login) ────────────────────────────────────────────

_spotify_user_sessions = {}  # {session_id: {access_token, refresh_token, expires_at, user}}

SPOTIFY_REDIRECT_URI = os.environ.get(
    "SPOTIFY_REDIRECT_URI", "https://simple-balance-demo.onrender.com/api/spotify/callback"
)


async def _spotify_get_token(session: str) -> str | None:
    """Get a valid Spotify access token, refreshing if expired."""
    sess = _spotify_user_sessions.get(session)
    if not sess:
        return None
    # Check if token needs refresh (stored as epoch or countdown)
    refresh_token = sess.get("refresh_token")
    if not refresh_token:
        return sess.get("access_token")
    # Try refresh if we have one — Spotify tokens expire after 1 hour
    # We refresh proactively on every API call to keep it simple
    client_id = get_secret("SPOTIFY_CLIENT_ID")
    client_secret = get_secret("SPOTIFY_CLIENT_SECRET")
    if not client_id or not client_secret:
        return sess.get("access_token")
    auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    try:
        async with httpx.AsyncClient() as http:
            resp = await http.post(
                "https://accounts.spotify.com/api/token",
                headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
                data={"grant_type": "refresh_token", "refresh_token": refresh_token},
            )
            if resp.status_code == 200:
                data = resp.json()
                sess["access_token"] = data["access_token"]
                if data.get("refresh_token"):
                    sess["refresh_token"] = data["refresh_token"]
                return data["access_token"]
    except Exception:
        pass
    return sess.get("access_token")


@app.get("/api/spotify/login")
async def spotify_login(redirect_to: str = "/"):
    """Redirect to Spotify authorization page (full-page, mobile-safe)."""
    client_id = get_secret("SPOTIFY_CLIENT_ID")
    if not client_id:
        return JSONResponse({"error": "Spotify not configured"}, status_code=503)
    scope = "user-read-private user-read-email playlist-read-private"
    # Encode the return URL in state so callback knows where to redirect back
    state = base64.urlsafe_b64encode(redirect_to.encode()).decode().rstrip("=")
    params = urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": SPOTIFY_REDIRECT_URI,
        "scope": scope,
        "state": state,
    })
    return RedirectResponse(f"https://accounts.spotify.com/authorize?{params}")


@app.get("/api/spotify/callback")
async def spotify_callback(code: str = "", error: str = "", state: str = ""):
    """Handle Spotify OAuth callback — exchange code for tokens, redirect back."""
    # Decode return URL from state
    try:
        return_url = base64.urlsafe_b64decode(state + "==").decode()
    except Exception:
        return_url = "/"
    # Strip to path only for safety (prevent open redirect)
    from urllib.parse import urlparse
    parsed = urlparse(return_url)
    return_path = parsed.path or "/"

    if error or not code:
        return RedirectResponse(return_path)

    client_id = get_secret("SPOTIFY_CLIENT_ID")
    client_secret = get_secret("SPOTIFY_CLIENT_SECRET")
    auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()

    try:
        async with httpx.AsyncClient() as http:
            # Exchange code for tokens
            resp = await http.post(
                "https://accounts.spotify.com/api/token",
                headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
                data={"grant_type": "authorization_code", "code": code, "redirect_uri": SPOTIFY_REDIRECT_URI},
            )
            resp.raise_for_status()
            tokens = resp.json()

            # Get user profile
            me_resp = await http.get(
                "https://api.spotify.com/v1/me",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
            user = me_resp.json() if me_resp.status_code == 200 else {}
    except Exception:
        return RedirectResponse(return_path)

    session_id = secrets.token_urlsafe(32)
    expires_in = tokens.get("expires_in", 3600)
    _spotify_user_sessions[session_id] = {
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "expires_at": (datetime.now() + timedelta(seconds=expires_in)).isoformat(),
        "user": {
            "id": user.get("id", ""),
            "name": user.get("display_name", "Spotify User"),
            "email": user.get("email", ""),
            "image": (user.get("images") or [{}])[0].get("url") if user.get("images") else None,
            "product": user.get("product", "free"),
        },
    }

    # Redirect back to the app with session in URL
    separator = "&" if "?" in return_path else "?"
    return RedirectResponse(f"{return_path}{separator}spotify_session={session_id}")


@app.get("/api/spotify/me")
async def spotify_me(session: str = ""):
    """Get current Spotify user profile."""
    if session not in _spotify_user_sessions:
        return JSONResponse({"error": "Not logged in", "logged_in": False}, status_code=401)
    return {"logged_in": True, "user": _spotify_user_sessions[session]["user"]}


@app.post("/api/spotify/link")
async def spotify_link(request: Request, payload: dict):
    """Link a Spotify session to the logged-in Supabase user for persistence."""
    user = await get_current_user(request)
    if not user:
        return JSONResponse({"error": "Not logged in"}, status_code=401)
    session = payload.get("spotify_session", "")
    if session not in _spotify_user_sessions:
        return JSONResponse({"error": "Invalid Spotify session"}, status_code=400)
    sess = _spotify_user_sessions[session]
    sb = get_supabase()
    if not sb:
        return JSONResponse({"error": "Database not configured"}, status_code=503)
    try:
        sb.table("spotify_sessions").upsert({
            "user_id": user["id"],
            "access_token": sess["access_token"],
            "refresh_token": sess.get("refresh_token"),
            "spotify_user_id": sess.get("user", {}).get("id"),
            "spotify_display_name": sess.get("user", {}).get("name"),
        }, on_conflict="user_id").execute()
        sb.table("profiles").update({"spotify_connected": True}).eq("id", user["id"]).execute()
    except Exception:
        pass
    return {"linked": True}


@app.get("/api/spotify/restore")
async def spotify_restore(request: Request):
    """Restore a Spotify session from the database for a logged-in user."""
    user = await get_current_user(request)
    if not user:
        return JSONResponse({"error": "Not logged in"}, status_code=401)
    sb = get_supabase()
    if not sb:
        return {"restored": False}
    try:
        result = sb.table("spotify_sessions").select("*").eq("user_id", user["id"]).single().execute()
        if not result.data:
            return {"restored": False}
        row = result.data
        # Restore into in-memory sessions
        session_id = secrets.token_urlsafe(32)
        _spotify_user_sessions[session_id] = {
            "access_token": row["access_token"],
            "refresh_token": row.get("refresh_token"),
            "expires_at": row.get("expires_at", (datetime.now() + timedelta(seconds=3600)).isoformat()),
            "user": {
                "id": row.get("spotify_user_id", ""),
                "name": row.get("spotify_display_name", "Spotify User"),
                "email": "",
                "image": None,
                "product": "free",
            },
        }
        return {"restored": True, "spotify_session": session_id, "user": _spotify_user_sessions[session_id]["user"]}
    except Exception:
        return {"restored": False}


@app.get("/api/spotify/user/playlists")
async def spotify_user_playlists(session: str = ""):
    """Get the logged-in user's Spotify playlists."""
    if session not in _spotify_user_sessions:
        return JSONResponse({"error": "Not logged in"}, status_code=401)
    token = await _spotify_get_token(session)
    async with httpx.AsyncClient() as http:
        resp = await http.get(
            "https://api.spotify.com/v1/me/playlists?limit=20",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            return JSONResponse({"error": "Failed to fetch playlists"}, status_code=resp.status_code)
        data = resp.json()

    playlists = []
    for p in data.get("items", []):
        playlists.append({
            "id": p["id"],
            "name": p["name"],
            "tracks": p.get("tracks", {}).get("total", 0),
            "image": (p.get("images") or [{}])[0].get("url") if p.get("images") else None,
            "owner": p.get("owner", {}).get("display_name", ""),
        })
    return {"playlists": playlists}


@app.get("/api/spotify/recommendations")
async def spotify_recommendations(seed_genres: str = "", seed_artists: str = "", seed_tracks: str = "",
                                   target_bpm: int = 0, limit: int = 10):
    """Recommendations via AI engine (Spotify recommendations API deprecated). Delegates to /api/recommendations."""
    genre = seed_genres.replace(",", " ") if seed_genres else ""
    artist = seed_artists if seed_artists else ""
    return await ai_recommendations(genre=genre, mood="", artist=artist, bpm=target_bpm, limit=limit)


# ── Tidal OAuth (PKCE User Login + Client Credentials fallback) ──────────────

_tidal_user_sessions = {}  # {session_id: {access_token, refresh_token, expires_at, user, country}}
_tidal_pkce_states = {}    # {state: {code_verifier, redirect_to, created_at}}
_tidal_token = {"access_token": None, "expires_at": datetime.min}  # Client creds cache
_tidal_last_error = None

TIDAL_REDIRECT_URI = os.environ.get(
    "TIDAL_REDIRECT_URI", "https://simple-balance-demo.onrender.com/api/tidal/callback"
)


async def get_tidal_client_token():
    """Get a Tidal client credentials token (for catalog lookups by ID only)."""
    global _tidal_token, _tidal_last_error
    if _tidal_token["access_token"] and datetime.now() < _tidal_token["expires_at"]:
        return _tidal_token["access_token"]

    client_id = get_secret("TIDAL_CLIENT_ID")
    client_secret = get_secret("TIDAL_CLIENT_SECRET")
    if not client_id or not client_secret:
        _tidal_last_error = "TIDAL_CLIENT_ID or TIDAL_CLIENT_SECRET not set"
        return None

    try:
        auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://auth.tidal.com/v1/oauth2/token",
                headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
                data={"grant_type": "client_credentials"},
            )
            resp.raise_for_status()
            data = resp.json()
            _tidal_token["access_token"] = data["access_token"]
            _tidal_token["expires_at"] = datetime.now() + timedelta(seconds=data.get("expires_in", 86400) - 60)
            _tidal_last_error = None
            return _tidal_token["access_token"]
    except httpx.HTTPStatusError as e:
        _tidal_last_error = f"HTTP {e.response.status_code}: {e.response.text[:500]}"
        print(f"[Tidal] Client auth failed: {_tidal_last_error}")
        return None
    except Exception as e:
        _tidal_last_error = f"{type(e).__name__}: {e}"
        print(f"[Tidal] Client auth error: {_tidal_last_error}")
        return None


async def _tidal_get_user_token(session: str) -> str | None:
    """Get a valid Tidal user token, refreshing if expired."""
    sess = _tidal_user_sessions.get(session)
    if not sess:
        return None
    # Check if token is expired
    if sess.get("expires_at") and datetime.now() >= sess["expires_at"]:
        refresh_token = sess.get("refresh_token")
        if not refresh_token:
            del _tidal_user_sessions[session]
            return None
        # Refresh the token
        client_id = get_secret("TIDAL_CLIENT_ID")
        client_secret = get_secret("TIDAL_CLIENT_SECRET")
        if not client_id or not client_secret:
            return sess.get("access_token")
        try:
            auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
            async with httpx.AsyncClient(timeout=15) as http:
                resp = await http.post(
                    "https://auth.tidal.com/v1/oauth2/token",
                    headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
                    data={
                        "grant_type": "refresh_token",
                        "refresh_token": refresh_token,
                        "client_id": client_id,
                        "scope": "user.read collection.read search.read playlists.read playlists.write entitlements.read collection.write playback recommendations.read",
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    sess["access_token"] = data["access_token"]
                    if data.get("refresh_token"):
                        sess["refresh_token"] = data["refresh_token"]
                    sess["expires_at"] = datetime.now() + timedelta(seconds=data.get("expires_in", 86400) - 60)
                    return data["access_token"]
        except Exception:
            pass
    return sess.get("access_token")


@app.get("/api/tidal/login")
async def tidal_login(redirect_to: str = "/"):
    """Redirect to Tidal authorization page (PKCE flow, mobile-safe)."""
    client_id = get_secret("TIDAL_CLIENT_ID")
    if not client_id:
        return JSONResponse({"error": "Tidal not configured"}, status_code=503)

    # Generate PKCE code verifier + challenge
    code_verifier = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).decode().rstrip("=")

    # Store state → code_verifier mapping (cleaned up after 10 min)
    state = secrets.token_urlsafe(32)
    _tidal_pkce_states[state] = {
        "code_verifier": code_verifier,
        "redirect_to": redirect_to,
        "created_at": time.time(),
    }
    # Clean up old states (> 10 min)
    cutoff = time.time() - 600
    for k in list(_tidal_pkce_states.keys()):
        if _tidal_pkce_states[k]["created_at"] < cutoff:
            del _tidal_pkce_states[k]

    params = urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": TIDAL_REDIRECT_URI,
        "scope": "user.read collection.read search.read playlists.read playlists.write entitlements.read collection.write playback recommendations.read",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    })
    return RedirectResponse(f"https://login.tidal.com/authorize?{params}")


@app.get("/api/tidal/callback")
async def tidal_callback(code: str = "", error: str = "", state: str = ""):
    """Handle Tidal OAuth PKCE callback — exchange code for tokens, redirect back."""
    pkce = _tidal_pkce_states.pop(state, None)
    if not pkce:
        return RedirectResponse("/?tidal_error=invalid_state")

    return_url = pkce.get("redirect_to", "/")
    from urllib.parse import urlparse
    parsed = urlparse(return_url)
    return_path = parsed.path or "/"

    if error or not code:
        return RedirectResponse(f"{return_path}?tidal_error={error or 'no_code'}")

    client_id = get_secret("TIDAL_CLIENT_ID")
    client_secret = get_secret("TIDAL_CLIENT_SECRET")
    auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()

    try:
        async with httpx.AsyncClient(timeout=15) as http:
            # Exchange code for tokens using PKCE
            resp = await http.post(
                "https://auth.tidal.com/v1/oauth2/token",
                headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": TIDAL_REDIRECT_URI,
                    "client_id": client_id,
                    "code_verifier": pkce["code_verifier"],
                    "scope": "user.read collection.read search.read playlists.read playlists.write entitlements.read collection.write playback recommendations.read",
                },
            )
            resp.raise_for_status()
            tokens = resp.json()

            # Get user info from Tidal
            user = {}
            country = "US"
            try:
                me_resp = await http.get(
                    "https://api.tidal.com/v1/sessions",
                    headers={"Authorization": f"Bearer {tokens['access_token']}"},
                )
                if me_resp.status_code == 200:
                    session_data = me_resp.json()
                    country = session_data.get("countryCode", "US")
                    user_id = session_data.get("userId")
                    if user_id:
                        user_resp = await http.get(
                            f"https://api.tidal.com/v1/users/{user_id}",
                            headers={"Authorization": f"Bearer {tokens['access_token']}"},
                            params={"countryCode": country},
                        )
                        if user_resp.status_code == 200:
                            user = user_resp.json()
            except Exception as e:
                print(f"[Tidal] User info fetch failed: {e}")

    except Exception as e:
        print(f"[Tidal] Token exchange failed: {e}")
        return RedirectResponse(f"{return_path}?tidal_error=token_exchange_failed")

    session_id = secrets.token_urlsafe(32)
    _tidal_user_sessions[session_id] = {
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "expires_at": datetime.now() + timedelta(seconds=tokens.get("expires_in", 86400) - 60),
        "country": country,
        "user": {
            "id": user.get("userId", user.get("id", "")),
            "name": user.get("firstName", user.get("username", "Tidal User")),
        },
    }

    separator = "&" if "?" in return_path else "?"
    return RedirectResponse(f"{return_path}{separator}tidal_session={session_id}")


@app.get("/api/tidal/me")
async def tidal_me(session: str = ""):
    """Get current Tidal user info from session."""
    sess = _tidal_user_sessions.get(session)
    if not sess:
        return JSONResponse({"error": "No session"}, status_code=401)
    token = await _tidal_get_user_token(session)
    if not token:
        return JSONResponse({"error": "Session expired"}, status_code=401)
    return {"user": sess.get("user", {}), "connected": True}


async def tidal_search_tracks(http, token, query, limit=3, country="US"):
    """Search Tidal for tracks using the v1 API (requires user auth token)."""
    try:
        resp = await http.get(
            "https://api.tidal.com/v1/search",
            headers={"Authorization": f"Bearer {token}"},
            params={"query": query, "types": "TRACKS", "limit": limit, "countryCode": country},
        )
        if resp.status_code != 200:
            print(f"[Tidal] Search failed: {resp.status_code} {resp.text[:300]}")
            return []
        data = resp.json()
        items = data.get("tracks", {}).get("items", [])
        results = []
        for item in items:
            artists = ", ".join(a.get("name", "") for a in item.get("artists", []))
            cover = None
            album = item.get("album", {})
            if album.get("cover"):
                cover_id = album["cover"].replace("-", "/")
                cover = f"https://resources.tidal.com/images/{cover_id}/320x320.jpg"
            results.append({
                "id": item.get("id"),
                "title": item.get("title", ""),
                "artist": artists,
                "url": f"https://tidal.com/track/{item.get('id', '')}",
                "album": album.get("title", ""),
                "album_art": cover,
                "duration": item.get("duration", 0),
            })
        return results
    except Exception as e:
        print(f"[Tidal] Search error: {e}")
        return []


@app.get("/api/tidal/debug")
async def tidal_debug():
    """Diagnostic endpoint — test Tidal auth and return actual error."""
    client_id = get_secret("TIDAL_CLIENT_ID")
    client_secret = get_secret("TIDAL_CLIENT_SECRET")
    if not client_id or not client_secret:
        return {"status": "no_credentials", "client_id_set": bool(client_id), "client_secret_set": bool(client_secret)}
    global _tidal_token
    _tidal_token = {"access_token": None, "expires_at": datetime.min}
    token = await get_tidal_client_token()
    active_sessions = len(_tidal_user_sessions)
    return {
        "status": "ok" if token else "auth_failed",
        "client_token_obtained": bool(token),
        "active_user_sessions": active_sessions,
        "last_error": _tidal_last_error,
        "client_id_prefix": client_id[:8] + "..." if client_id else None,
        "redirect_uri": TIDAL_REDIRECT_URI,
        "note": "Search requires user OAuth login via /api/tidal/login",
    }


@app.get("/api/tidal/search")
async def tidal_search(q: str, limit: int = 10, countryCode: str = "US", session: str = ""):
    """Search Tidal catalog for tracks. Requires user OAuth session."""
    # Try user session first (required for search)
    if session:
        token = await _tidal_get_user_token(session)
        sess = _tidal_user_sessions.get(session)
        if token:
            country = sess.get("country", countryCode) if sess else countryCode
            async with httpx.AsyncClient(timeout=15) as http:
                results = await tidal_search_tracks(http, token, q, limit, country)
            return {"tracks": results}

    # No user session — check if any sessions exist
    if _tidal_user_sessions:
        # Use the most recent session
        latest_session = list(_tidal_user_sessions.keys())[-1]
        token = await _tidal_get_user_token(latest_session)
        sess = _tidal_user_sessions.get(latest_session)
        if token:
            country = sess.get("country", countryCode) if sess else countryCode
            async with httpx.AsyncClient(timeout=15) as http:
                results = await tidal_search_tracks(http, token, q, limit, country)
            return {"tracks": results}

    # No user sessions at all — tell frontend to login
    has_creds = bool(get_secret("TIDAL_CLIENT_ID") and get_secret("TIDAL_CLIENT_SECRET"))
    return JSONResponse({
        "error": "Tidal login required",
        "configured": has_creds,
        "needs_login": True,
        "detail": "Search requires Tidal user login. Click Connect to sign in.",
    }, status_code=401)


# ── AI-Powered Recommendations (Spotify + Tidal) ────────────────────────────

@app.get("/api/recommendations")
async def ai_recommendations(genre: str = "", mood: str = "", artist: str = "",
                              bpm: int = 0, limit: int = 10):
    """AI-powered music recommendations with Spotify + Tidal delivery."""
    client = get_ai_client()
    if not client:
        return JSONResponse({"error": "Azure OpenAI not configured"}, status_code=503)

    model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")

    context_parts = []
    if genre:
        context_parts.append(f"Genre: {genre}")
    if mood:
        context_parts.append(f"Mood: {mood}")
    if artist:
        context_parts.append(f"Similar to: {artist}")
    if bpm:
        context_parts.append(f"Target BPM: {bpm}")
    if not context_parts:
        context_parts.append("Genre: electronic")

    context = ", ".join(context_parts)

    system_prompt = (
        "You are J.A.W., the recommendation engine for Simple Balance Music. "
        "Sound focus: 2023–2026 cinematic / hybrid melodic techno. "
        "Tier 1 (priority): Son of Son, Aladag, HNTR, Fezzo, Ivory, Oppaacha — labels: Running Clouds, Oddity, Siona, Radikon, Eklektisch. "
        "Tier 2: Rafael Cerato, Dyzen, 8Kays, Argy, Fideles. Tier 3 (legacy): Massano, Colyn, Anyma, Innellea, Adriatique. "
        f"Given preferences, recommend exactly {limit} specific, real tracks. "
        "Return ONLY valid JSON: {\"tracks\": [{\"title\": \"...\", \"artist\": \"...\", \"bpm\": number, "
        "\"key\": \"...\", \"camelot\": \"...\", \"tier\": 1|2|3, \"energy\": 1-10, \"label\": \"...\", \"reason\": \"...\"}]}. "
        "Always include Camelot code + open key. Prioritize Tier 1 artists/labels. Use real, existing tracks only."
    )

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Recommend tracks for: {context}"},
            ],
            temperature=0.7,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        ai_tracks = json.loads(content)
        if isinstance(ai_tracks, dict):
            ai_tracks = ai_tracks.get("tracks", ai_tracks.get("recommendations", []))
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    # Enrich with Spotify + Tidal links
    spotify_token = await get_spotify_token()
    # Try to get a Tidal user token for search enrichment
    tidal_token = None
    tidal_country = "US"
    if _tidal_user_sessions:
        latest_sid = list(_tidal_user_sessions.keys())[-1]
        tidal_token = await _tidal_get_user_token(latest_sid)
        tidal_country = _tidal_user_sessions.get(latest_sid, {}).get("country", "US")
    enriched = []

    async with httpx.AsyncClient(timeout=15) as http:
        for track in ai_tracks[:limit]:
            query = f"{track.get('title', '')} {track.get('artist', '')}"
            entry = {
                "title": track.get("title", "Unknown"),
                "artist": track.get("artist", "Unknown"),
                "bpm": track.get("bpm"),
                "key": track.get("key"),
                "reason": track.get("reason", ""),
                "spotify": None,
                "tidal": None,
            }

            # Spotify search
            if spotify_token:
                try:
                    resp = await http.get(
                        "https://api.spotify.com/v1/search",
                        headers={"Authorization": f"Bearer {spotify_token}"},
                        params={"q": query, "type": "track", "limit": 1},
                    )
                    if resp.status_code == 200:
                        items = resp.json().get("tracks", {}).get("items", [])
                        if items:
                            t = items[0]
                            images = t.get("album", {}).get("images", [])
                            entry["spotify"] = {
                                "url": t.get("external_urls", {}).get("spotify"),
                                "id": t["id"],
                                "preview_url": t.get("preview_url"),
                                "album_art": images[0]["url"] if images else None,
                            }
                except Exception:
                    pass

            # Tidal search (requires user OAuth session)
            if tidal_token:
                tidal_results = await tidal_search_tracks(http, tidal_token, query, limit=1, country=tidal_country)
                if tidal_results:
                    entry["tidal"] = tidal_results[0]

            enriched.append(entry)

    return {
        "tracks": enriched,
        "source": "ai",
        "platforms": {"spotify": bool(spotify_token), "tidal": bool(tidal_token)},
    }


# ── Manual Profile Builder ──────────────────────────────────────────────────

async def _build_profile_from_spotify(favorites: list) -> dict | None:
    """Fallback: build a taste profile from Spotify audio features when Azure is down."""
    spotify_token = await get_spotify_token()
    if not spotify_token:
        return None

    key_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    track_ids = []
    seed_ids = []
    recs_from_spotify = []

    async with httpx.AsyncClient(timeout=15) as http:
        # Search each favorite on Spotify, collect track IDs
        for fav in favorites[:10]:
            query = fav if isinstance(fav, str) else f"{fav.get('title', '')} {fav.get('artist', '')}".strip()
            if not query:
                continue
            try:
                resp = await http.get(
                    "https://api.spotify.com/v1/search",
                    headers={"Authorization": f"Bearer {spotify_token}"},
                    params={"q": query, "type": "track", "limit": 1},
                )
                if resp.status_code == 200:
                    items = resp.json().get("tracks", {}).get("items", [])
                    if items:
                        track_ids.append(items[0]["id"])
                        if len(seed_ids) < 5:
                            seed_ids.append(items[0]["id"])
            except Exception:
                pass

        if not track_ids:
            return None

        # Get audio features for all found tracks
        bpms, energies, keys, danceabilities = [], [], [], []
        try:
            resp = await http.get(
                f"https://api.spotify.com/v1/audio-features",
                headers={"Authorization": f"Bearer {spotify_token}"},
                params={"ids": ",".join(track_ids[:20])},
            )
            if resp.status_code == 200:
                for af in (resp.json().get("audio_features") or []):
                    if not af:
                        continue
                    bpms.append(af.get("tempo", 0))
                    energies.append(af.get("energy", 0))
                    danceabilities.append(af.get("danceability", 0))
                    key_idx = af.get("key", -1)
                    mode = "major" if af.get("mode", 0) == 1 else "minor"
                    if 0 <= key_idx < 12:
                        keys.append(f"{key_names[key_idx]} {mode}")
        except Exception:
            pass

        # Build profile from aggregated features
        avg_energy = sum(energies) / len(energies) if energies else 0.5
        energy_level = "high" if avg_energy > 0.7 else ("low" if avg_energy < 0.35 else "medium")
        bpm_min = round(min(bpms)) if bpms else 120
        bpm_max = round(max(bpms)) if bpms else 130

        # Count key frequency for top 3
        key_counts = {}
        for k in keys:
            key_counts[k] = key_counts.get(k, 0) + 1
        top_keys = sorted(key_counts, key=key_counts.get, reverse=True)[:3]

        # Get Spotify recommendations from seed tracks
        try:
            resp = await http.get(
                "https://api.spotify.com/v1/recommendations",
                headers={"Authorization": f"Bearer {spotify_token}"},
                params={"seed_tracks": ",".join(seed_ids), "limit": 10},
            )
            if resp.status_code == 200:
                for t in resp.json().get("tracks", []):
                    artists = ", ".join(a["name"] for a in t.get("artists", []))
                    images = t.get("album", {}).get("images", [])
                    recs_from_spotify.append({
                        "title": t["name"],
                        "artist": artists,
                        "bpm": None,
                        "key": None,
                        "reason": "Based on your favorites (Spotify recommendation)",
                        "spotify": {
                            "url": t.get("external_urls", {}).get("spotify"),
                            "album_art": images[0]["url"] if images else None,
                            "preview_url": t.get("preview_url"),
                        },
                    })
        except Exception:
            pass

    return {
        "profile": {
            "genres": ["electronic", "dance"],
            "energy_level": energy_level,
            "bpm_range": {"min": bpm_min, "max": bpm_max},
            "key_clusters": top_keys or ["A minor"],
            "mood": f"{'High' if avg_energy > 0.7 else 'Medium'} energy, {'danceable' if (sum(danceabilities) / len(danceabilities) if danceabilities else 0) > 0.6 else 'listening-focused'}",
            "dj_style": f"{bpm_min}-{bpm_max} BPM range",
        },
        "recommendations": recs_from_spotify,
        "_source": "spotify_fallback",
    }


# ── Crew Auth (PIN-based profile selector) ────────────────────────────────────

SBM_CREW = {
    "J.A.W.": {"color": "#10B981", "is_admin": False, "links": {
        "beatport": "https://www.beatport.com/search?q=J.A.W.",
    }},
    "Chinny Beatz": {"color": "#E879F9", "is_admin": False, "links": {
        "soundcloud": "https://soundcloud.com/chinny-beatz",
        "beatport": "https://www.beatport.com/search?q=Chinny+Beatz",
    }},
    "Pete Dekan": {"color": "#818cf8", "is_admin": True, "links": {
        "soundcloud": "https://soundcloud.com/peter-wilson-30",
        "beatport": "https://www.beatport.com/search?q=Peter+Wilson+30",
    }},
    "CGReyes": {"color": "#F59E0B", "is_admin": False, "links": {
        "beatport": "https://www.beatport.com/search?q=CGReyes",
    }},
    "TECHNOLASKO": {"color": "#EF4444", "is_admin": False, "links": {
        "beatport": "https://www.beatport.com/search?q=TECHNOLASKO",
    }},
    "Jose Alejo": {"color": "#06B6D4", "is_admin": False, "links": {
        "soundcloud": "https://soundcloud.com/jose-alejo",
        "beatport": "https://www.beatport.com/search?q=Jose+Alejo",
    }},
    "Willis Haltom": {"color": "#A78BFA", "is_admin": False, "links": {
        "spotify": "https://open.spotify.com/artist/5H5oZW1d7pw77CNm4rOO1x",
        "soundcloud": "https://soundcloud.com/willis-haltom",
        "beatport": "https://www.beatport.com/search?q=Willis+Haltom",
    }},
    "Guest": {"color": "#6B7280", "is_admin": False, "links": {}},
}
_sbm_tokens = {}  # token -> profile dict


@app.post("/api/crew/login")
async def crew_login(payload: dict):
    name = payload.get("name", "").strip()
    pin = payload.get("pin", "")
    if name not in SBM_CREW:
        return JSONResponse({"error": "Unknown crew member"}, status_code=401)
    crew_pin = get_secret("CREW_PIN", "1234")
    if str(pin) != crew_pin:
        return JSONResponse({"error": "Wrong PIN"}, status_code=401)
    token = secrets.token_urlsafe(32)
    member = SBM_CREW[name]
    profile = {"display_name": name, "color": member["color"], "is_admin": member["is_admin"], "links": member.get("links", {})}
    _sbm_tokens[token] = profile
    return {"token": token, "profile": profile}


@app.post("/api/crew/register")
async def crew_register(payload: dict):
    name = payload.get("name", "").strip()
    pin = payload.get("pin", "")
    color = payload.get("color", "#818cf8")
    if not name or len(name) < 2:
        return JSONResponse({"error": "Name must be at least 2 characters"}, status_code=400)
    crew_pin = get_secret("CREW_PIN", "1234")
    if str(pin) != crew_pin:
        return JSONResponse({"error": "Wrong PIN"}, status_code=400)
    if name not in SBM_CREW:
        SBM_CREW[name] = {"color": color, "is_admin": False}
    token = secrets.token_urlsafe(32)
    profile = {"display_name": name, "color": color, "is_admin": False}
    _sbm_tokens[token] = profile
    return {"token": token, "profile": profile}


@app.get("/api/crew/verify")
async def crew_verify(request: Request):
    token = request.headers.get("X-Crew-Token", "")
    profile = _sbm_tokens.get(token)
    if not profile:
        return JSONResponse({"error": "Invalid token"}, status_code=401)
    return {"profile": profile}


@app.get("/api/crew/members")
async def crew_members():
    members = []
    for name, data in SBM_CREW.items():
        members.append({"name": name, "color": data["color"], "links": data.get("links", {})})
    return {"members": members}


@app.get("/api/crew/profile/{name}")
async def crew_profile(name: str):
    """Get a crew member's full profile with streaming links."""
    member = SBM_CREW.get(name)
    if not member:
        return JSONResponse({"error": "Unknown crew member"}, status_code=404)
    profile = {"display_name": name, "color": member["color"], "links": member.get("links", {})}

    # If they have a Spotify artist ID, fetch their catalog
    spotify_url = member.get("links", {}).get("spotify", "")
    if "spotify.com/artist/" in spotify_url:
        artist_id = spotify_url.split("/artist/")[-1].split("?")[0]
        try:
            client_id = get_secret("SPOTIFY_CLIENT_ID")
            client_secret = get_secret("SPOTIFY_CLIENT_SECRET")
            if client_id and client_secret:
                import base64 as b64mod
                auth_str = b64mod.b64encode(f"{client_id}:{client_secret}".encode()).decode()
                async with httpx.AsyncClient(timeout=10) as hc:
                    token_resp = await hc.post("https://accounts.spotify.com/api/token",
                        data={"grant_type": "client_credentials"},
                        headers={"Authorization": f"Basic {auth_str}"})
                    sp_token = token_resp.json().get("access_token")
                    if sp_token:
                        sp_headers = {"Authorization": f"Bearer {sp_token}"}
                        albums_resp = await hc.get(f"https://api.spotify.com/v1/artists/{artist_id}/albums?limit=10&market=US", headers=sp_headers)
                        top_resp = await hc.get(f"https://api.spotify.com/v1/artists/{artist_id}/top-tracks?market=US", headers=sp_headers)
                        profile["spotify_albums"] = [{"name": a["name"], "year": a.get("release_date", "")[:4], "image": a["images"][0]["url"] if a.get("images") else None, "url": a["external_urls"]["spotify"]} for a in albums_resp.json().get("items", [])]
                        profile["spotify_tracks"] = [{"name": t["name"], "album": t["album"]["name"], "preview_url": t.get("preview_url"), "url": t["external_urls"]["spotify"]} for t in top_resp.json().get("tracks", [])[:10]]
        except Exception as e:
            logger.warning(f"Spotify catalog fetch failed for {name}: {e}")

    return profile


@app.post("/api/auth/ensure-profile")
async def ensure_profile(request: Request):
    """Ensure a profile row exists for the authenticated user. Called after signup/login."""
    from auth import get_current_user
    user = await get_current_user(request)
    if not user:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    db = get_supabase()
    if not db:
        return {"ok": True, "note": "No DB configured"}
    try:
        existing = db.table("profiles").select("id").eq("id", user["id"]).execute()
        if not existing.data:
            db.table("profiles").insert({
                "id": user["id"],
                "display_name": user.get("email", "").split("@")[0],
            }).execute()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/profile/build")
async def build_profile(payload: dict, request: Request):
    """Build a taste profile from manually entered favorites. No streaming account needed."""
    favorites = payload.get("favorites", [])

    if len(favorites) < 3:
        return JSONResponse({"error": "Add at least 3 favorites"}, status_code=400)

    result = None
    client = get_ai_client()

    # Try Azure OpenAI first
    if client:
        model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")
        favorites_text = json.dumps(favorites[:20], indent=2)

        system_prompt = (
            "You are a music taste analyst for Simple Balance Music. Given a list of favorite songs/artists, "
            "analyze the user's taste and generate a profile with 10 track recommendations. "
            "Return ONLY valid JSON:\n"
            '{"profile": {"genres": ["top 5 genres"], "energy_level": "high/medium/low", '
            '"bpm_range": {"min": number, "max": number}, '
            '"key_clusters": ["top 3 musical keys"], '
            '"mood": "short mood description", '
            '"dj_style": "short DJ style description"}, '
            '"recommendations": [{"title": "...", "artist": "...", "bpm": number, "key": "...", "reason": "..."}]}'
        )

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Build a taste profile from these favorites:\n{favorites_text}"},
                ],
                temperature=0.5,
                response_format={"type": "json_object"},
            )
            result = json.loads(response.choices[0].message.content)
        except Exception as e:
            logger.warning(f"Azure OpenAI failed for profile build: {e}")

    # Fallback: build profile from Spotify audio features
    if not result:
        result = await _build_profile_from_spotify(favorites)
        if not result:
            return JSONResponse({"error": "AI and Spotify both unavailable"}, status_code=503)

    # Enrich recommendations with Spotify + Tidal links (skip if already from Spotify fallback)
    recs = result.get("recommendations", [])
    if result.get("_source") != "spotify_fallback":
        spotify_token = await get_spotify_token()
        # Try Tidal user session for search enrichment
        tidal_token = None
        tidal_country = "US"
        if _tidal_user_sessions:
            latest_sid = list(_tidal_user_sessions.keys())[-1]
            tidal_token = await _tidal_get_user_token(latest_sid)
            tidal_country = _tidal_user_sessions.get(latest_sid, {}).get("country", "US")

        if recs and (spotify_token or tidal_token):
            async with httpx.AsyncClient(timeout=15) as http:
                for rec in recs:
                    query = f"{rec.get('title', '')} {rec.get('artist', '')}"
                    if spotify_token:
                        try:
                            resp = await http.get(
                                "https://api.spotify.com/v1/search",
                                headers={"Authorization": f"Bearer {spotify_token}"},
                                params={"q": query, "type": "track", "limit": 1},
                            )
                            if resp.status_code == 200:
                                items = resp.json().get("tracks", {}).get("items", [])
                                if items:
                                    t = items[0]
                                    images = t.get("album", {}).get("images", [])
                                    rec["spotify"] = {
                                        "url": t.get("external_urls", {}).get("spotify"),
                                        "album_art": images[0]["url"] if images else None,
                                        "preview_url": t.get("preview_url"),
                                    }
                        except Exception:
                            pass
                    if tidal_token:
                        tidal_results = await tidal_search_tracks(http, tidal_token, query, limit=1, country=tidal_country)
                        if tidal_results:
                            rec["tidal"] = tidal_results[0]

    # Persist to Supabase if user is logged in
    user = await get_current_user(request)
    if user:
        sb = get_supabase()
        if sb:
            try:
                profile = result.get("profile", {})
                sb.table("taste_profiles").upsert({
                    "user_id": user["id"],
                    "genres": profile.get("genres", []),
                    "energy_level": profile.get("energy_level"),
                    "bpm_min": profile.get("bpm_range", {}).get("min"),
                    "bpm_max": profile.get("bpm_range", {}).get("max"),
                    "key_clusters": profile.get("key_clusters", []),
                    "mood": profile.get("mood"),
                    "dj_style": profile.get("dj_style"),
                    "favorites": payload.get("favorites", []),
                    "recommendations": result.get("recommendations", []),
                }, on_conflict="user_id").execute()
            except Exception:
                pass

    return result


@app.get("/api/spotify/audio-features/{track_id}")
async def spotify_audio_features(track_id: str):
    """Get audio features (BPM, key, energy, danceability) for a Spotify track."""
    token = await get_spotify_token()
    if not token:
        return JSONResponse({"error": "Spotify not configured"}, status_code=503)

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://api.spotify.com/v1/audio-features/{track_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        data = resp.json()

    key_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    key_idx = data.get("key", -1)
    mode = "major" if data.get("mode", 0) == 1 else "minor"
    key_str = f"{key_names[key_idx]} {mode}" if 0 <= key_idx < 12 else "Unknown"

    return {
        "bpm": round(data.get("tempo", 0)),
        "key": key_str,
        "energy": round(data.get("energy", 0), 2),
        "danceability": round(data.get("danceability", 0), 2),
        "valence": round(data.get("valence", 0), 2),
        "acousticness": round(data.get("acousticness", 0), 2),
        "instrumentalness": round(data.get("instrumentalness", 0), 2),
        "duration_ms": data.get("duration_ms", 0),
    }


@app.get("/api/spotify/user/{user_id}/playlists")
async def spotify_user_playlists(user_id: str, limit: int = 20):
    """Get a user's public playlists."""
    token = await get_spotify_token()
    if not token:
        return JSONResponse({"error": "Spotify not configured"}, status_code=503)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.spotify.com/v1/users/{user_id}/playlists",
                headers={"Authorization": f"Bearer {token}"},
                params={"limit": limit},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as e:
        return JSONResponse({"error": f"Spotify API error: {e.response.status_code}", "detail": e.response.text[:200]}, status_code=e.response.status_code)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    playlists = []
    for p in data.get("items", []):
        images = p.get("images", [])
        playlists.append({
            "id": p["id"],
            "name": p["name"],
            "tracks": p.get("tracks", {}).get("total", 0),
            "image": images[0]["url"] if images else None,
            "url": p.get("external_urls", {}).get("spotify"),
        })
    return {"playlists": playlists, "user_id": user_id}


@app.get("/api/spotify/playlist/{playlist_id}/tracks")
async def spotify_playlist_tracks(playlist_id: str, limit: int = 50, session: str = ""):
    """Get tracks from a playlist with audio features for seeding."""
    # Prefer user's OAuth token (can access private playlists), fall back to client creds
    token = await _spotify_get_token(session) if session else None
    if not token:
        token = await get_spotify_token()
    if not token:
        return JSONResponse({"error": "Spotify not configured"}, status_code=503)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
                headers={"Authorization": f"Bearer {token}"},
                params={"limit": limit, "fields": "items(track(id,name,artists,album(images),external_urls,preview_url,duration_ms))"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as e:
        return JSONResponse({"error": f"Spotify API error: {e.response.status_code}"}, status_code=e.response.status_code)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    tracks = []
    track_ids = []
    for item in data.get("items", []):
        t = item.get("track")
        if not t or not t.get("id"):
            continue
        artists = ", ".join(a["name"] for a in t.get("artists", []))
        album = t.get("album", {})
        images = album.get("images", [])
        tracks.append({
            "title": t["name"],
            "artist": artists,
            "spotify_id": t["id"],
            "spotify_url": t.get("external_urls", {}).get("spotify"),
            "album_art": images[0]["url"] if images else None,
            "preview_url": t.get("preview_url"),
        })
        track_ids.append(t["id"])

    # Batch fetch audio features for all tracks
    if track_ids:
        batch_ids = ",".join(track_ids[:100])
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://api.spotify.com/v1/audio-features",
                headers={"Authorization": f"Bearer {token}"},
                params={"ids": batch_ids},
            )
            if resp.status_code == 200:
                features = resp.json().get("audio_features", [])
                key_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
                feat_map = {}
                for f in features:
                    if f and f.get("id"):
                        key_idx = f.get("key", -1)
                        mode = "major" if f.get("mode", 0) == 1 else "minor"
                        feat_map[f["id"]] = {
                            "bpm": round(f.get("tempo", 0)),
                            "key": f"{key_names[key_idx]} {mode}" if 0 <= key_idx < 12 else "?",
                            "energy": round(f.get("energy", 0), 2),
                            "danceability": round(f.get("danceability", 0), 2),
                        }
                for track in tracks:
                    af = feat_map.get(track["spotify_id"], {})
                    track.update(af)

    return {"tracks": tracks, "total": len(tracks)}


# ── Music Profile Analysis ────────────────────────────────────────────────────

@app.post("/api/profile/analyze")
async def analyze_profile(payload: dict):
    """Analyze user's Spotify data to generate a taste profile using Azure OpenAI."""
    client = get_ai_client()
    if not client:
        return JSONResponse({"error": "Azure OpenAI not configured"}, status_code=503)

    model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")
    tracks = payload.get("tracks", [])
    playlists = payload.get("playlists", [])
    genres = payload.get("genres", [])

    user_data = json.dumps({
        "top_tracks": tracks[:30],
        "playlist_names": playlists[:20],
        "genres": genres[:20],
    }, indent=2)

    system_prompt = (
        "You are a music taste analyst for Simple Balance Music. Given a user's listening data, "
        "generate a taste profile. Return ONLY valid JSON with this exact structure:\n"
        '{"genres": ["top 5 genres"], "energy_level": "high/medium/low", '
        '"bpm_range": {"min": number, "max": number}, '
        '"key_clusters": ["top 3 musical keys"], '
        '"mood": "short mood description", '
        '"dj_style": "short DJ style description"}'
    )

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Analyze this listener's music data and generate their taste profile:\n{user_data}"},
            ],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content)
        return {"profile": result}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── API Status ────────────────────────────────────────────────────────────────

@app.get("/api/status")
async def api_status():
    return {
        "azure_openai": bool(get_secret("AZURE_OPENAI_ENDPOINT") and get_secret("AZURE_OPENAI_KEY")),
        "audd": bool(get_secret("AUDD_API_TOKEN")),
        "replicate": bool(get_secret("REPLICATE_API_TOKEN")),
        "spotify": bool(get_secret("SPOTIFY_CLIENT_ID") and get_secret("SPOTIFY_CLIENT_SECRET")),
        "tidal": bool(get_secret("TIDAL_CLIENT_ID") and get_secret("TIDAL_CLIENT_SECRET")),
        "genius": bool(get_secret("GENIUS_API_TOKEN")),
        "beatport": bool(get_secret("BEATPORT_CLIENT_ID") and get_secret("BEATPORT_CLIENT_SECRET")),
    }


# ── Admin Dashboard ──────────────────────────────────────────────────────────

@app.get("/api/admin/summary")
async def admin_summary():
    """Admin dashboard summary: services, server info, active jobs, job history."""
    import platform
    import sys

    uptime_secs = int(time.time() - _SERVER_START_TIME)
    hours, remainder = divmod(uptime_secs, 3600)
    minutes, secs = divmod(remainder, 60)
    uptime_str = f"{hours}h {minutes}m {secs}s"

    # Tool versions (safe — no git CLI needed)
    yt_dlp_ver = "unknown"
    ffmpeg_ver = "unknown"
    try:
        r = subprocess.run(["yt-dlp", "--version"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            yt_dlp_ver = r.stdout.strip()
    except Exception:
        pass
    try:
        r = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            ffmpeg_ver = r.stdout.split("\n")[0].split("version ")[-1].split(" ")[0] if "version" in r.stdout else r.stdout.split("\n")[0]
    except Exception:
        pass

    # Active jobs
    active_downloads = {k: {"status": v["status"], "title": (v.get("metadata") or {}).get("title", "Unknown"),
                             "elapsed": round(time.time() - v["started_at"])}
                        for k, v in _download_jobs.items() if v["status"] not in ("done", "failed")}
    active_digests = {k: {"status": v["status"], "title": (v.get("metadata") or {}).get("title", "Unknown"),
                          "elapsed": round(time.time() - v["started_at"]),
                          "scan_progress": v.get("scan_progress")}
                      for k, v in _digest_jobs.items() if v["status"] not in ("done", "failed")}

    return {
        "services": {
            "azure_openai": bool(get_secret("AZURE_OPENAI_ENDPOINT") and get_secret("AZURE_OPENAI_KEY")),
            "audd": bool(get_secret("AUDD_API_TOKEN")),
            "replicate": bool(get_secret("REPLICATE_API_TOKEN")),
            "spotify": bool(get_secret("SPOTIFY_CLIENT_ID") and get_secret("SPOTIFY_CLIENT_SECRET")),
            "tidal": bool(get_secret("TIDAL_CLIENT_ID") and get_secret("TIDAL_CLIENT_SECRET")),
        },
        "server": {
            "uptime": uptime_str,
            "uptime_seconds": uptime_secs,
            "git_commit": os.environ.get("RENDER_GIT_COMMIT", "local"),
            "yt_dlp_version": yt_dlp_ver,
            "ffmpeg_version": ffmpeg_ver,
            "python_version": sys.version.split()[0],
        },
        "active_jobs": {
            "downloads": active_downloads,
            "digests": active_digests,
        },
        "job_history": _job_history[-20:],
        "spotify_sessions_active": len(_spotify_user_sessions),
    }


@app.get("/admin")
async def admin_page():
    return FileResponse("static/admin.html")


# ── Privacy Policy (required by Tidal developer portal) ──────────────────────

@app.get("/privacy")
async def privacy_policy():
    return HTMLResponse("""<!DOCTYPE html><html><head><title>Privacy Policy — Simple Balance Music</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#e0e0e0;background:#0a0a0a;line-height:1.6}h1{color:#00BFFF}h2{color:#ccc;margin-top:24px}a{color:#00BFFF}</style>
</head><body>
<h1>Privacy Policy</h1>
<p><strong>Simple Balance Music</strong> — Last updated: March 2026</p>
<h2>What We Collect</h2>
<p>When you connect your Spotify or Tidal account, we access your public profile, playlists, and listening preferences solely to provide music recommendations and DJ set-building features.</p>
<h2>How We Use It</h2>
<p>Your data is used only within the app to power AI recommendations, search, and set curation. We do not sell, share, or transfer your data to third parties.</p>
<h2>Storage</h2>
<p>Session tokens are stored temporarily in server memory and in our Supabase database (encrypted at rest). You can disconnect at any time to revoke access.</p>
<h2>Third-Party Services</h2>
<p>We integrate with Spotify, Tidal, and Azure OpenAI. Each service has its own privacy policy governing data they process.</p>
<h2>Contact</h2>
<p>Questions? Email <a href="mailto:gcesintonia@gmail.com">gcesintonia@gmail.com</a></p>
<p><a href="/">Back to app</a></p>
</body></html>""")


# ── Static + Health ───────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.get("/sw.js")
async def serve_sw():
    return FileResponse("static/sw.js", media_type="application/javascript",
                        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"})

@app.get("/manifest.json")
async def serve_manifest():
    return FileResponse("static/manifest.json", media_type="application/json")

app.mount("/static", StaticFiles(directory="static"), name="static")
