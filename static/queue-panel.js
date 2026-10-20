import { el, getPresetLabel, parseUrls, showNotice, state } from "/static/shared.js";
import { loadState } from "/static/settings.js";

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
    return `${Math.round(item.percent || 0)}% - ${item.speed || "Preparing"} - ETA ${item.eta || "--:--"}`;
  }
  if (item.status === "done") {
    return `Saved as ${item.filename}`;
  }
  return `${getPresetLabel(item.presetId)} - ${item.sourceDomain || "Waiting for metadata"}`;
}

export function renderQueue() {
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

function pollJob(item) {
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
      if (data.status === "done") await loadState();
    }
  }, 1200);

  state.polling.set(item.id, poller);
}

export async function handleDownload() {
  el.downloadBtn.disabled = true;
  showNotice("");
  const urls = parseUrls(el.urlInput.value);
  if (!urls.length) {
    showNotice("Paste at least one full video URL to start a download.", "warning");
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
      showNotice(`${item.error.message} ${item.error.fix}`, "danger");
    }
    renderQueue();
  }

  el.downloadBtn.disabled = false;
}
