import { el, formatStamp, humanSize, state } from "/static/shared.js";

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
