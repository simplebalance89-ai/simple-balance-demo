import os
import time
import json
import httpx
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
                "spotify_url": spotify_url,
                "apple_music_url": apple_url,
                "album_art": album_art,
                "label": song.get("label", ""),
                "album": song.get("album", ""),
            }

    tracks = sorted(seen_tracks.values(), key=lambda t: t["first_offset"])
    for i, track in enumerate(tracks):
        track["position"] = i + 1
        track["timestamp"] = format_timestamp(track["first_offset"])

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


# ── API Status ────────────────────────────────────────────────────────────────

@app.get("/api/status")
async def api_status():
    return {
        "azure_openai": bool(get_secret("AZURE_OPENAI_ENDPOINT") and get_secret("AZURE_OPENAI_KEY")),
        "audd": bool(get_secret("AUDD_API_TOKEN")),
        "replicate": bool(get_secret("REPLICATE_API_TOKEN")),
    }


# ── Static + Health ───────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")
