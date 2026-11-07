/* ==========================================================================
   Latefolar 体験版: 画面の動き
   - 時刻は、出勤・休憩の始まり・休憩の終わりの時刻(Date.now)を覚えて、そこから毎回計算する
     (1秒ずつ足していかない。ページを閉じていた間も数え続けるため)
   - 記録はこのブラウザの localStorage だけに置く。使えないときはメモリだけで動く
   - 外部へは何も送らない(感想は、本人が Google フォームで「送信」を押したときだけ届く)
   ========================================================================== */
(function () {
  "use strict";

  var core = window.LatefolarTrialCore;
  var STORAGE_KEY = "latefolar-trial-v1";
  var PHASES = ["setup", "idle", "working", "break", "done"];

  // ---------- 記録の読み書き ----------

  var storageOk = true;

  function emptyState() {
    return { v: 1, wage: null, phase: "setup", session: null, lastSeen: null, awayMs: 0, history: {}, result: null };
  }

  function isNum(x) {
    return typeof x === "number" && isFinite(x);
  }

  function validSession(s) {
    if (!s || !isNum(s.start) || !Array.isArray(s.breaks)) {
      return false;
    }
    if (s.breakStart != null && !isNum(s.breakStart)) {
      return false;
    }
    return s.breaks.every(function (b) { return b && isNum(b.start) && isNum(b.end); });
  }

  function loadState() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      storageOk = false;
      return emptyState();
    }
    if (!raw) {
      return emptyState();
    }
    try {
      var s = JSON.parse(raw);
      var state = emptyState();
      if (s && s.v === 1) {
        state.wage = core.isValidWage(s.wage) ? s.wage : null;
        state.history = s.history && typeof s.history === "object" ? s.history : {};
        state.lastSeen = isNum(s.lastSeen) ? s.lastSeen : null;
        state.awayMs = isNum(s.awayMs) ? s.awayMs : 0;
        state.session = validSession(s.session) ? s.session : null;
        state.result = s.result && isNum(s.result.amount) ? s.result : null;
        state.phase = PHASES.indexOf(s.phase) !== -1 ? s.phase : "setup";
      }
      return normalize(state);
    } catch (e) {
      return emptyState();
    }
  }

  // 食い違った記録(勤務中なのに勤務が無い、など)を、使える形に戻す
  function normalize(state) {
    if (state.wage == null) {
      state.phase = "setup";
      state.session = null;
    } else if ((state.phase === "working" || state.phase === "break") && !state.session) {
      state.phase = "idle";
    } else if (state.phase === "working" && state.session.breakStart != null) {
      state.phase = "break";
    } else if (state.phase === "break" && state.session.breakStart == null) {
      state.phase = "working";
    } else if (state.phase === "done" && !state.result) {
      state.phase = "idle";
    } else if (state.phase === "setup") {
      state.phase = "idle";
    }
    return state;
  }

  function saveState() {
    if (!storageOk) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      storageOk = false; // 以後はメモリだけで動く
    }
  }

  // ---------- 画面 ----------

  var $ = function (id) { return document.getElementById(id); };
  var screens = {
    setup: $("screen-setup"),
    idle: $("screen-idle"),
    working: $("screen-working"),
    break: $("screen-break"),
    done: $("screen-done")
  };
  var devBand = $("dev-band");
  var wageInput = $("wage-input");
  var wageError = $("wage-error");
  var wageField = $("wage-field");
  var startButton = $("start-button");
  var comment = $("comment");
  var sendLink = $("send-feedback");
  var sendNote = $("send-note");

  var state = loadState();
  var answers = { willUse: null, source: null, comment: "" };
  var lastRenderedSecond = null;

  function show(phase) {
    Object.keys(screens).forEach(function (k) {
      screens[k].hidden = k !== phase;
    });
    devBand.hidden = phase === "done";
    lastRenderedSecond = null;
    render();
  }

  function setText(id, text) {
    var el = $(id);
    if (el.textContent !== text) {
      el.textContent = text;
    }
  }

  // 数字を1文字ずつ同じ幅の枠に入れて書く。tabular-nums に対応していないフォント
  // (例: Windows の Segoe UI Black は「1」だけ幅が狭い)でも、毎秒数字が変わったときに位置が揺れないようにする
  function setDigits(id, text) {
    var el = $(id);
    if (el.getAttribute("data-text") === text) {
      return;
    }
    el.setAttribute("data-text", text);
    el.textContent = "";
    Array.prototype.forEach.call(text, function (ch) {
      if (ch >= "0" && ch <= "9") {
        var span = document.createElement("span");
        span.className = "digit";
        span.textContent = ch;
        el.appendChild(span);
      } else {
        el.appendChild(document.createTextNode(ch));
      }
    });
  }

  // 桁が増えても1行に収まるように、文字の数(小数は半分の大きさなので半分に数える)を CSS に渡す
  function fitAmount(id, length) {
    var el = $(id);
    var value = String(Math.max(6, length));
    if (el.style.getPropertyValue("--amount-length") !== value) {
      el.style.setProperty("--amount-length", value);
    }
  }

  function render() {
    var now = Date.now();
    var phase = state.phase;
    if (phase === "idle") {
      setText("idle-wage", core.formatYen(state.wage));
    } else if (phase === "working") {
      var worked = core.workedSeconds(state.session, now);
      // 勤務中の金額は小数2けたまで(円の部分と小数の部分に分けて出す)
      var parts = core.formatYenParts(core.earningsCents(worked, state.wage));
      setDigits("work-yen", parts.yen);
      setDigits("work-frac", parts.frac);
      fitAmount("work-amount", parts.yen.length + parts.frac.length * 0.5);
      setText("work-time", core.formatHMS(worked));
      $("away-banner").hidden = !state.awayMs;
      if (state.awayMs) {
        setText("away-text", "閉じていた間(" + core.formatDuration(state.awayMs / 1000) + ")も、数え続けていました");
      }
    } else if (phase === "break") {
      var workedB = core.workedSeconds(state.session, now);
      var today = core.todayTotals(state.history, now).seconds + workedB;
      var ratio = core.progressRatio(today);
      setText("break-time", core.formatHMS(core.currentBreakSeconds(state.session, now)));
      setText("today-work", core.formatHoursMinutes(today));
      $("today-progress-bar").style.width = (ratio * 100).toFixed(2) + "%";
      $("today-progress").setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
      setText("break-amount", core.formatYen(core.earnings(workedB, state.wage)));
    } else if (phase === "done") {
      setText("done-amount", core.formatYen(state.result.amount));
      setText("done-today", core.formatYen(state.result.todayAmount));
    }
  }

  // 表示の更新。時刻から毎回計算し、変わったところだけ書き換える(秒の変わり目に遅れないよう、短い間隔で見る)
  // 最後に開いていた時刻の保存は、1秒に1回まで
  function tick() {
    var now = Date.now();
    render();
    var second = Math.floor(now / 1000);
    if (second !== lastRenderedSecond && (state.phase === "working" || state.phase === "break")) {
      state.lastSeen = now;
      saveState();
    }
    lastRenderedSecond = second;
  }

  function rememberLastSeen() {
    if (state.phase === "working" || state.phase === "break") {
      state.lastSeen = Date.now();
      saveState();
    }
  }

  function go(phase) {
    state.phase = phase;
    saveState();
    show(phase);
    window.scrollTo(0, 0);
  }

  // ---------- T1 時給 ----------

  function checkWage() {
    var parsed = core.parseWageInput(wageInput.value);
    var formatted = parsed.digits ? core.formatNumber(parsed.value) : "";
    if (wageInput.value !== formatted) {
      wageInput.value = formatted;
    }
    var invalid = !parsed.valid;
    wageError.hidden = !invalid;
    wageError.textContent = invalid
      ? core.formatNumber(core.WAGE_MIN) + "〜" + core.formatNumber(core.WAGE_MAX) + "円で入れてください"
      : "";
    wageField.classList.toggle("is-invalid", invalid);
    wageInput.setAttribute("aria-invalid", invalid ? "true" : "false");
    startButton.disabled = invalid;
    return parsed;
  }

  function openSetup() {
    wageInput.value = core.formatNumber(state.wage != null ? state.wage : core.WAGE_DEFAULT);
    checkWage();
    go("setup");
  }

  wageInput.addEventListener("input", checkWage);
  wageInput.addEventListener("focus", function () {
    window.setTimeout(function () { wageInput.select(); }, 0);
  });

  $("wage-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var parsed = checkWage();
    if (!parsed.valid) {
      wageInput.focus();
      return;
    }
    state.wage = parsed.value;
    wageInput.blur();
    go("idle");
  });

  // ---------- T2 出勤前 ----------

  $("change-wage").addEventListener("click", openSetup);

  $("clock-in").addEventListener("click", function () {
    var now = Date.now();
    state.session = { start: now, breaks: [], breakStart: null };
    state.lastSeen = now;
    state.awayMs = 0;
    go("working");
  });

  // ---------- T3 勤務中・T4 休憩中 ----------

  $("break-start").addEventListener("click", function () {
    var now = Date.now();
    state.session.breakStart = now;
    state.lastSeen = now;
    state.awayMs = 0;
    go("break");
  });

  $("break-end").addEventListener("click", function () {
    var now = Date.now();
    state.session.breaks.push({ start: state.session.breakStart, end: now });
    state.session.breakStart = null;
    state.lastSeen = now;
    go("working");
  });

  $("clock-out").addEventListener("click", function () {
    var now = Date.now();
    var seconds = core.workedSeconds(state.session, now);
    var amount = core.earnings(seconds, state.wage);
    state.history = core.addToHistory(state.history, now, seconds, amount);
    state.result = { amount: amount, todayAmount: core.todayTotals(state.history, now).amount };
    state.session = null;
    state.lastSeen = null;
    state.awayMs = 0;
    resetFeedback();
    go("done");
  });

  // ---------- T5 感想 ----------

  function updateSendLink() {
    sendLink.href = core.buildFeedbackUrl(answers);
  }

  function resetFeedback() {
    answers = { willUse: null, source: null, comment: "" };
    Array.prototype.forEach.call(document.querySelectorAll(".choice"), function (b) {
      b.setAttribute("aria-pressed", "false");
    });
    comment.value = "";
    updateCount();
    sendNote.hidden = true;
    updateSendLink();
  }

  function updateCount() {
    setText("comment-count", core.countChars(comment.value) + " / " + core.FEEDBACK_MAX_CHARS);
  }

  Array.prototype.forEach.call(document.querySelectorAll(".choices"), function (group) {
    var key = group.getAttribute("data-question");
    group.addEventListener("click", function (e) {
      var button = e.target.closest(".choice");
      if (!button) {
        return;
      }
      var value = button.getAttribute("data-value");
      var selected = answers[key] === value ? null : value; // もう一度押すと外れる
      answers[key] = selected;
      Array.prototype.forEach.call(group.querySelectorAll(".choice"), function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-value") === selected ? "true" : "false");
      });
      updateSendLink();
    });
  });

  comment.addEventListener("input", function () {
    if (core.countChars(comment.value) > core.FEEDBACK_MAX_CHARS) {
      comment.value = core.truncateChars(comment.value, core.FEEDBACK_MAX_CHARS);
    }
    answers.comment = comment.value;
    updateCount();
    updateSendLink();
  });

  sendLink.addEventListener("click", function () {
    updateSendLink();
    sendNote.hidden = false;
  });

  $("close-done").addEventListener("click", function () {
    state.result = null;
    go("idle");
  });

  // ---------- はじめ ----------

  var openedAt = Date.now();
  if (state.phase === "working") {
    // 勤務中に閉じていて、開き直すまで1分以上あいていたら「閉じていた間も…」を出す
    var away = core.awayMs(state.lastSeen, openedAt);
    if (away) {
      state.awayMs = away;
    }
  }
  if (state.phase === "working" || state.phase === "break") {
    state.lastSeen = openedAt;
  }
  if (state.phase === "setup") {
    wageInput.value = core.formatNumber(state.wage != null ? state.wage : core.WAGE_DEFAULT);
    checkWage();
  }
  if (state.phase === "done") {
    resetFeedback();
  }
  updateCount();
  updateSendLink();
  saveState();
  show(state.phase);

  window.setInterval(tick, 250);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      rememberLastSeen();
    } else {
      lastRenderedSecond = null;
      tick();
    }
  });
  window.addEventListener("pagehide", rememberLastSeen);
})();
