(() => {
  const STORAGE_KEY = "patternlabCapturedCandles";
  const CAPTURED_TOAST_TEXT = "Candle captured";
  const IMPORTED_TOAST_TEXT = "Candles imported";
  const isTradingView = window.location.hostname === "www.tradingview.com";

  function parseNumber(value) {
    if (typeof value !== "string") return NaN;
    const cleaned = value.replace(/,/g, "").trim();
    return Number(cleaned);
  }

  function formatTimeFromTimestamp(timestamp) {
    return new Date(Number(timestamp)).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.position = "fixed";
    toast.style.bottom = "24px";
    toast.style.right = "24px";
    toast.style.padding = "10px 14px";
    toast.style.borderRadius = "8px";
    toast.style.background = "rgba(15, 23, 42, 0.95)";
    toast.style.color = "#fff";
    toast.style.font = "13px/1.3 Arial, sans-serif";
    toast.style.zIndex = "999999";
    toast.style.boxShadow = "0 8px 20px rgba(0,0,0,0.25)";

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1400);
  }

  function captureRow(row) {
    const timestampRaw = row.getAttribute("data-row-time");
    const ohlcNodes = row.querySelectorAll("td[data-copy-value]");

    if (!timestampRaw || ohlcNodes.length < 4) {
      return null;
    }

    const timestamp = Number(timestampRaw);
    const [open, high, low, close] = [...ohlcNodes].slice(0, 4).map((cell) => {
      return parseNumber(cell.getAttribute("data-copy-value") || cell.textContent || "");
    });

    if ([open, high, low, close].some(Number.isNaN)) {
      return null;
    }

    return {
      time: formatTimeFromTimestamp(timestamp),
      timestamp,
      open,
      high,
      low,
      close
    };
  }

  function upsertCandle(candle) {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const current = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      const deduped = current.filter((item) => Number(item.timestamp) !== Number(candle.timestamp));
      deduped.push(candle);
      deduped.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

      chrome.storage.local.set({ [STORAGE_KEY]: deduped }, () => {
        showToast(CAPTURED_TOAST_TEXT);
      });
    });
  }

  function attachTradingViewCapture() {
    const handleCapture = (event) => {
      const isContextMenu = event.type === "contextmenu";
      const isAltClick = event.type === "click" && event.altKey;

      if (!isContextMenu && !isAltClick) return;

      const row = event.target.closest("tr[data-row-time]");
      if (!row) return;

      event.preventDefault();
      event.stopPropagation();

      const candle = captureRow(row);
      if (!candle) return;

      upsertCandle(candle);
    };

    document.addEventListener("contextmenu", handleCapture, true);
    document.addEventListener("click", handleCapture, true);
  }

  // Listener de importación para PatternLab (inyectado vía popup cuando haga falta).
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "IMPORT_CANDLES") return;

    const candles = Array.isArray(message.candles) ? message.candles : [];
    if (candles.length === 0) {
      sendResponse({ ok: false, reason: "No candles provided" });
      return;
    }

    window.postMessage(
      {
        type: "patternlab-import-candles",
        candles
      },
      "*"
    );

    showToast(IMPORTED_TOAST_TEXT);
    sendResponse({ ok: true, imported: candles.length });
  });

  if (isTradingView) {
    attachTradingViewCapture();
  }
})();
