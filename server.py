import os
import time
import json
import secrets
import logging
import subprocess
import httpx
import replicate
from urllib.parse import urlencode
import asyncio
from fastapi import FastAPI, UploadFile, File, HTTPException, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from openai import AzureOpenAI

logger = logging.getLogger(__name__)

app = FastAPI(title="Simple Balance Music")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

def extract_audio_url(url: str) -> dict:
    """Use yt-dlp to extract a direct audio stream URL from YouTube/SoundCloud/Mixcloud.
    Returns dict with audio_url, title, uploader, duration, thumbnail or error."""
    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "--no-download",
                "--print-json",
                "-f", "bestaudio/best",
                "--no-playlist",
                "--no-warnings",
                "--extractor-args", "youtube:player_client=android",
                "--geo-bypass",
                url,
            ],
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


@app.post("/api/digestor")
async def digestor(file: UploadFile = File(...)):
    """Extract tracklist from uploaded DJ mix via AudD Enterprise."""
    token = get_secret("AUDD_API_TOKEN")
    if not token:
        return JSONResponse({"error": "AudD API token not configured"}, status_code=503)

    file_data = await file.read()
    if len(file_data) == 0:
        return JSONResponse({"error": "Empty file"}, status_code=400)

    data = {
        "api_token": token,
        "accurate_offsets": "true",
        "return": "spotify,apple_music,deezer",
        "skip": "2",
        "every": "5",
    }

    try:
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.post(
                AUDD_API_URL,
                data=data,
                files={"file": (file.filename or "mix.mp3", file_data, file.content_type or "audio/mpeg")},
            )
            response.raise_for_status()
            result = response.json()

        if "result" not in result:
            error_msg = result.get("error", {}).get("error_message", "Unknown error from AudD")
            return JSONResponse({"error": error_msg, "tracks": []}, status_code=200)

        return parse_enterprise_result(result["result"])

    except httpx.TimeoutException:
        return JSONResponse({"error": "Request timed out. Mix may be too large.", "tracks": []}, status_code=200)
    except Exception as e:
        return JSONResponse({"error": str(e), "tracks": []}, status_code=500)


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
            # Use YouTube's internal player API with ANDROID client — bypasses cloud IP blocking
            api_resp = await client.post(
                "https://www.youtube.com/youtubei/v1/player",
                json={
                    "videoId": video_id,
                    "context": {"client": {"clientName": "ANDROID", "clientVersion": "19.09.37", "androidSdkVersion": 30}},
                },
                headers={"Content-Type": "application/json"},
            )
            api_data = api_resp.json()

        video_details = api_data.get("videoDetails", {})
        raw_desc = video_details.get("shortDescription", "")
        if not raw_desc:
            logger.warning("No description from YouTube API for %s", video_id)
            return None

        logger.info("YouTube API: got description (%d chars) for %s", len(raw_desc), video_id)

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

        duration = int(video_details.get("lengthSeconds", 0))
        thumbnails = video_details.get("thumbnail", {}).get("thumbnails", [])
        thumbnail_url = thumbnails[-1]["url"] if thumbnails else None

        metadata = {
            "title": video_details.get("title", "Unknown"),
            "uploader": video_details.get("author", "Unknown"),
            "duration": duration,
            "thumbnail": thumbnail_url,
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
    1. YouTube → try description tracklist (instant, free)
    2. Fallback → yt-dlp download + AudD fingerprint (works for SC/MC)"""
    job = _digest_jobs[job_id]
    token = get_secret("AUDD_API_TOKEN")
    tmp_path = None

    try:
        # Strategy 1: YouTube description tracklist (fast path)
        if _extract_youtube_id(url):
            job["status"] = "extracting"
            yt_result = await _try_youtube_description(url)
            if yt_result and len(yt_result.get("tracks", [])) >= 3:
                job["metadata"] = yt_result["metadata"]
                job["result"] = yt_result
                job["status"] = "done"
                logger.info("YouTube description tracklist: %s — %d tracks", yt_result["metadata"]["title"], len(yt_result["tracks"]))
                return
            # No tracklist in description — fall through to AudD

        # Strategy 2: yt-dlp + AudD audio fingerprinting
        # Step 1: Extract metadata via yt-dlp (quick, no download)
        job["status"] = "extracting"
        info = extract_audio_url(url)
        if "error" in info:
            job["status"] = "failed"
            job["error"] = info["error"]
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

        dl_result = subprocess.run(
            [
                "yt-dlp",
                "-f", "bestaudio/best",
                "--no-playlist",
                "--no-warnings",
                "--extractor-args", "youtube:player_client=android",
                "--geo-bypass",
                "-o", tmp_template,
                url,
            ],
            capture_output=True,
            text=True,
            timeout=300,  # 5 min download timeout
        )

        if dl_result.returncode != 0:
            job["status"] = "failed"
            job["error"] = f"Download failed: {dl_result.stderr.strip()[:300]}"
            return

        # Find the downloaded file
        import glob as glob_mod
        matches = glob_mod.glob(os.path.join(tmp_dir, f"digest_{job_id}.*"))
        if not matches:
            job["status"] = "failed"
            job["error"] = "Download completed but no file found."
            return
        tmp_path = matches[0]
        file_size = os.path.getsize(tmp_path)
        logger.info("Downloaded %s (%.1f MB)", tmp_path, file_size / 1024 / 1024)

        # Step 3: Upload file to AudD Enterprise API
        job["status"] = "scanning"
        logger.info("AudD scanning: %s", job["metadata"]["title"])
        data = {
            "api_token": token,
            "accurate_offsets": "true",
            "return": "spotify,apple_music,deezer",
            "skip": "2",
            "every": "5",
        }

        with open(tmp_path, "rb") as f:
            file_data = f.read()

        async with httpx.AsyncClient(timeout=900) as client:
            response = await client.post(
                AUDD_API_URL,
                data=data,
                files={"file": (os.path.basename(tmp_path), file_data, "audio/mpeg")},
            )
            response.raise_for_status()
            result = response.json()

        if "result" not in result:
            error_msg = result.get("error", {}).get("error_message", "Unknown error from AudD")
            job["status"] = "failed"
            job["error"] = error_msg
            return

        # Step 4: Parse results
        job["status"] = "parsing"
        parsed = parse_enterprise_result(result["result"])
        parsed["metadata"] = job["metadata"]
        job["result"] = parsed
        job["status"] = "done"
        logger.info("Digest complete: %s — %d tracks found", job["metadata"]["title"], len(parsed.get("tracks", [])))

    except subprocess.TimeoutExpired:
        job["status"] = "failed"
        job["error"] = "Audio download timed out (5 min). Try a shorter mix."
    except httpx.TimeoutException:
        job["status"] = "failed"
        job["error"] = "AudD processing timed out (15 min). The mix may be too long."
    except Exception as e:
        logger.error("Digest job %s failed: %s", job_id, e)
        job["status"] = "failed"
        job["error"] = str(e)
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
async def archive_upload(file: UploadFile = File(...)):
    """Accept audio file upload, store filename + metadata in memory."""
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
    return {"message": "Mix archived successfully", "entry": entry, "total": len(mix_archive)}


@app.get("/api/archive")
async def archive_list():
    """Return list of archived mixes."""
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
async def dashboard():
    """Return production stats (mock data + real archive count)."""
    return {
        "tracks_mastered": 12,
        "sets_built": 3,
        "stems_separated": 8,
        "mixes_archived": len(mix_archive),
        "discovery_sessions": 15
    }


# ── Spotify (Client Credentials) ─────────────────────────────────────────────

import base64
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
    # Prefer user token if logged in, else fall back to client credentials
    token = _spotify_user_sessions.get(session, {}).get("access_token") if session else None
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

_spotify_user_sessions = {}  # {session_id: {access_token, refresh_token, user}}

SPOTIFY_REDIRECT_URI = os.environ.get(
    "SPOTIFY_REDIRECT_URI", "https://simple-balance-demo.onrender.com/api/spotify/callback"
)


@app.get("/api/spotify/login")
async def spotify_login():
    """Redirect to Spotify authorization page."""
    client_id = get_secret("SPOTIFY_CLIENT_ID")
    if not client_id:
        return JSONResponse({"error": "Spotify not configured"}, status_code=503)
    scope = "user-read-private user-read-email playlist-read-private"
    state = secrets.token_urlsafe(16)
    params = urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": SPOTIFY_REDIRECT_URI,
        "scope": scope,
        "state": state,
    })
    return RedirectResponse(f"https://accounts.spotify.com/authorize?{params}")


@app.get("/api/spotify/callback")
async def spotify_callback(code: str = "", error: str = ""):
    """Handle Spotify OAuth callback — exchange code for tokens, get user profile."""
    if error or not code:
        return HTMLResponse(
            "<html><body><script>if(window.opener){window.opener.postMessage({spotify_error:'"
            + (error or "no_code") + "'},'*');window.close()}else{window.location.href='/'}</script></body></html>"
        )

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
    except Exception as e:
        return HTMLResponse(
            f"<html><body><script>if(window.opener){{window.opener.postMessage({{spotify_error:'auth_failed'}},'*');window.close()}}else{{window.location.href='/'}}</script></body></html>"
        )

    session_id = secrets.token_urlsafe(32)
    _spotify_user_sessions[session_id] = {
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "user": {
            "id": user.get("id", ""),
            "name": user.get("display_name", "Spotify User"),
            "email": user.get("email", ""),
            "image": (user.get("images") or [{}])[0].get("url") if user.get("images") else None,
            "product": user.get("product", "free"),
        },
    }

    # Return HTML that sends session to parent window (popup flow) or redirects (full-page flow)
    return HTMLResponse(
        f"""<!DOCTYPE html><html><body><script>
if (window.opener) {{
    window.opener.postMessage({{spotify_session: '{session_id}'}}, '*');
    window.close();
}} else {{
    window.location.href = '/?spotify_session={session_id}';
}}
</script><p>Connecting to Spotify...</p></body></html>"""
    )


@app.get("/api/spotify/me")
async def spotify_me(session: str = ""):
    """Get current Spotify user profile."""
    if session not in _spotify_user_sessions:
        return JSONResponse({"error": "Not logged in", "logged_in": False}, status_code=401)
    return {"logged_in": True, "user": _spotify_user_sessions[session]["user"]}


@app.get("/api/spotify/user/playlists")
async def spotify_user_playlists(session: str = ""):
    """Get the logged-in user's Spotify playlists."""
    if session not in _spotify_user_sessions:
        return JSONResponse({"error": "Not logged in"}, status_code=401)
    token = _spotify_user_sessions[session]["access_token"]
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


# ── Tidal (Client Credentials) ──────────────────────────────────────────────

_tidal_token = {"access_token": None, "expires_at": datetime.min}


async def get_tidal_token():
    """Get a Tidal access token using Client Credentials flow. Caches until expiry."""
    global _tidal_token
    if _tidal_token["access_token"] and datetime.now() < _tidal_token["expires_at"]:
        return _tidal_token["access_token"]

    client_id = get_secret("TIDAL_CLIENT_ID")
    client_secret = get_secret("TIDAL_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None

    try:
        auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://auth.tidal.com/v1/oauth2/token",
                headers={
                    "Authorization": f"Basic {auth}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={"grant_type": "client_credentials"},
            )
            resp.raise_for_status()
            data = resp.json()
            _tidal_token["access_token"] = data["access_token"]
            _tidal_token["expires_at"] = datetime.now() + timedelta(seconds=data.get("expires_in", 86400) - 60)
            return _tidal_token["access_token"]
    except httpx.HTTPStatusError as e:
        print(f"[Tidal] Auth failed: {e.response.status_code} - {e.response.text[:200]}")
        return None
    except Exception as e:
        print(f"[Tidal] Auth error: {e}")
        return None


async def tidal_search_tracks(http, token, query, limit=3, country="US"):
    """Search Tidal for tracks. Returns list of simplified track objects."""
    try:
        resp = await http.get(
            "https://openapi.tidal.com/search",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/vnd.tidal.v1+json",
            },
            params={"query": query, "type": "TRACKS", "limit": limit, "countryCode": country},
        )
        if resp.status_code != 200:
            return []
        data = resp.json()
        items = data.get("tracks", [])
        if isinstance(items, dict):
            items = items.get("items", [])
        results = []
        for item in items:
            resource = item.get("resource", item)
            artists = ", ".join(a.get("name", "") for a in resource.get("artists", []))
            cover = None
            if resource.get("imageCover"):
                covers = resource["imageCover"]
                if isinstance(covers, list) and covers:
                    cover = covers[0].get("url")
            results.append({
                "id": resource.get("id"),
                "title": resource.get("title", ""),
                "artist": artists,
                "url": f"https://tidal.com/track/{resource.get('id', '')}",
                "album_art": cover,
            })
        return results
    except Exception:
        return []


@app.get("/api/tidal/search")
async def tidal_search(q: str, limit: int = 10, countryCode: str = "US"):
    """Search Tidal catalog for tracks."""
    token = await get_tidal_token()
    if not token:
        has_creds = bool(get_secret("TIDAL_CLIENT_ID") and get_secret("TIDAL_CLIENT_SECRET"))
        msg = "Tidal auth failed (credentials set but token request failed)" if has_creds else "Tidal not configured"
        return JSONResponse({"error": msg, "configured": has_creds}, status_code=503)

    async with httpx.AsyncClient(timeout=15) as http:
        results = await tidal_search_tracks(http, token, q, limit, countryCode)
    return {"tracks": results}


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
    tidal_token = await get_tidal_token()
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

            # Tidal search
            if tidal_token:
                tidal_results = await tidal_search_tracks(http, tidal_token, query, limit=1)
                if tidal_results:
                    entry["tidal"] = tidal_results[0]

            enriched.append(entry)

    return {
        "tracks": enriched,
        "source": "ai",
        "platforms": {"spotify": bool(spotify_token), "tidal": bool(tidal_token)},
    }


# ── Manual Profile Builder ──────────────────────────────────────────────────

@app.post("/api/profile/build")
async def build_profile(payload: dict):
    """Build a taste profile from manually entered favorites. No streaming account needed."""
    client = get_ai_client()
    if not client:
        return JSONResponse({"error": "Azure OpenAI not configured"}, status_code=503)

    model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")
    favorites = payload.get("favorites", [])

    if len(favorites) < 3:
        return JSONResponse({"error": "Add at least 3 favorites"}, status_code=400)

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

        # Enrich recommendations with Spotify + Tidal links
        recs = result.get("recommendations", [])
        spotify_token = await get_spotify_token()
        tidal_token = await get_tidal_token()

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
                        tidal_results = await tidal_search_tracks(http, tidal_token, query, limit=1)
                        if tidal_results:
                            rec["tidal"] = tidal_results[0]

        return result
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


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
async def spotify_playlist_tracks(playlist_id: str, limit: int = 50):
    """Get tracks from a playlist with audio features for seeding."""
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
    }


# ── Static + Health ───────────────────────────────────────────────────────────

@app.get("/api/debug/yt/{video_id}")
async def debug_youtube(video_id: str):
    """Temporary debug endpoint to test YouTube API from Render."""
    import re as _re
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://www.youtube.com/youtubei/v1/player",
                json={"videoId": video_id, "context": {"client": {"clientName": "ANDROID", "clientVersion": "19.09.37", "androidSdkVersion": 30}}},
                headers={"Content-Type": "application/json"},
            )
        data = resp.json()
        vd = data.get("videoDetails", {})
        desc = vd.get("shortDescription", "")
        tracks = _re.findall(r'(?:^|\n)\s*(?:\d+[\.\)]\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)', desc)
        return {
            "status_code": resp.status_code,
            "has_video_details": bool(vd),
            "title": vd.get("title"),
            "author": vd.get("author"),
            "desc_length": len(desc),
            "desc_preview": desc[:500],
            "timestamp_tracks": len(tracks),
            "playability": data.get("playabilityStatus", {}).get("status"),
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")
