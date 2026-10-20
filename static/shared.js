export const state = {
  presets: [],
  selectedPreset: "video-best",
  queue: [],
  history: [],
  polling: new Map(),
};

export const el = {
  appNotice: document.getElementById("appNotice"),
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

export const VIDEO_PRESETS = ["video-best", "video-1080", "video-720", "video-480"];
export const AUDIO_PRESETS = ["audio-mp3-320", "audio-mp3-128", "audio-ogg"];

export function humanSize(bytes) {
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

export function formatStamp(value) {
  if (!value) return "Unknown time";
  return new Date(value).toLocaleString();
}

export function getPresetLabel(id) {
  return state.presets.find((preset) => preset.id === id)?.label || id;
}

export function parseUrls(raw) {
  return [...new Set(raw.split(/[\n,\s]+/).map((value) => value.trim()).filter(Boolean))];
}

export function updateCookieStatus(cookieStatus) {
  el.cookieIndicator.classList.toggle("loaded", Boolean(cookieStatus.loaded));
  el.cookieIndicator.classList.toggle("guest", !cookieStatus.loaded);
  el.cookieLabel.textContent = cookieStatus.loaded ? "Cookie loaded" : "Guest mode - some videos may fail";
  el.guestNotice.classList.toggle("hidden", Boolean(cookieStatus.loaded));
}

export function showNotice(message, tone = "warning") {
  if (!message) {
    el.appNotice.className = "notice hidden";
    el.appNotice.textContent = "";
    return;
  }

  el.appNotice.className = `notice notice-${tone}`;
  el.appNotice.textContent = message;
}

export function renderPresetButtons(container, presetIds) {
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

export function renderSettings(settings, cookieFolder) {
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

export function renderHistory() {
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

export async function loadState() {
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

export async function saveSettings() {
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
