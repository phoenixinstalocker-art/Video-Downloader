import glob
import os
import threading
import uuid
from datetime import datetime
from urllib.parse import urlparse

from flask import Flask, jsonify, render_template, request, send_file

from config_store import DEFAULT_COOKIE_DIR, add_history_entry, ensure_storage, load_state, save_settings
from download_engine import (
    FORMAT_PRESETS,
    build_download_options,
    build_error,
    cookie_status,
    fetch_media_info,
    is_valid_url,
    is_supported_preset,
    run_download as run_media_download,
    resolve_cookie_file,
    sanitize_filename,
)

app = Flask(__name__)
ensure_storage()
jobs = {}


def current_settings():
    return load_state()["settings"]


def state_payload():
    state = load_state()
    status = cookie_status(state["settings"])
    if not status["loaded"]:
        status["message"] = "Guest mode - some videos may fail"
    return {
        "settings": state["settings"],
        "history": state["history"],
        "cookie_status": status,
        "cookie_folder": DEFAULT_COOKIE_DIR,
        "format_presets": [{"id": key, "label": value["label"]} for key, value in FORMAT_PRESETS.items()],
    }


def complete_job(job_id, final_path=None):
    job = jobs[job_id]
    chosen = final_path
    if not chosen:
        pattern = os.path.join(job["download_dir"], f"{job_id}.*")
        files = [path for path in glob.glob(pattern) if not path.endswith((".part", ".ytdl"))]
        if not files:
            raise FileNotFoundError("Download completed but no final file was found.")
        chosen = max(files, key=os.path.getmtime)

    ext = os.path.splitext(chosen)[1]
    title = job.get("title") or os.path.splitext(os.path.basename(chosen))[0]
    filename = f"{sanitize_filename(title)}{ext}"
    job.update({"status": "done", "file": chosen, "filename": filename, "percent": 100, "speed": "", "eta": ""})
    add_history_entry(
        {
            "filename": filename,
            "source_domain": urlparse(job["url"]).netloc.replace("www.", ""),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "file_size": os.path.getsize(chosen),
        }
    )


def run_download(job_id, url, preset_id):
    settings = current_settings()
    cookie_file = resolve_cookie_file(settings)
    job = jobs[job_id]
    job["download_dir"] = settings["download_dir"]

    try:
        def progress_hook(progress):
            status = progress.get("status")
            if status == "downloading":
                total = progress.get("total_bytes") or progress.get("total_bytes_estimate") or 0
                downloaded = progress.get("downloaded_bytes", 0)
                percent = (downloaded / total * 100) if total else job.get("percent", 0)
                speed = progress.get("speed") or ""
                eta = progress.get("eta")
                job.update(
                    {
                        "status": "downloading",
                        "percent": round(percent, 2),
                        "speed": f"{round(speed / 1024 / 1024, 2)} MiB/s" if speed else "",
                        "eta": f"{eta}s" if eta is not None else "",
                    }
                )
            elif status == "finished":
                job.update({"status": "merging", "speed": "", "eta": ""})

        options = build_download_options(job_id, preset_id, settings["download_dir"], cookie_file, progress_hook)
        info = run_media_download(url, options) or {}
        job["title"] = info.get("title") or job.get("title") or ""
        complete_job(job_id)
    except Exception as exc:
        job["status"] = "error"
        job["error"] = build_error(str(exc), bool(cookie_file))


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/state")
def get_state():
    return jsonify(state_payload())


@app.route("/api/settings", methods=["POST"])
def update_settings():
    current = current_settings()
    data = request.get_json(silent=True) or {}
    preset_id = data.get("default_format") or current["default_format"]
    if not is_supported_preset(preset_id):
        return jsonify({"error": {"message": "That format option is not available.", "fix": "Pick one of the listed presets and save again."}}), 400
    settings = save_settings(
        {
            "download_dir": data.get("download_dir") or current["download_dir"],
            "default_format": preset_id,
            "cookie_file_path": (data.get("cookie_file_path") or "").strip(),
        }
    )
    status = cookie_status(settings)
    if not status["loaded"]:
        status["message"] = "Guest mode - some videos may fail"
    return jsonify({"settings": settings, "cookie_status": status})


@app.route("/api/info", methods=["POST"])
def get_info():
    url = ((request.get_json(silent=True) or {}).get("url") or "").strip()
    settings = current_settings()
    if not is_valid_url(url):
        return jsonify({"error": build_error("not a valid url", bool(resolve_cookie_file(settings)))}), 400
    try:
        return jsonify(fetch_media_info(url, settings))
    except Exception as exc:
        return jsonify({"error": build_error(str(exc), bool(resolve_cookie_file(settings)))}), 400


@app.route("/api/download", methods=["POST"])
def start_download():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    settings = current_settings()
    preset_id = data.get("preset_id") or settings["default_format"]
    if not is_valid_url(url):
        return jsonify({"error": build_error("not a valid url", bool(resolve_cookie_file(settings)))}), 400
    if not is_supported_preset(preset_id):
        return jsonify({"error": {"message": "That format option is not available.", "fix": "Choose another preset and retry the download."}}), 400

    job_id = uuid.uuid4().hex[:10]
    jobs[job_id] = {
        "status": "fetching",
        "url": url,
        "title": data.get("title") or "",
        "percent": 0,
        "speed": "",
        "eta": "",
        "preset_id": preset_id,
    }
    threading.Thread(target=run_download, args=(job_id, url, preset_id), daemon=True).start()
    return jsonify({"job_id": job_id})


@app.route("/api/status/<job_id>")
def check_status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": {"message": "Job not found.", "fix": "Start a new download from the main screen."}}), 404
    return jsonify(
        {
            "status": job["status"],
            "filename": job.get("filename"),
            "percent": job.get("percent", 0),
            "speed": job.get("speed", ""),
            "eta": job.get("eta", ""),
            "error": job.get("error"),
        }
    )


@app.route("/api/file/<job_id>")
def download_file(job_id):
    job = jobs.get(job_id)
    if not job or job["status"] != "done":
        return jsonify({"error": {"message": "File not ready.", "fix": "Wait for the download to finish and try again."}}), 404
    return send_file(job["file"], as_attachment=True, download_name=job["filename"])


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8899))
    host = os.environ.get("HOST", "127.0.0.1")
    app.run(host=host, port=port)
