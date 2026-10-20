import json
import os
import threading
from copy import deepcopy
from datetime import datetime

BASE_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(BASE_DIR, "data")
DEFAULT_DOWNLOAD_DIR = os.path.join(BASE_DIR, "downloads")
DEFAULT_COOKIE_DIR = os.path.join(BASE_DIR, "cookies")
STATE_FILE = os.path.join(DATA_DIR, "app_state.json")
MAX_HISTORY = 20

DEFAULT_SETTINGS = {
    "download_dir": DEFAULT_DOWNLOAD_DIR,
    "default_format": "video-best",
    "cookie_file_path": "",
}

_LOCK = threading.Lock()


def ensure_storage():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(DEFAULT_DOWNLOAD_DIR, exist_ok=True)
    os.makedirs(DEFAULT_COOKIE_DIR, exist_ok=True)
    if not os.path.exists(STATE_FILE):
        with open(STATE_FILE, "w", encoding="utf-8") as handle:
            json.dump({"settings": deepcopy(DEFAULT_SETTINGS), "history": []}, handle, indent=2)


def _read_state():
    ensure_storage()
    with open(STATE_FILE, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_state(state):
    ensure_storage()
    with open(STATE_FILE, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2)


def load_state():
    with _LOCK:
        state = _read_state()
        state.setdefault("settings", {})
        state.setdefault("history", [])
        merged = deepcopy(DEFAULT_SETTINGS)
        merged.update(state["settings"])
        state["settings"] = merged
        return state


def save_settings(new_settings):
    with _LOCK:
        state = _read_state()
        settings = deepcopy(DEFAULT_SETTINGS)
        settings.update(state.get("settings", {}))
        settings.update(new_settings)
        settings["download_dir"] = os.path.abspath(settings["download_dir"])
        settings["cookie_file_path"] = os.path.abspath(settings["cookie_file_path"]) if settings["cookie_file_path"] else ""
        os.makedirs(settings["download_dir"], exist_ok=True)
        state["settings"] = settings
        _write_state(state)
        return settings


def add_history_entry(entry):
    with _LOCK:
        state = _read_state()
        history = state.get("history", [])
        payload = {
            "filename": entry["filename"],
            "source_domain": entry["source_domain"],
            "timestamp": entry.get("timestamp") or datetime.utcnow().isoformat() + "Z",
            "file_size": entry["file_size"],
        }
        history.insert(0, payload)
        state["history"] = history[:MAX_HISTORY]
        _write_state(state)
        return state["history"]
