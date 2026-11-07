/* ==========================================================================
   Latefolar 体験版: 計算だけの関数(画面や localStorage には触れない)
   ブラウザでは window.LatefolarTrialCore、Node.js のテストでは require() で使う
   ========================================================================== */
(function (root, factory) {
  var core = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = core;
  } else {
    root.LatefolarTrialCore = core;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WAGE_MIN = 1;
  var WAGE_MAX = 100000;
  var WAGE_DEFAULT = 1200;
  var FEEDBACK_MAX_CHARS = 500;
  var TARGET_SECONDS = 8 * 60 * 60;
  // 勤務中に閉じていて、これ以上あいてから開いたときに「閉じていた間も…」を出す
  var AWAY_NOTICE_MS = 60 * 1000;
  // 今日の合計のために残しておく日数(古い日は消す)
  var HISTORY_DAYS = 14;

  var FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSe1WhIQ8bwoXYk1cfd6kfiGu3KmiDD5fc02vM8VqPJs5g6rgg/viewform";
  // 選択肢の文字は、Google フォームと一字一句同じにする
  var FEEDBACK_QUESTIONS = {
    willUse: { entry: "entry.991601904", options: ["使いたい", "たぶん", "今はいい"] },
    source: { entry: "entry.2036366728", options: ["YouTube", "TikTok", "X", "その他"] },
    comment: { entry: "entry.685114059" }
  };

  // 文字の数。絵文字なども1文字として数える(コードポイント単位)
  function countChars(text) {
    return Array.from(String(text)).length;
  }

  function truncateChars(text, max) {
    var chars = Array.from(String(text));
    return chars.length > max ? chars.slice(0, max).join("") : String(text);
  }

  // 時給の入力を読む。全角の数字は半角に直し、数字以外は捨てる
  function parseWageInput(raw) {
    var half = String(raw).replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    });
    var digits = half.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "").slice(0, 7);
    if (digits === "") {
      return { digits: "", value: null, valid: false };
    }
    var value = Number(digits);
    return { digits: digits, value: value, valid: isValidWage(value) };
  }

  function isValidWage(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= WAGE_MIN && value <= WAGE_MAX;
  }

  function formatNumber(n) {
    var s = typeof n === "bigint" ? String(n) : String(Math.trunc(n));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatYen(n) {
    return "¥" + formatNumber(n);
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  // H:MM:SS(例: 2:03:15)
  function formatHMS(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return h + ":" + pad2(m) + ":" + pad2(s % 60);
  }

  // ○時間○○分(例: 2時間03分)。今日の勤務に使う
  function formatHoursMinutes(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds));
    return Math.floor(s / 3600) + "時間" + pad2(Math.floor((s % 3600) / 60)) + "分";
  }

  // ○時間○分 / ○分(例: 1時間12分、5分)。閉じていた間に使う
  function formatDuration(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return h > 0 ? h + "時間" + m + "分" : m + "分";
  }

  // 勤務: { start: ミリ秒, breaks: [{ start, end }], breakStart: ミリ秒 | null }
  // 働いた時間(秒)= 出勤からの時間 − 休憩の時間。毎回、覚えた時刻から計算する
  function workedSeconds(session, now) {
    if (!session) {
      return 0;
    }
    var ms = now - session.start;
    var breaks = session.breaks || [];
    for (var i = 0; i < breaks.length; i++) {
      ms -= Math.max(0, breaks[i].end - breaks[i].start);
    }
    if (session.breakStart != null) {
      ms -= Math.max(0, now - session.breakStart);
    }
    return Math.max(0, Math.floor(ms / 1000));
  }

  function currentBreakSeconds(session, now) {
    if (!session || session.breakStart == null) {
      return 0;
    }
    return Math.max(0, Math.floor((now - session.breakStart) / 1000));
  }

  // 金額(0.01円単位の整数)= 働いた秒数 × 時給 × 100 ÷ 3600 を切り捨てたもの(= 秒数 × 時給 ÷ 36)
  // 浮動小数点は使わず、BigInt の整数の割り算で出す(桁あふれもしない)
  function earningsCents(seconds, wage) {
    var s = BigInt(Math.max(0, Math.floor(seconds)));
    return (s * BigInt(wage)) / BigInt(36);
  }

  // 金額(円)= 0.01円単位の整数を 100 で割って切り捨てたもの
  // (= 働いた秒数 × 時給 ÷ 3600 を切り捨てた円。切り捨てを2回しても1回と同じ)
  function earnings(seconds, wage) {
    return Number(earningsCents(seconds, wage) / BigInt(100));
  }

  // 0.01円単位の整数を、表示の「¥5」と「.83」に分ける
  function formatYenParts(cents) {
    var c = typeof cents === "bigint" ? cents : BigInt(cents);
    var frac = Number(c % BigInt(100));
    return { yen: "¥" + formatNumber(c / BigInt(100)), frac: "." + pad2(frac) };
  }

  // 端末の日付(YYYY-MM-DD)
  function localDateKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // 今日の合計は、退勤した日の端末の日付で数える
  function todayTotals(history, now) {
    var day = history && history[localDateKey(now)];
    return { seconds: day ? day.seconds : 0, amount: day ? day.amount : 0 };
  }

  function addToHistory(history, endMs, seconds, amount) {
    var next = {};
    var key = localDateKey(endMs);
    var oldest = localDateKey(endMs - HISTORY_DAYS * 24 * 60 * 60 * 1000);
    Object.keys(history || {}).forEach(function (k) {
      if (k > oldest && k <= key) {
        next[k] = { seconds: history[k].seconds, amount: history[k].amount };
      }
    });
    var prev = next[key] || { seconds: 0, amount: 0 };
    next[key] = { seconds: prev.seconds + seconds, amount: prev.amount + amount };
    return next;
  }

  function progressRatio(seconds) {
    return Math.min(1, Math.max(0, seconds / TARGET_SECONDS));
  }

  // 閉じていた間(ミリ秒)。知らせる長さに満たなければ 0
  function awayMs(lastSeen, now) {
    if (typeof lastSeen !== "number") {
      return 0;
    }
    var gap = now - lastSeen;
    return gap >= AWAY_NOTICE_MS ? gap : 0;
  }

  // 事前入力のリンク。選んだもの・書いたものだけを入れる(時給・金額・時間は入れない)
  function buildFeedbackUrl(answers) {
    var params = ["usp=pp_url"];
    var a = answers || {};
    if (FEEDBACK_QUESTIONS.willUse.options.indexOf(a.willUse) !== -1) {
      params.push(FEEDBACK_QUESTIONS.willUse.entry + "=" + encodeURIComponent(a.willUse));
    }
    if (FEEDBACK_QUESTIONS.source.options.indexOf(a.source) !== -1) {
      params.push(FEEDBACK_QUESTIONS.source.entry + "=" + encodeURIComponent(a.source));
    }
    if (typeof a.comment === "string" && a.comment.trim() !== "") {
      var text = truncateChars(a.comment.trim(), FEEDBACK_MAX_CHARS);
      params.push(FEEDBACK_QUESTIONS.comment.entry + "=" + encodeURIComponent(text));
    }
    return FORM_URL + "?" + params.join("&");
  }

  return {
    WAGE_MIN: WAGE_MIN,
    WAGE_MAX: WAGE_MAX,
    WAGE_DEFAULT: WAGE_DEFAULT,
    FEEDBACK_MAX_CHARS: FEEDBACK_MAX_CHARS,
    TARGET_SECONDS: TARGET_SECONDS,
    AWAY_NOTICE_MS: AWAY_NOTICE_MS,
    FORM_URL: FORM_URL,
    FEEDBACK_QUESTIONS: FEEDBACK_QUESTIONS,
    countChars: countChars,
    truncateChars: truncateChars,
    parseWageInput: parseWageInput,
    isValidWage: isValidWage,
    formatNumber: formatNumber,
    formatYen: formatYen,
    formatHMS: formatHMS,
    formatHoursMinutes: formatHoursMinutes,
    formatDuration: formatDuration,
    workedSeconds: workedSeconds,
    currentBreakSeconds: currentBreakSeconds,
    earningsCents: earningsCents,
    earnings: earnings,
    formatYenParts: formatYenParts,
    localDateKey: localDateKey,
    todayTotals: todayTotals,
    addToHistory: addToHistory,
    progressRatio: progressRatio,
    awayMs: awayMs,
    buildFeedbackUrl: buildFeedbackUrl
  };
});
