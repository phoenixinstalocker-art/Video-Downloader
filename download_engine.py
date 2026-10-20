import os
from urllib.parse import urlparse

import imageio_ffmpeg
import yt_dlp

from config_store import DEFAULT_COOKIE_DIR

FORMAT_PRESETS = {
    "video-best": {
        "label": "MP4 best quality",
        "format": "bestvideo+bestaudio/best",
        "ext": "mp4"
    },
    "video-1080": {
        "label": "MP4 1080p",
        "format": "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "ext": "mp4"
    },
    "video-720": {
        "label": "MP4 720p",
        "format": "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
        "ext": "mp4"
    },
    "audio-mp3": {
        "label": "MP3 Audio",
        "format": "bestaudio/best",
        "ext": "mp3"
    },
}


def is_valid_url(url):
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def is_supported_preset(preset_id):
    return preset_id in FORMAT_PRESETS


def _looks_like_netscape_cookie_file(path):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as handle:
            first_chunk = handle.read(512)
    except OSError:
        return False

    normalized = first_chunk.lower()
    return "netscape http cookie file" in normalized or "\t" in first_chunk


def resolve_cookie_file(settings):
    configured = (settings.get("cookie_file_path") or "").strip()
    if configured and os.path.isfile(configured) and _looks_like_netscape_cookie_file(configured):
        return os.path.abspath(configured)

    if not os.path.isdir(DEFAULT_COOKIE_DIR):
        return None

    preferred = []
    fallback = []
    for name in sorted(os.listdir(DEFAULT_COOKIE_DIR)):
        if not name.lower().endswith(".txt"):
            continue
        candidate = os.path.join(DEFAULT_COOKIE_DIR, name)
        if not os.path.isfile(candidate) or not _looks_like_netscape_cookie_file(candidate):
            continue
        if name.lower() == "cookies.txt":
            preferred.append(candidate)
        else:
            fallback.append(candidate)
    for candidate in preferred + fallback:
        return os.path.abspath(candidate)
    return None


def cookie_status(settings):
    cookie_file = resolve_cookie_file(settings)
    return {
        "loaded": bool(cookie_file),
        "path": cookie_file,
        "message": "Cookie loaded" if cookie_file else "Guest mode - some videos may fail",
    }


def ffmpeg_path():
    return imageio_ffmpeg.get_ffmpeg_exe()


def _base_ydl_options(cookie_file=None):
    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "ffmpeg_location": ffmpeg_path(),
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "referer": "https://www.google.com/",
        "nocheckcertificate": True,
    }
    if cookie_file:
        options["cookiefile"] = cookie_file
    return options


def fetch_media_info(url, settings):
    cookie_file = resolve_cookie_file(settings)
    options = _base_ydl_options(cookie_file)
    options.update({"skip_download": True})
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as exc:
        raise RuntimeError(str(exc)) from exc

    return {
        "title": info.get("title", ""),
        "thumbnail": info.get("thumbnail", ""),
        "duration": info.get("duration"),
        "uploader": info.get("uploader", ""),
        "source_domain": urlparse(url).netloc.replace("www.", ""),
        "cookie_status": cookie_status(settings),
    }


def build_download_options(job_id, preset_id, download_dir, cookie_file, progress_hook):
    preset = FORMAT_PRESETS.get(preset_id, FORMAT_PRESETS["video-best"])
    options = _base_ydl_options(cookie_file)
    options.update(
        {
            "format": preset["format"],
            "outtmpl": os.path.join(download_dir, f"{job_id}.%(ext)s"),
            "progress_hooks": [progress_hook],
        }
    )

    if preset["ext"] == "mp3":
        options.update({
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
        })
    else:
        options.update({
            "merge_output_format": "mp4",
            "postprocessors": [{"key": "FFmpegVideoConvertor", "preferedformat": "mp4"}],
        })

    return options


def run_download(url, options):
    with yt_dlp.YoutubeDL(options) as ydl:
        return ydl.extract_info(url, download=True)


def build_error(raw_error, has_cookie):
    text = (raw_error or "Download failed").strip()
    lower = text.lower()
    message = "Download failed."
    fix = "Try again in a moment."

    if (
        "unsupported url" in lower
        or "no suitable extractor" in lower
        or "unsupported site" in lower
        or "not supported" in lower
    ):
        message = "This platform isn't supported. Try a direct video URL."
        fix = "Try the original post URL or a direct media page link."
    elif (
        "sign in to confirm" in lower
        or "use --cookies" in lower
        or "cookies are required" in lower
        or "authentication required" in lower
        or "bot" in lower
    ):
        message = "This video needs an authenticated browser cookie."
        fix = (
            "Add a Netscape-format cookies.txt file to the cookies folder or set a cookie file path in Settings."
            if not has_cookie
            else "Refresh your exported cookies.txt file and try again."
        )
    elif "not a valid url" in lower:
        message = "That link does not look like a supported video URL."
        fix = "Paste the full page URL, including https://."
    elif "private video" in lower or "video unavailable" in lower:
        message = "This video is private or unavailable."
        fix = "Check that the link still works in your browser and that your cookie file has access."
    elif "members-only" in lower or "join this channel" in lower:
        message = "This video is limited to members or subscribers."
        fix = "Use a cookie file from an account that can view the video."
    elif "geo" in lower or "not available in your country" in lower:
        message = "This content is blocked in your region."
        fix = "Try a source that is available in your location."
    elif "too many requests" in lower or "rate-limit" in lower or "429" in lower:
        message = "The site is rate limiting requests right now."
        fix = "Wait a few minutes, then retry with a fresh cookie file if needed."
    elif "unable to extract" in lower or "precondition check failed" in lower:
        message = "The source site changed and yt-dlp could not read this video."
        fix = "Update yt-dlp, then try the link again."
    elif "http error 404" in lower or "404 not found" in lower:
        message = "This video link no longer exists."
        fix = "Open the URL in your browser to confirm it is still live."
    elif "403" in lower:
        message = "The site denied access to this media."
        fix = "If this is YouTube or another gated site, load a valid cookies.txt file and retry."
    elif "ffmpeg is required — install via: brew install ffmpeg / apt install ffmpeg" in lower:
        message = "ffmpeg is required — install via: brew install ffmpeg / apt install ffmpeg"
        fix = "Install ffmpeg, then retry the download."
    elif "ffmpeg" in lower and "not found" in lower:
        message = "ffmpeg is required — install via: brew install ffmpeg / apt install ffmpeg"
        fix = "Install ffmpeg, then retry the download."
    elif "nsig extraction failed" in lower:
        message = "YouTube changed something and this download could not be prepared."
        fix = "Update yt-dlp, then retry."

    return {"raw": text, "message": message, "fix": fix}


def sanitize_filename(name):
    clean = "".join(char for char in name if char not in r'\\/:*?"<>|').strip()
    return clean[:80] or "download"
