import {
  AUDIO_PRESETS,
  VIDEO_PRESETS,
  el,
  getPresetLabel,
  renderPresetButtons as renderButtons,
  showNotice,
  state,
  updateCookieStatus,
} from "/static/shared.js";
import { renderHistory } from "/static/history.js";

export function renderPresetButtons(container, presetIds) {
  renderButtons(container, presetIds);
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
  }

  renderButtons(el.videoFormats, VIDEO_PRESETS);
  renderButtons(el.audioFormats, AUDIO_PRESETS);
}

export async function loadState() {
  const response = await fetch("/api/state");
  const data = await response.json();
  state.presets = data.format_presets;
  state.history = data.history;
  updateCookieStatus(data.cookie_status);
  renderSettings(data.settings, data.cookie_folder);
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
  if (!response.ok) {
    showNotice(`${data.error.message} ${data.error.fix}`, "danger");
    return;
  }

  state.selectedPreset = data.settings.default_format;
  updateCookieStatus(data.cookie_status);
  renderButtons(el.videoFormats, VIDEO_PRESETS);
  renderButtons(el.audioFormats, AUDIO_PRESETS);
  showNotice(`Settings saved. Default format: ${getPresetLabel(data.settings.default_format)}.`, "success");
}
