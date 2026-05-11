// Daily Dictation Helper - Content script
// Tự động điền đáp án trên dailydictation.com dựa trên Full transcript của chính trang.

(() => {
  "use strict";

  if (window.__ddHelperInjected) return;
  window.__ddHelperInjected = true;

  const STATE = {
    enabled: true,
    autoRunning: false,
    autoStopRequested: false,
    autoDelayMs: 1500,
    autoTypingMs: 60,
    pressCheckTwice: true,
    panelMinimized: false,
  };

  const SELECTORS = {
    input: "#dictationInput",
    btnCheck: "#btn-check",
    btnSkip: "#btn-skip",
    btnNext: "#btn-next",
    transcriptItems: ".list-group-item",
  };

  // ---------- helpers ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $all(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  let _cachedAnswers = [];
  let _answerCacheDirty = true;

  function readAnswers() {
    if (!_answerCacheDirty && _cachedAnswers.length > 0) return _cachedAnswers;
    _cachedAnswers = $all(SELECTORS.transcriptItems)
      .map((el) => (el.innerText || el.textContent || "").trim())
      .filter((t) => t.length > 0);
    if (_cachedAnswers.length > 0) _answerCacheDirty = false;
    return _cachedAnswers;
  }

  function invalidateAnswerCache() {
    _answerCacheDirty = true;
  }

  function getCounterButton() {
    const buttons = $all("button");
    return buttons.find((b) => /^\s*\d+\s*\/\s*\d+\s*$/.test(b.innerText || ""));
  }

  function getCurrent() {
    const btn = getCounterButton();
    if (!btn) return null;
    const m = (btn.innerText || "").match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) return null;
    return { index: parseInt(m[1], 10) - 1, total: parseInt(m[2], 10) };
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function typeIntoInput(el, text, perCharMs = 0) {
    el.focus();
    if (perCharMs <= 0) {
      setNativeValue(el, text);
      return;
    }
    setNativeValue(el, "");
    let current = "";
    for (const ch of text) {
      current += ch;
      setNativeValue(el, current);
      await sleep(perCharMs);
    }
  }

  // ---------- core actions ----------

  async function fillCurrent() {
    const input = $(SELECTORS.input);
    if (!input) {
      toast("Không tìm thấy ô nhập (đang ở tab Dictation chưa?)", "error");
      return false;
    }
    const cur = getCurrent();
    if (!cur) {
      toast("Không xác định được số câu hiện tại", "error");
      return false;
    }
    const answers = readAnswers();
    if (answers.length === 0) {
      toast("Chưa load được Full transcript — thử click tab Full transcript một lần rồi quay lại", "error");
      return false;
    }
    const ans = answers[cur.index];
    if (ans == null) {
      toast(`Không có đáp án cho câu ${cur.index + 1}`, "error");
      return false;
    }
    await typeIntoInput(input, ans, STATE.autoTypingMs);
    return true;
  }

  function clickIfExists(sel) {
    const el = $(sel);
    if (el && !el.disabled) {
      el.click();
      return true;
    }
    return false;
  }

  async function fillAndCheck() {
    const ok = await fillCurrent();
    if (!ok) return false;
    await sleep(100);
    clickIfExists(SELECTORS.btnCheck);
    return true;
  }

  async function autoRun() {
    if (STATE.autoRunning) return;
    STATE.autoRunning = true;
    STATE.autoStopRequested = false;
    updatePanel();
    toast("Auto bắt đầu", "ok");

    let safety = 0;
    let lastIndex = -1;
    let stuckCount = 0;
    while (!STATE.autoStopRequested && safety < 500) {
      safety += 1;
      const cur = getCurrent();
      if (!cur) break;
      if (cur.index === lastIndex) {
        stuckCount += 1;
        if (stuckCount > 5) break;
      } else {
        stuckCount = 0;
      }
      lastIndex = cur.index;

      const ok = await fillCurrent();
      if (!ok) break;
      await sleep(120);
      clickIfExists(SELECTORS.btnCheck);
      await sleep(STATE.autoDelayMs);

      const isLast = cur.index >= cur.total - 1;
      if (isLast) {
        // Vẫn bấm Next/Check để hiện đáp án câu cuối.
        clickIfExists(SELECTORS.btnNext) || clickIfExists(SELECTORS.btnCheck);
        break;
      }
      // Sau khi check sẽ xuất hiện nút Next; nếu chưa có thì Skip.
      if (!clickIfExists(SELECTORS.btnNext)) {
        clickIfExists(SELECTORS.btnSkip);
      }
      await sleep(450);
    }

    STATE.autoRunning = false;
    updatePanel();
    toast(STATE.autoStopRequested ? "Auto đã dừng" : "Auto hoàn tất", "ok");
  }

  function stopAuto() {
    STATE.autoStopRequested = true;
  }

  // ---------- UI: floating panel ----------

  let panelEl = null;
  let toastEl = null;

  function ensurePanel() {
    if (panelEl && document.body.contains(panelEl)) return;
    panelEl = document.createElement("div");
    panelEl.id = "ddh-panel";
    panelEl.innerHTML = `
      <div class="ddh-header" data-role="drag">
        <span class="ddh-title">DD Helper</span>
        <button class="ddh-icon" data-role="toggle-min" title="Thu gọn">_</button>
        <button class="ddh-icon" data-role="close" title="Ẩn (bật lại từ popup)">×</button>
      </div>
      <div class="ddh-body">
        <div class="ddh-status" data-role="status">—</div>
        <div class="ddh-row">
          <button class="ddh-btn ddh-btn-primary" data-role="fill">Điền câu này</button>
          <button class="ddh-btn ddh-btn-success" data-role="fill-check">Điền + Check</button>
        </div>
        <div class="ddh-row">
          <button class="ddh-btn ddh-btn-auto" data-role="auto">▶ Auto chạy hết bài</button>
        </div>
        <div class="ddh-row ddh-controls">
          <label class="ddh-label">Delay giữa câu</label>
          <input class="ddh-range" type="range" min="500" max="6000" step="100" data-role="delay" />
          <span class="ddh-val" data-role="delay-val">1.5s</span>
        </div>
        <div class="ddh-row ddh-controls">
          <label class="ddh-label">Gõ từng ký tự</label>
          <input class="ddh-range" type="range" min="0" max="180" step="5" data-role="typing" />
          <span class="ddh-val" data-role="typing-val">60ms</span>
        </div>
        <div class="ddh-hint">Phím tắt: <b>Ctrl+Shift+Enter</b> = Điền · <b>Ctrl+Shift+A</b> = Auto · <b>Ctrl+Shift+H</b> = Ẩn panel</div>
      </div>
    `;
    document.body.appendChild(panelEl);

    panelEl.addEventListener("click", async (ev) => {
      const target = ev.target.closest("[data-role]");
      if (!target) return;
      const role = target.dataset.role;
      if (role === "fill") await fillCurrent();
      else if (role === "fill-check") await fillAndCheck();
      else if (role === "auto") {
        if (STATE.autoRunning) stopAuto();
        else autoRun();
      } else if (role === "toggle-min") {
        STATE.panelMinimized = !STATE.panelMinimized;
        panelEl.classList.toggle("ddh-min", STATE.panelMinimized);
        saveSettings();
      } else if (role === "close") {
        STATE.enabled = false;
        panelEl.remove();
        panelEl = null;
        saveSettings();
      }
    });

    const delay = panelEl.querySelector('[data-role="delay"]');
    const delayVal = panelEl.querySelector('[data-role="delay-val"]');
    delay.value = STATE.autoDelayMs;
    delayVal.textContent = `${(STATE.autoDelayMs / 1000).toFixed(1)}s`;
    delay.addEventListener("input", () => {
      STATE.autoDelayMs = parseInt(delay.value, 10);
      delayVal.textContent = `${(STATE.autoDelayMs / 1000).toFixed(1)}s`;
      saveSettings();
    });

    const typing = panelEl.querySelector('[data-role="typing"]');
    const typingVal = panelEl.querySelector('[data-role="typing-val"]');
    typing.value = STATE.autoTypingMs;
    typingVal.textContent = `${STATE.autoTypingMs}ms`;
    typing.addEventListener("input", () => {
      STATE.autoTypingMs = parseInt(typing.value, 10);
      typingVal.textContent = `${STATE.autoTypingMs}ms`;
      saveSettings();
    });

    // Drag the panel
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    const header = panelEl.querySelector('[data-role="drag"]');
    header.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      const rect = panelEl.getBoundingClientRect();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panelEl.style.transition = "none";
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panelEl.style.right = "auto";
      panelEl.style.bottom = "auto";
      panelEl.style.left = `${Math.max(0, Math.min(window.innerWidth - panelEl.offsetWidth, startLeft + (e.clientX - startX)))}px`;
      panelEl.style.top = `${Math.max(0, Math.min(window.innerHeight - panelEl.offsetHeight, startTop + (e.clientY - startY)))}px`;
    });
    window.addEventListener("mouseup", () => {
      dragging = false;
    });

    if (STATE.panelMinimized) panelEl.classList.add("ddh-min");
    updatePanel();
  }

  function removePanel() {
    if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }
  }

  let _updatingPanel = false;

  function updatePanel() {
    if (!panelEl || _updatingPanel) return;
    _updatingPanel = true;
    try {
      const cur = getCurrent();
      const answers = readAnswers();
      const status = panelEl.querySelector('[data-role="status"]');
      const autoBtn = panelEl.querySelector('[data-role="auto"]');
      if (status) {
        const newText = cur
          ? `Câu ${cur.index + 1} / ${cur.total} · ${answers.length} đáp án sẵn`
          : "Mở một bài Listen & Type để bắt đầu";
        if (status.textContent !== newText) status.textContent = newText;
      }
      if (autoBtn) {
        const newLabel = STATE.autoRunning ? "■ Dừng auto" : "▶ Auto chạy hết bài";
        if (autoBtn.textContent !== newLabel) autoBtn.textContent = newLabel;
        autoBtn.classList.toggle("ddh-running", STATE.autoRunning);
      }
    } finally {
      _updatingPanel = false;
    }
  }

  function toast(message, type = "ok") {
    if (toastEl) toastEl.remove();
    toastEl = document.createElement("div");
    toastEl.className = `ddh-toast ddh-toast-${type}`;
    toastEl.textContent = message;
    document.body.appendChild(toastEl);
    setTimeout(() => {
      if (toastEl) {
        toastEl.classList.add("ddh-toast-out");
        setTimeout(() => toastEl && toastEl.remove(), 350);
      }
    }, 1800);
  }

  // ---------- keyboard shortcuts ----------

  window.addEventListener(
    "keydown",
    (e) => {
      if (!STATE.enabled) return;
      const isPageContext = location.hostname.endsWith("dailydictation.com");
      if (!isPageContext) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.shiftKey && (e.key === "Enter" || e.code === "Enter")) {
        e.preventDefault();
        e.stopPropagation();
        fillCurrent();
      } else if (ctrl && e.shiftKey && (e.key === "A" || e.key === "a")) {
        e.preventDefault();
        e.stopPropagation();
        if (STATE.autoRunning) stopAuto();
        else autoRun();
      } else if (ctrl && e.shiftKey && (e.key === "H" || e.key === "h")) {
        e.preventDefault();
        e.stopPropagation();
        STATE.panelMinimized = !STATE.panelMinimized;
        panelEl && panelEl.classList.toggle("ddh-min", STATE.panelMinimized);
        saveSettings();
      }
    },
    true,
  );

  // ---------- storage ----------

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        {
          enabled: true,
          autoDelayMs: 1500,
          autoTypingMs: 60,
          panelMinimized: false,
        },
        (vals) => {
          STATE.enabled = vals.enabled;
          STATE.autoDelayMs = vals.autoDelayMs;
          STATE.autoTypingMs = vals.autoTypingMs;
          STATE.panelMinimized = vals.panelMinimized;
          resolve();
        },
      );
    });
  }

  function saveSettings() {
    chrome.storage.sync.set({
      enabled: STATE.enabled,
      autoDelayMs: STATE.autoDelayMs,
      autoTypingMs: STATE.autoTypingMs,
      panelMinimized: STATE.panelMinimized,
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    let needsRefresh = false;
    if ("enabled" in changes) {
      STATE.enabled = changes.enabled.newValue;
      needsRefresh = true;
    }
    if ("autoDelayMs" in changes) STATE.autoDelayMs = changes.autoDelayMs.newValue;
    if ("autoTypingMs" in changes) STATE.autoTypingMs = changes.autoTypingMs.newValue;
    if ("panelMinimized" in changes) STATE.panelMinimized = changes.panelMinimized.newValue;
    if (needsRefresh) {
      if (STATE.enabled) {
        ensurePanel();
      } else {
        stopAuto();
        removePanel();
      }
    } else if (panelEl) {
      updatePanel();
    }
  });

  // ---------- message bridge from popup ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return;
    switch (msg.action) {
      case "ping":
        sendResponse({ ok: true, current: getCurrent(), answerCount: readAnswers().length, autoRunning: STATE.autoRunning, enabled: STATE.enabled });
        break;
      case "fill":
        fillCurrent().then((ok) => sendResponse({ ok }));
        return true; // async
      case "fill-check":
        fillAndCheck().then((ok) => sendResponse({ ok }));
        return true;
      case "auto-start":
        autoRun();
        sendResponse({ ok: true });
        break;
      case "auto-stop":
        stopAuto();
        sendResponse({ ok: true });
        break;
      case "show-panel":
        STATE.enabled = true;
        saveSettings();
        ensurePanel();
        sendResponse({ ok: true });
        break;
    }
  });

  // ---------- DOM observer to update status (debounced) ----------

  function startObserver() {
    let debounceTimer = null;
    const debouncedUpdate = () => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (panelEl) updatePanel();
      }, 500);
    };
    const obs = new MutationObserver((mutations) => {
      // Skip mutations from our own panel to avoid feedback loops.
      const isOwnMutation = mutations.every(
        (m) => panelEl && (panelEl.contains(m.target) || m.target === panelEl),
      );
      if (isOwnMutation) return;
      debouncedUpdate();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- init ----------

  (async () => {
    await loadSettings();
    if (STATE.enabled) ensurePanel();
    startObserver();

    // Invalidate answer cache when user switches transcript tabs.
    document.addEventListener("click", (e) => {
      const link = e.target.closest('a[href="#"], [role="tab"]');
      if (link) invalidateAnswerCache();
    });
  })();
})();
