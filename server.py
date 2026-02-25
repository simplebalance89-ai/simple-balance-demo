import os
import time
import json
import httpx
import replicate
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from openai import AzureOpenAI

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


@app.post("/api/chat")
async def chat(payload: dict):
    """AI chat endpoint for JAW DJ Command and other modes."""
    client = get_ai_client()
    if not client:
        return JSONResponse({"error": "Azure OpenAI not configured"}, status_code=503)

    model = get_secret("AZURE_OPENAI_MODEL", "gpt-4o")
    system_prompt = payload.get("system", "You are J.A.W., an AI DJ advisor and energy flow guardian for Simple Balance Music. You help DJs build sets, find harmonic matches, analyze energy flow, and master their craft. Be knowledgeable, direct, and music-obsessed.")
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


@app.get("/api/spotify/search")
async def spotify_search(q: str, type: str = "track", limit: int = 10):
    """Search Spotify for tracks, artists, or albums."""
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
        return resp.json()


@app.get("/api/spotify/recommendations")
async def spotify_recommendations(seed_genres: str = "", seed_artists: str = "", seed_tracks: str = "",
                                   target_bpm: int = 0, limit: int = 10):
    """Get Spotify recommendations based on seeds."""
    token = await get_spotify_token()
    if not token:
        return JSONResponse({"error": "Spotify not configured"}, status_code=503)

    params = {"limit": limit}
    if seed_genres:
        params["seed_genres"] = seed_genres
    if seed_artists:
        params["seed_artists"] = seed_artists
    if seed_tracks:
        params["seed_tracks"] = seed_tracks
    if target_bpm:
        params["target_tempo"] = target_bpm

    if not any(k.startswith("seed_") for k in params):
        params["seed_genres"] = "electronic"

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.spotify.com/v1/recommendations",
            headers={"Authorization": f"Bearer {token}"},
            params=params,
        )
        resp.raise_for_status()
        data = resp.json()

    tracks = []
    for t in data.get("tracks", []):
        artists = ", ".join(a["name"] for a in t.get("artists", []))
        album = t.get("album", {})
        images = album.get("images", [])
        tracks.append({
            "title": t["name"],
            "artist": artists,
            "spotify_url": t.get("external_urls", {}).get("spotify"),
            "album_art": images[0]["url"] if images else None,
            "preview_url": t.get("preview_url"),
            "spotify_id": t["id"],
        })
    return {"tracks": tracks}


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


# ── API Status ────────────────────────────────────────────────────────────────

@app.get("/api/status")
async def api_status():
    return {
        "azure_openai": bool(get_secret("AZURE_OPENAI_ENDPOINT") and get_secret("AZURE_OPENAI_KEY")),
        "audd": bool(get_secret("AUDD_API_TOKEN")),
        "replicate": bool(get_secret("REPLICATE_API_TOKEN")),
        "spotify": bool(get_secret("SPOTIFY_CLIENT_ID") and get_secret("SPOTIFY_CLIENT_SECRET")),
    }


# ── Static + Health ───────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")
