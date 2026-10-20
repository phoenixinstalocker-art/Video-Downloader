const state = {
  presets: [],
  selectedPreset: "video-best",
  queue: [],
  history: [],
  polling: new Map(),
};

const el = {
  cookieIndicator: document.getElementById("cookieIndicator"),
  cookieLabel: document.getElementById("cookieLabel"),
  guestNotice: document.getElementById("guestNotice"),
  urlInput: document.getElementById("urlInput"),
  queue: document.getElementById("queue"),
  history: document.getElementById("history"),
  downloadBtn: document.getElementById("downloadBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  settingsToggle: document.getElementById("settingsToggle"),
  settingsPanel: document.getElementById("settingsPanel"),
  downloadDirInput: document.getElementById("downloadDirInput"),
  cookiePathInput: document.getElementById("cookiePathInput"),
  defaultFormatSelect: document.getElementById("defaultFormatSelect"),
  cookieFolderPath: document.getElementById("cookieFolderPath"),
  videoFormats: document.getElementById("videoFormats"),
  audioFormats: document.getElementById("audioFormats"),
  template: document.getElementById("queueItemTemplate"),
};

const VIDEO_PRESETS = ["video-best", "video-1080", "video-720", "video-480"];
const AUDIO_PRESETS = ["audio-mp3-320", "audio-mp3-128", "audio-ogg"];

function humanSize(bytes) {
  if (!bytes) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatStamp(value) {
  if (!value) return "Unknown time";
  return new Date(value).toLocaleString();
}

function getPresetLabel(id) {
  return state.presets.find((preset) => preset.id === id)?.label || id;
}

function updateCookieStatus(cookieStatus) {
  el.cookieIndicator.classList.toggle("loaded", Boolean(cookieStatus.loaded));
  el.cookieIndicator.classList.toggle("guest", !cookieStatus.loaded);
  el.cookieLabel.textContent = cookieStatus.message;
  el.guestNotice.classList.toggle("hidden", Boolean(cookieStatus.loaded));
}

function renderPresetButtons(container, presetIds) {
  container.innerHTML = "";
  presetIds.forEach((id) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip ${state.selectedPreset === id ? "active" : ""}`;
    button.textContent = getPresetLabel(id);
    button.onclick = () => {
      state.selectedPreset = id;
      renderPresetButtons(el.videoFormats, VIDEO_PRESETS);
      renderPresetButtons(el.audioFormats, AUDIO_PRESETS);
    };
    container.appendChild(button);
  });
}

function renderSettings(settings, cookieFolder) {
  el.downloadDirInput.value = settings.download_dir;
  el.cookiePathInput.value = settings.cookie_file_path || "";
  el.cookieFolderPath.textContent = cookieFolder;
  el.defaultFormatSelect.innerHTML = "";
  state.presets.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    option.selected = preset.id === settings.default_format;
    el.defaultFormatSelect.appendChild(option);
  });
  if (!state.queue.length) {
    state.selectedPreset = settings.default_format;
    renderPresetButtons(el.videoFormats, VIDEO_PRESETS);
    renderPresetButtons(el.audioFormats, AUDIO_PRESETS);
  }
}

function renderHistory() {
  if (!state.history.length) {
    el.history.className = "history-list empty-state";
    el.history.textContent = "No completed downloads yet.";
    return;
  }

  el.history.className = "history-list";
  el.history.innerHTML = "";
  state.history.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "history-item";
    card.innerHTML = `
      <h3>${entry.filename}</h3>
      <p class="history-meta">${entry.source_domain} • ${formatStamp(entry.timestamp)} • ${humanSize(entry.file_size)}</p>
    `;
    el.history.appendChild(card);
  });
}

function queueStatusText(item) {
  if (item.status === "ready") return "Ready";
  if (item.status === "fetching") return "Inspecting";
  if (item.status === "downloading") return `${Math.round(item.percent || 0)}%`;
  if (item.status === "done") return "Completed";
  if (item.status === "error") return "Needs attention";
  return "Queued";
}

function queueStatsText(item) {
  if (item.status === "downloading") {
    return `${Math.round(item.percent || 0)}% • ${item.speed || "Preparing"} • ETA ${item.eta || "--:--"}`;
  }
  if (item.status === "done") {
    return `Saved as ${item.filename}`;
  }
  return `${getPresetLabel(item.presetId)} • ${item.sourceDomain || "Waiting for metadata"}`;
}

function renderQueue() {
  if (!state.queue.length) {
    el.queue.className = "queue-list empty-state";
    el.queue.textContent = "No downloads yet. Start with a link above.";
    return;
  }

  el.queue.className = "queue-list";
  el.queue.innerHTML = "";
  state.queue.forEach((item) => {
    const node = el.template.content.firstElementChild.cloneNode(true);
    node.querySelector(".queue-title").textContent = item.title || item.url;
    node.querySelector(".queue-meta").textContent = item.sourceDomain || "Loading metadata...";
    node.querySelector(".queue-status").textContent = queueStatusText(item);
    node.querySelector(".queue-stats").textContent = queueStatsText(item);
    node.querySelector(".progress-fill").style.width = `${item.percent || 0}%`;

    if (item.error) {
      const errorBox = node.querySelector(".queue-error");
      errorBox.classList.remove("hidden");
      errorBox.querySelector(".error-message").textContent = item.error.message;
      errorBox.querySelector(".error-fix").textContent = item.error.fix;
    }

    if (item.status === "done") {
      const saveButton = node.querySelector(".save-button");
      saveButton.classList.remove("hidden");
      saveButton.onclick = () => window.open(`/api/file/${item.jobId}`, "_blank");
    }

    el.queue.appendChild(node);
  });
}

async function loadState() {
  const response = await fetch("/api/state");
  const data = await response.json();
  state.presets = data.format_presets;
  state.history = data.history;
  updateCookieStatus(data.cookie_status);
  renderSettings(data.settings, data.cookie_folder);
  renderPresetButtons(el.videoFormats, VIDEO_PRESETS);
  renderPresetButtons(el.audioFormats, AUDIO_PRESETS);
  renderHistory();
}

async function saveSettings() {
  const payload = {
    download_dir: el.downloadDirInput.value.trim(),
    default_format: el.defaultFormatSelect.value,
    cookie_file_path: el.cookiePathInput.value.trim(),
  };
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  state.selectedPreset = data.settings.default_format;
  updateCookieStatus(data.cookie_status);
  renderPresetButtons(el.videoFormats, VIDEO_PRESETS);
  renderPresetButtons(el.audioFormats, AUDIO_PRESETS);
}

function addQueueItem(url) {
  const item = {
    id: crypto.randomUUID(),
    url,
    title: "",
    sourceDomain: "",
    status: "fetching",
    percent: 0,
    error: null,
    presetId: state.selectedPreset,
  };
  state.queue.unshift(item);
  renderQueue();
  return item;
}

function parseUrls(raw) {
  return [...new Set(raw.split(/[\n,\s]+/).map((value) => value.trim()).filter(Boolean))];
}

async function fetchInfo(item) {
  const response = await fetch("/api/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: item.url }),
  });
  const data = await response.json();
  if (!response.ok) throw data.error;
  item.title = data.title || item.url;
  item.sourceDomain = data.source_domain;
  item.status = "ready";
}

async function startDownload(item) {
  const response = await fetch("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: item.url, title: item.title, preset_id: item.presetId }),
  });
  const data = await response.json();
  if (!response.ok) throw data.error;
  item.jobId = data.job_id;
  item.status = "downloading";
  pollJob(item);
}

async function pollJob(item) {
  const poller = window.setInterval(async () => {
    const response = await fetch(`/api/status/${item.jobId}`);
    const data = await response.json();
    if (!response.ok) {
      item.status = "error";
      item.error = data.error;
      window.clearInterval(poller);
      renderQueue();
      return;
    }

    item.percent = data.percent || 0;
    item.speed = data.speed || "";
    item.eta = data.eta || "";
    item.filename = data.filename || "";
    item.status = data.status;
    item.error = data.error || null;
    renderQueue();

    if (data.status === "done" || data.status === "error") {
      window.clearInterval(poller);
      state.polling.delete(item.id);
      if (data.status === "done") {
        await loadState();
      }
    }
  }, 1200);

  state.polling.set(item.id, poller);
}

async function handleDownload() {
  el.downloadBtn.disabled = true;
  const urls = parseUrls(el.urlInput.value);
  if (!urls.length) {
    el.downloadBtn.disabled = false;
    return;
  }

  for (const url of urls) {
    const item = addQueueItem(url);
    try {
      await fetchInfo(item);
      await startDownload(item);
    } catch (error) {
      item.status = "error";
      item.error = error || { message: "Something went wrong.", fix: "Try again." };
    }
    renderQueue();
  }

  el.downloadBtn.disabled = false;
}

el.downloadBtn.addEventListener("click", handleDownload);
el.saveSettingsBtn.addEventListener("click", saveSettings);
el.settingsToggle.addEventListener("click", () => el.settingsPanel.classList.toggle("hidden"));
el.urlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleDownload();
  }
});

loadState();
