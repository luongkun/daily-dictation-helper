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
    autoDelayMs: 120,
    autoTypingMs: 0,
    // NOTE: mặc định TẮT phím Esc. Esc là shortcut "show answer" của
    // trang (để xem đáp án), và một số bài trang không tính kết quả khi
    // đáp án được điền qua cách này. Điền thẳng + bấm Check an toàn hơn.
    useEscapeShortcut: false,
    pressCheckTwice: true,
    panelMinimized: false,
    // Trang dailydictation.com chỉ "tính" câu làm được khi audio đã được phát
    // (trang lắng nghe event play/ended trên <audio>). Nếu bỏ qua bước này
    // thì dù điền đúng, kết quả / progress vẫn không được cộng. Mặc định bật.
    playAudioFirst: true,
    audioPlaybackRate: 8,
  };

  const SELECTORS = {
    input: "#dictationInput",
    btnCheck: "#btn-check",
    btnSkip: "#btn-skip",
    btnNext: "#btn-next",
    transcriptItems: ".list-group-item",
    // Listen-and-select page (multiple-choice audio)
    selectOption: '[title^="You can press"][title*="to select"]',
    arrowRight: "button.bi-arrow-right, button.bi.bi-arrow-right",
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
    // Listen & Type uses a button with text like "3 / 30".
    const btn = getCounterButton();
    if (btn) {
      const m = (btn.innerText || "").match(/(\d+)\s*\/\s*(\d+)/);
      if (m) return { index: parseInt(m[1], 10) - 1, total: parseInt(m[2], 10) };
    }
    // Listen & Select uses a span like "1 of 10" inside a nav row.
    for (const s of $all("span")) {
      const t = (s.innerText || "").trim();
      const m = t.match(/^(\d+)\s+of\s+(\d+)$/i);
      if (m) return { index: parseInt(m[1], 10) - 1, total: parseInt(m[2], 10) };
    }
    return null;
  }

  // ---------- mode detection ----------

  function isSelectMode() {
    if (/\/listen-and-select(\/|$|\?)/.test(location.pathname + location.search)) return true;
    return !!$(SELECTORS.selectOption);
  }

  // ---------- audio: ensure the page marks the sentence as "listened" ----------

  // Trang dailydictation.com chỉ tính điểm / progress cho câu mà user đã bấm
  // Play ít nhất một lần. Nếu auto-fill mà không play thì kết quả không được
  // cộng. Để fix, ta tự phát audio của câu hiện tại với tốc độ cao rồi đợi
  // event "ended" (hoặc timeout) trước khi điền đáp án.

  const _playedKeyFor = (idx) => `${location.pathname}#${idx}`;
  const _playedSet = new Set();

  function getActiveAudio() {
    const audios = $all("audio");
    if (audios.length === 0) return null;
    // Ưu tiên audio có src và đang hiển thị trên trang.
    let best = null;
    for (const a of audios) {
      if (!a.src && !a.currentSrc) continue;
      if (!best) best = a;
      // Audio của câu hiện tại sẽ có duration > 0 và thường ở gần đầu DOM.
      if (a.duration && a.duration > 0) {
        best = a;
        break;
      }
    }
    return best || audios[0];
  }

  function clickPlayButton() {
    // Fallback khi không tìm thấy <audio> trực tiếp (ví dụ trang dùng custom
    // player). Thử các nút quen thuộc: .bi-play, #btn-play, nút có text "Play".
    const byClass = $all("button, a").find(
      (b) => /(^|\s)bi-play(-fill)?(\s|$)/.test(b.className) && !b.disabled,
    );
    if (byClass) {
      byClass.click();
      return true;
    }
    const byId = $("#btn-play");
    if (byId && !byId.disabled) {
      byId.click();
      return true;
    }
    const byText = $all("button").find(
      (b) => /^\s*play\s*$/i.test(b.innerText || "") && !b.disabled,
    );
    if (byText) {
      byText.click();
      return true;
    }
    return false;
  }

  const LOG_PREFIX = "[DDH]";
  const logEnabled = () => true; // bật log để user dễ debug
  const log = (...args) => {
    if (logEnabled()) console.log(LOG_PREFIX, ...args);
  };

  async function ensureAudioListened() {
    if (!STATE.playAudioFirst) return true;

    const cur = getCurrent();
    const idx = cur ? cur.index : -1;
    const key = _playedKeyFor(idx);
    if (idx >= 0 && _playedSet.has(key)) {
      log("audio: already played for index", idx, "- skip");
      return true;
    }

    const audio = getActiveAudio();
    if (!audio) {
      log("audio: <audio> not found, trying Play button");
      const clicked = clickPlayButton();
      if (!clicked) {
        log("audio: no Play button either - skip");
        return true;
      }
      await sleep(300);
      if (idx >= 0) _playedSet.add(key);
      return true;
    }

    log("audio: found", {
      src: audio.currentSrc || audio.src,
      duration: audio.duration,
      readyState: audio.readyState,
    });

    try {
      const prevMuted = audio.muted;
      const prevVolume = audio.volume;
      const prevRate = audio.playbackRate;

      const rate = Math.max(1, Math.min(16, STATE.audioPlaybackRate || 1));
      try {
        audio.muted = false;
        audio.volume = 0;
        audio.playbackRate = rate;
        audio.currentTime = 0;
      } catch (_e) {}

      let started = clickPlayButton();
      if (started) {
        log("audio: started via Play button");
      } else {
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === "function") {
          await playPromise.catch((err) => log("audio: play() rejected", err));
        }
        started = !audio.paused;
        log("audio: started via audio.play()", { paused: audio.paused });
      }

      const t0 = performance.now();
      const reason = await new Promise((resolve) => {
        let done = false;
        const finish = (r) => {
          if (done) return;
          done = true;
          audio.removeEventListener("ended", onEnded);
          clearTimeout(timer);
          resolve(r);
        };
        const onEnded = () => finish("ended");
        audio.addEventListener("ended", onEnded, { once: true });
        const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 10;
        const timeoutMs = Math.max(800, Math.min(15000, (dur / rate) * 1000 + 800));
        const timer = setTimeout(() => finish("timeout"), timeoutMs);
      });
      log("audio: finished", {
        reason,
        elapsedMs: Math.round(performance.now() - t0),
        currentTime: audio.currentTime,
        duration: audio.duration,
      });

      try {
        audio.muted = prevMuted;
        audio.volume = prevVolume;
        audio.playbackRate = prevRate;
      } catch (_e) {}
    } catch (e) {
      log("audio: error", e);
    }

    if (idx >= 0) _playedSet.add(key);
    return true;
  }

  // ---------- listen-and-select helpers ----------

  function getSelectOptions() {
    return $all(SELECTORS.selectOption);
  }

  function findButtonByText(re) {
    return $all("button").find((b) => re.test((b.innerText || "").trim()) && !b.disabled);
  }

  function getCheckButton() {
    return $(SELECTORS.btnCheck) || findButtonByText(/^check$/i);
  }

  function getNextButton() {
    const native = $(SELECTORS.btnNext);
    if (native && !native.disabled) return native;
    return findButtonByText(/^next$/i);
  }

  function optionHasClass(opt, cls) {
    return ((opt && opt.className) || "").split(/\s+/).includes(cls);
  }

  function getCorrectOption() {
    return getSelectOptions().find((o) => optionHasClass(o, "border-success"));
  }

  function questionAlreadySolved() {
    return !!(getCorrectOption() || getNextButton());
  }

  async function solveSelectQuestion() {
    const options = getSelectOptions();
    if (options.length === 0) {
      toast("Không tìm thấy đáp án (đang ở bài Listen & Select?)", "error");
      return false;
    }
    if (questionAlreadySolved()) return true;

    // Try options one by one until one is marked correct.
    for (let i = 0; i < options.length; i++) {
      if (STATE.autoStopRequested) return false;
      const opt = options[i];
      // Skip options already revealed as wrong.
      if (optionHasClass(opt, "border-danger") || optionHasClass(opt, "border-success")) continue;
      opt.click();
      await sleep(120);
      const check = getCheckButton();
      if (check && !check.disabled) {
        check.click();
        await sleep(220);
      } else {
        // After a wrong attempt the Check button is gone; clicking the
        // remaining option directly already reveals success.
        await sleep(180);
      }
      if (questionAlreadySolved()) return true;
    }
    return questionAlreadySolved();
  }

  function clickAdvanceSelect() {
    const n = getNextButton();
    if (n) {
      n.click();
      return true;
    }
    // Fallback: top arrow.
    const arrow = $all("button").find(
      (b) => /(^|\s)bi-arrow-right(\s|$)/.test(b.className) && !b.disabled,
    );
    if (arrow) {
      arrow.click();
      return true;
    }
    return false;
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

  // Trang dailydictation.com có phim tắt bổ sung: focus ô input rồi nhấn Esc
  // -> trang tự điền đáp án. Ta xài luôn cách này cho nhanh & chính xác hơn.
  function pressEscapeOn(el) {
    const opts = {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function fillByTranscript(input, answerText) {
    setNativeValue(input, answerText);
  }

  async function fillCurrent() {
    if (isSelectMode()) {
      await ensureAudioListened();
      return await solveSelectQuestion();
    }
    const input = $(SELECTORS.input);
    if (!input) {
      toast("Không tìm thấy ô nhập (đang ở tab Dictation chưa?)", "error");
      return false;
    }

    // Phát audio trước để trang đánh dấu câu đã được nghe (điều kiện để
    // trang cộng kết quả / progress). Bỏ qua nếu user tắt tuỳ chọn này.
    log("fillCurrent: begin, index=", (getCurrent() || {}).index);
    await ensureAudioListened();

    // Ưu tiên: focus input + nhấn Esc để trang tự điền.
    if (STATE.useEscapeShortcut) {
      input.focus();
      pressEscapeOn(input);
      // Đợi 1 frame ngắn rồi kiểm tra. Nếu trang đã điền, kết thúc.
      await sleep(40);
      if (input.value && input.value.trim().length > 0) {
        log("fillCurrent: filled via Esc shortcut");
        return true;
      }
    }

    // Fallback: điền thủ công từ Full transcript.
    const cur = getCurrent();
    if (!cur) {
      toast("Không xác định được số câu hiện tại", "error");
      return false;
    }
    const answers = readAnswers();
    if (answers.length === 0) {
      toast("Chưa load được Full transcript — click tab Full transcript một lần rồi thử lại", "error");
      return false;
    }
    const ans = answers[cur.index];
    if (ans == null) {
      toast(`Không có đáp án cho câu ${cur.index + 1}`, "error");
      return false;
    }
    log("fillCurrent: typing answer", { index: cur.index, answer: ans });
    if (STATE.autoTypingMs > 0) {
      await typeIntoInput(input, ans, STATE.autoTypingMs);
    } else {
      fillByTranscript(input, ans);
    }
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
    if (isSelectMode()) {
      await ensureAudioListened();
      // solveSelectQuestion already clicks Check as part of trying options.
      return await solveSelectQuestion();
    }
    const ok = await fillCurrent();
    if (!ok) return false;
    // Nếu dùng Esc thì trang đã tự check, không cần bấm thêm.
    if (!STATE.useEscapeShortcut) {
      await sleep(80);
      clickIfExists(SELECTORS.btnCheck);
    }
    return true;
  }

  async function autoRun() {
    if (STATE.autoRunning) return;
    STATE.autoRunning = true;
    STATE.autoStopRequested = false;
    updatePanel();
    toast("Auto bắt đầu", "ok");

    if (isSelectMode()) {
      await autoRunSelect();
    } else {
      await autoRunType();
    }

    STATE.autoRunning = false;
    updatePanel();
    toast(STATE.autoStopRequested ? "Auto đã dừng" : "Auto hoàn tất", "ok");
  }

  async function autoRunType() {
    let safety = 0;
    let lastIndex = -1;
    let stuckCount = 0;
    while (!STATE.autoStopRequested && safety < 500) {
      safety += 1;
      const cur = getCurrent();
      if (!cur) break;
      if (cur.index === lastIndex) {
        stuckCount += 1;
        if (stuckCount > 8) break;
      } else {
        stuckCount = 0;
      }
      lastIndex = cur.index;

      const ok = await fillCurrent();
      if (!ok) break;

      // Nếu không dùng Esc thì tự bấm Check.
      if (!STATE.useEscapeShortcut) {
        await sleep(60);
        clickIfExists(SELECTORS.btnCheck);
      }

      await sleep(STATE.autoDelayMs);

      const isLast = cur.index >= cur.total - 1;
      if (isLast) {
        clickIfExists(SELECTORS.btnNext) || clickIfExists(SELECTORS.btnCheck);
        break;
      }
      // Sau khi check sẽ xuất hiện nút Next; nếu chưa có thì Skip.
      if (!clickIfExists(SELECTORS.btnNext)) {
        clickIfExists(SELECTORS.btnSkip);
      }
      // Chờ một frame cho counter chuyển sang câu mới.
      await sleep(Math.max(50, Math.min(STATE.autoDelayMs, 200)));
    }
  }

  async function autoRunSelect() {
    let safety = 0;
    let lastIndex = -1;
    let stuckCount = 0;
    while (!STATE.autoStopRequested && safety < 500) {
      safety += 1;
      const cur = getCurrent();
      if (!cur) break;
      if (cur.index === lastIndex) {
        stuckCount += 1;
        if (stuckCount > 12) break;
      } else {
        stuckCount = 0;
      }
      lastIndex = cur.index;

      await ensureAudioListened();
      const ok = await solveSelectQuestion();
      if (!ok) break;

      await sleep(STATE.autoDelayMs);

      const isLast = cur.index >= cur.total - 1;
      const advanced = clickAdvanceSelect();
      if (isLast && !advanced) break;
      if (isLast) {
        // Last question already solved; give the page a moment for any
        // completion screen, then stop.
        await sleep(Math.max(120, STATE.autoDelayMs));
        break;
      }
      // Wait for the counter to advance.
      const targetIdx = cur.index + 1;
      const startedAt = Date.now();
      while (Date.now() - startedAt < 4000) {
        await sleep(80);
        const c = getCurrent();
        if (!c || c.index >= targetIdx) break;
      }
    }
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
          <input class="ddh-range" type="range" min="50" max="3000" step="50" data-role="delay" />
          <span class="ddh-val" data-role="delay-val">0.12s</span>
        </div>
        <div class="ddh-row ddh-controls">
          <label class="ddh-label">Gõ từng ký tự</label>
          <input class="ddh-range" type="range" min="0" max="180" step="5" data-role="typing" />
          <span class="ddh-val" data-role="typing-val">0ms</span>
        </div>
        <div class="ddh-row ddh-controls">
          <label class="ddh-checkbox"><input type="checkbox" data-role="use-esc" /> Dùng phím Esc (nhanh nhất)</label>
        </div>
        <div class="ddh-row ddh-controls">
          <label class="ddh-checkbox"><input type="checkbox" data-role="play-audio" /> Phát audio trước (để tính điểm)</label>
        </div>
        <div class="ddh-row ddh-controls">
          <label class="ddh-label">Tốc độ audio</label>
          <input class="ddh-range" type="range" min="1" max="16" step="1" data-role="audio-rate" />
          <span class="ddh-val" data-role="audio-rate-val">8x</span>
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

    const fmtDelay = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`);
    const delay = panelEl.querySelector('[data-role="delay"]');
    const delayVal = panelEl.querySelector('[data-role="delay-val"]');
    delay.value = STATE.autoDelayMs;
    delayVal.textContent = fmtDelay(STATE.autoDelayMs);
    delay.addEventListener("input", () => {
      STATE.autoDelayMs = parseInt(delay.value, 10);
      delayVal.textContent = fmtDelay(STATE.autoDelayMs);
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

    const useEsc = panelEl.querySelector('[data-role="use-esc"]');
    useEsc.checked = STATE.useEscapeShortcut;
    useEsc.addEventListener("change", () => {
      STATE.useEscapeShortcut = useEsc.checked;
      saveSettings();
    });

    const playAudio = panelEl.querySelector('[data-role="play-audio"]');
    playAudio.checked = STATE.playAudioFirst;
    playAudio.addEventListener("change", () => {
      STATE.playAudioFirst = playAudio.checked;
      saveSettings();
    });

    const audioRate = panelEl.querySelector('[data-role="audio-rate"]');
    const audioRateVal = panelEl.querySelector('[data-role="audio-rate-val"]');
    audioRate.value = STATE.audioPlaybackRate;
    audioRateVal.textContent = `${STATE.audioPlaybackRate}x`;
    audioRate.addEventListener("input", () => {
      STATE.audioPlaybackRate = parseInt(audioRate.value, 10);
      audioRateVal.textContent = `${STATE.audioPlaybackRate}x`;
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
        let newText;
        if (isSelectMode()) {
          const opts = getSelectOptions();
          newText = cur
            ? `Câu ${cur.index + 1} / ${cur.total} · ${opts.length} lựa chọn (Listen & Select)`
            : "Mở một bài Listen & Select để bắt đầu";
        } else {
          newText = cur
            ? `Câu ${cur.index + 1} / ${cur.total} · ${answers.length} đáp án sẵn`
            : "Mở một bài Listen & Type để bắt đầu";
        }
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
          autoDelayMs: 120,
          autoTypingMs: 0,
          useEscapeShortcut: false,
          panelMinimized: false,
          playAudioFirst: true,
          audioPlaybackRate: 8,
        },
        (vals) => {
          STATE.enabled = vals.enabled;
          STATE.autoDelayMs = vals.autoDelayMs;
          STATE.autoTypingMs = vals.autoTypingMs;
          STATE.useEscapeShortcut = vals.useEscapeShortcut;
          STATE.panelMinimized = vals.panelMinimized;
          STATE.playAudioFirst = vals.playAudioFirst;
          STATE.audioPlaybackRate = vals.audioPlaybackRate;
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
      useEscapeShortcut: STATE.useEscapeShortcut,
      panelMinimized: STATE.panelMinimized,
      playAudioFirst: STATE.playAudioFirst,
      audioPlaybackRate: STATE.audioPlaybackRate,
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
    if ("useEscapeShortcut" in changes) STATE.useEscapeShortcut = changes.useEscapeShortcut.newValue;
    if ("panelMinimized" in changes) STATE.panelMinimized = changes.panelMinimized.newValue;
    if ("playAudioFirst" in changes) STATE.playAudioFirst = changes.playAudioFirst.newValue;
    if ("audioPlaybackRate" in changes) STATE.audioPlaybackRate = changes.audioPlaybackRate.newValue;
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
        sendResponse({
          ok: true,
          current: getCurrent(),
          answerCount: isSelectMode() ? getSelectOptions().length : readAnswers().length,
          mode: isSelectMode() ? "select" : "type",
          autoRunning: STATE.autoRunning,
          enabled: STATE.enabled,
        });
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
