const form = document.getElementById("downloadForm");
const urlInput = document.getElementById("urlInput");
const downloadBtn = document.getElementById("downloadBtn");
const statusLine = document.getElementById("statusLine");
const downloadLink = document.getElementById("downloadLink");

let activePoller = null;

function setStatus(status, detail = "") {
  statusLine.textContent = detail ? `${status}: ${detail}` : status;
  statusLine.dataset.state = status;
}

function resetDownloadLink() {
  downloadLink.hidden = true;
  downloadLink.href = "";
}

async function pollJob(jobId) {
  if (activePoller) {
    window.clearInterval(activePoller);
  }

  activePoller = window.setInterval(async () => {
    const response = await fetch(`/api/status/${jobId}`);
    const data = await response.json();

    if (!response.ok) {
      setStatus("error", data.error?.message || "Job not found.");
      downloadBtn.disabled = false;
      window.clearInterval(activePoller);
      activePoller = null;
      return;
    }

    if (data.status === "done") {
      setStatus("ready");
      downloadLink.href = `/api/file/${jobId}`;
      downloadLink.hidden = false;
      downloadBtn.disabled = false;
      window.clearInterval(activePoller);
      activePoller = null;
      return;
    }

    if (data.status === "error") {
      setStatus("error", data.error?.message || "Download failed.");
      downloadBtn.disabled = false;
      window.clearInterval(activePoller);
      activePoller = null;
      return;
    }

    if (data.status === "merging") {
      setStatus("merging");
      return;
    }

    setStatus("downloading");
  }, 1200);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const url = urlInput.value.trim();
  resetDownloadLink();

  if (!url) {
    setStatus("error", "Paste a YouTube URL.");
    return;
  }

  downloadBtn.disabled = true;
  setStatus("downloading");

  const response = await fetch("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, preset_id: "video-best" }),
  });
  const data = await response.json();

  if (!response.ok) {
    setStatus("error", data.error?.message || "Download failed.");
    downloadBtn.disabled = false;
    return;
  }

  pollJob(data.job_id);
});
