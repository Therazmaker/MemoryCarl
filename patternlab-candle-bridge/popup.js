const STORAGE_KEY = "patternlabCapturedCandles";
const PATTERNLAB_HINT = "patternlab";

const candlesList = document.getElementById("candlesList");
const emptyState = document.getElementById("emptyState");
const statusNode = document.getElementById("status");

const sendButton = document.getElementById("sendButton");
const copyButton = document.getElementById("copyButton");
const clearButton = document.getElementById("clearButton");

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.style.color = isError ? "#b91c1c" : "#0f172a";
}

function getCapturedCandles() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const candles = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      resolve(candles);
    });
  });
}

function setCapturedCandles(candles) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: candles }, () => resolve());
  });
}

function renderCandles(candles) {
  candlesList.innerHTML = "";

  if (candles.length === 0) {
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";
  candles
    .slice()
    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
    .forEach((candle) => {
      const item = document.createElement("li");
      item.textContent = `${candle.time} ${candle.open} → ${candle.close}`;
      candlesList.appendChild(item);
    });
}

async function refreshList() {
  const candles = await getCapturedCandles();
  renderCandles(candles);
}

function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]);
    });
  });
}

function executeScript(tabId, files) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

function sendMessage(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

sendButton.addEventListener("click", async () => {
  const candles = await getCapturedCandles();
  if (candles.length === 0) {
    setStatus("No hay velas capturadas.", true);
    return;
  }

  const activeTab = await queryActiveTab();
  if (!activeTab || !activeTab.id) {
    setStatus("No se encontró la pestaña activa.", true);
    return;
  }

  const url = activeTab.url || "";
  if (!url.toLowerCase().includes(PATTERNLAB_HINT)) {
    setStatus("Abre una pestaña de PatternLab para importar.", true);
    return;
  }

  try {
    await executeScript(activeTab.id, ["content.js"]);
    const response = await sendMessage(activeTab.id, {
      type: "IMPORT_CANDLES",
      candles
    });

    if (!response || !response.ok) {
      setStatus("PatternLab no confirmó la importación.", true);
      return;
    }

    setStatus(`Imported ${response.imported} candles`);
  } catch (error) {
    setStatus(`Error al enviar: ${error.message}`, true);
  }
});

copyButton.addEventListener("click", async () => {
  const candles = await getCapturedCandles();
  if (candles.length === 0) {
    setStatus("No hay velas para copiar.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(candles, null, 2));
    setStatus("JSON copiado al portapapeles.");
  } catch (error) {
    setStatus("No se pudo copiar JSON.", true);
  }
});

clearButton.addEventListener("click", async () => {
  await setCapturedCandles([]);
  await refreshList();
  setStatus("Lista limpiada.");
});

refreshList();
