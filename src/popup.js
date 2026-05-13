// Trợ lí của Lương - popup

const DEFAULTS = {
  enabled: true,
  autoDelayMs: 120,
  autoTypingMs: 0,
  panelMinimized: false,
  antiIdleEnabled: true,
  antiIdleIntervalMs: 45000,
};

const el = {
  enabled: document.getElementById("enabled"),
  status: document.getElementById("status"),
  fill: document.getElementById("btn-fill"),
  fillCheck: document.getElementById("btn-fill-check"),
  auto: document.getElementById("btn-auto"),
  delay: document.getElementById("delay"),
  delayVal: document.getElementById("delay-val"),
  typing: document.getElementById("typing"),
  typingVal: document.getElementById("typing-val"),
  antiIdle: document.getElementById("anti-idle"),
  antiIdleInterval: document.getElementById("anti-idle-interval"),
  antiIdleIntervalVal: document.getElementById("anti-idle-interval-val"),
  antiIdleStatus: document.getElementById("anti-idle-status"),
};

let activeTabId = null;
let isDailyDictation = false;
let pingState = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToTab(action) {
  return new Promise((resolve) => {
    if (!activeTabId || !isDailyDictation) {
      resolve(null);
      return;
    }
    try {
      chrome.tabs.sendMessage(activeTabId, { action }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(resp);
      });
    } catch (_e) {
      resolve(null);
    }
  });
}

function fmtDelay(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function fmtTyping(ms) {
  return `${ms}ms`;
}

function updateActionButtons() {
  const usable = isDailyDictation && el.enabled.checked;
  el.fill.disabled = !usable;
  el.fillCheck.disabled = !usable;
  el.auto.disabled = !usable;

  if (pingState && pingState.autoRunning) {
    el.auto.classList.add("running");
    el.auto.textContent = "■ Dừng auto";
  } else {
    el.auto.classList.remove("running");
    el.auto.textContent = "▶ Auto chạy hết bài";
  }
}

function updateStatusText() {
  if (!isDailyDictation) {
    el.status.textContent = "Mở https://dailydictation.com để dùng extension.";
    return;
  }
  if (!el.enabled.checked) {
    el.status.textContent = "Extension đang tắt. Bật công tắc ở trên để dùng.";
    return;
  }
  if (!pingState) {
    el.status.textContent = "Đang kết nối tới trang…";
    return;
  }
  if (pingState.current) {
    el.status.textContent = `Câu ${pingState.current.index + 1} / ${pingState.current.total} · ${pingState.answerCount} đáp án sẵn`;
  } else {
    el.status.textContent = `Mở một bài "Listen & Type" để bắt đầu (${pingState.answerCount || 0} đáp án).`;
  }
}

function updateAntiIdleStatus() {
  if (!el.antiIdleStatus) return;
  if (!isDailyDictation) {
    el.antiIdleStatus.textContent = "Anti-idle: mở dailydictation.com";
    return;
  }
  if (!pingState || !pingState.antiIdle) {
    el.antiIdleStatus.textContent = "Anti-idle: đang kết nối…";
    return;
  }
  const ai = pingState.antiIdle;
  if (!ai.loggedIn) {
    el.antiIdleStatus.textContent = "Anti-idle: cần đăng nhập";
    return;
  }
  if (!ai.enabled) {
    el.antiIdleStatus.textContent = `Anti-idle: TẮT${ai.timeSpent ? ` · hôm nay ${ai.timeSpent}` : ""}`;
    return;
  }
  if (pingState.autoRunning) {
    el.antiIdleStatus.textContent = `Anti-idle: chờ auto xong${ai.timeSpent ? ` · hôm nay ${ai.timeSpent}` : ""}`;
    return;
  }
  const last = ai.lastPingAt
    ? `${Math.max(0, Math.round((Date.now() - ai.lastPingAt) / 1000))}s trước`
    : "chưa";
  el.antiIdleStatus.textContent = `Anti-idle: BẬT · ping ${ai.pingCount} (${last})${ai.timeSpent ? ` · ${ai.timeSpent}` : ""}`;
}

async function refresh() {
  pingState = await sendToTab("ping");
  updateActionButtons();
  updateStatusText();
  updateAntiIdleStatus();
}

async function init() {
  const tab = await getActiveTab();
  activeTabId = tab && tab.id;
  isDailyDictation = !!(tab && tab.url && /^https:\/\/([a-z0-9.-]+\.)?dailydictation\.com\//.test(tab.url));

  const stored = await new Promise((r) => chrome.storage.sync.get(DEFAULTS, r));
  el.enabled.checked = !!stored.enabled;
  el.delay.value = stored.autoDelayMs;
  el.delayVal.textContent = fmtDelay(stored.autoDelayMs);
  el.typing.value = stored.autoTypingMs;
  el.typingVal.textContent = fmtTyping(stored.autoTypingMs);
  el.antiIdle.checked = !!stored.antiIdleEnabled;
  const aiSecs = Math.round(stored.antiIdleIntervalMs / 1000);
  el.antiIdleInterval.value = aiSecs;
  el.antiIdleIntervalVal.textContent = `${aiSecs}s`;

  updateStatusText();
  updateActionButtons();
  updateAntiIdleStatus();
  await refresh();
  // Periodic refresh so popup reflects auto progress
  setInterval(refresh, 1200);
}

el.enabled.addEventListener("change", async () => {
  await chrome.storage.sync.set({ enabled: el.enabled.checked });
  updateActionButtons();
  updateStatusText();
  if (el.enabled.checked) await sendToTab("show-panel");
  await refresh();
});

el.delay.addEventListener("input", () => {
  const v = parseInt(el.delay.value, 10);
  el.delayVal.textContent = fmtDelay(v);
  chrome.storage.sync.set({ autoDelayMs: v });
});

el.typing.addEventListener("input", () => {
  const v = parseInt(el.typing.value, 10);
  el.typingVal.textContent = fmtTyping(v);
  chrome.storage.sync.set({ autoTypingMs: v });
});

el.antiIdle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ antiIdleEnabled: el.antiIdle.checked });
  await refresh();
});

el.antiIdleInterval.addEventListener("input", () => {
  const secs = parseInt(el.antiIdleInterval.value, 10);
  el.antiIdleIntervalVal.textContent = `${secs}s`;
  chrome.storage.sync.set({ antiIdleIntervalMs: secs * 1000 });
});

el.fill.addEventListener("click", async () => {
  await sendToTab("fill");
  await refresh();
});

el.fillCheck.addEventListener("click", async () => {
  await sendToTab("fill-check");
  await refresh();
});

el.auto.addEventListener("click", async () => {
  await sendToTab(pingState && pingState.autoRunning ? "auto-stop" : "auto-start");
  // give it a moment then refresh
  setTimeout(refresh, 200);
});

init();
