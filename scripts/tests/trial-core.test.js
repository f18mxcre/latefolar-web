// 体験版の計算の関数(docs/try/trial-core.js)のテスト。
// Node.js に最初から入っている node:test と node:assert だけを使う(外部のライブラリは使わない)。
// 実行: node --test scripts/tests/trial-core.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../docs/try/trial-core.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
// 端末の時刻で 2026-11-07 09:00:00
const T0 = new Date(2026, 10, 7, 9, 0, 0).getTime();

test('時給の入力: 数字だけを受け付け、全角の数字は半角に直す', () => {
  assert.deepEqual(core.parseWageInput('1,200'), { digits: '1200', value: 1200, valid: true });
  assert.deepEqual(core.parseWageInput('１２００'), { digits: '1200', value: 1200, valid: true });
  assert.deepEqual(core.parseWageInput('¥1,200円'), { digits: '1200', value: 1200, valid: true });
  assert.deepEqual(core.parseWageInput('12a0'), { digits: '120', value: 120, valid: true });
  assert.deepEqual(core.parseWageInput('-5'), { digits: '5', value: 5, valid: true });
  assert.deepEqual(core.parseWageInput('1.5'), { digits: '15', value: 15, valid: true });
  assert.deepEqual(core.parseWageInput(''), { digits: '', value: null, valid: false });
  assert.deepEqual(core.parseWageInput('abc'), { digits: '', value: null, valid: false });
  assert.equal(core.parseWageInput('007').value, 7);
});

test('時給の範囲: 1〜100,000円', () => {
  assert.equal(core.parseWageInput('0').valid, false);
  assert.equal(core.parseWageInput('1').valid, true);
  assert.equal(core.parseWageInput('100000').valid, true);
  assert.equal(core.parseWageInput('100001').valid, false);
  assert.equal(core.parseWageInput('99999999999').digits.length, 7); // 長すぎる入力は7けたで止める
  assert.equal(core.WAGE_DEFAULT, 1200);
});

test('金額: 働いた秒数 × 時給 ÷ 3600 を切り捨てた円', () => {
  assert.equal(core.earnings(0, 1200), 0);
  assert.equal(core.earnings(2, 1200), 0); // 0.66… → 0
  assert.equal(core.earnings(3, 1200), 1);
  assert.equal(core.earnings(3600, 1200), 1200);
  assert.equal(core.earnings(8 * 3600, 1200), 9600);
  assert.equal(core.earnings(2 * 3600 + 3 * 60 + 15, 1200), 2465); // モックアップ T3 の値
  assert.equal(core.earnings(3599, 1), 0);
  assert.equal(core.earnings(3600, 1), 1);
});

test('働いた時間: 覚えた時刻から計算し、休憩を除く', () => {
  const session = { start: T0, breaks: [], breakStart: null };
  assert.equal(core.workedSeconds(session, T0), 0);
  assert.equal(core.workedSeconds(session, T0 + 1999), 1); // 秒未満は切り捨て
  assert.equal(core.workedSeconds(session, T0 + 2 * HOUR), 7200);

  const withBreak = { start: T0, breaks: [{ start: T0 + HOUR, end: T0 + HOUR + 30 * MIN }], breakStart: null };
  assert.equal(core.workedSeconds(withBreak, T0 + 3 * HOUR), 2.5 * 3600);

  const onBreak = { start: T0, breaks: [], breakStart: T0 + HOUR };
  assert.equal(core.workedSeconds(onBreak, T0 + HOUR + 12 * MIN), 3600); // 休憩中は増えない
  assert.equal(core.workedSeconds(onBreak, T0 + 5 * HOUR), 3600);
  assert.equal(core.currentBreakSeconds(onBreak, T0 + HOUR + 12 * MIN + 40 * 1000), 12 * 60 + 40);

  assert.equal(core.workedSeconds({ start: T0, breaks: [], breakStart: null }, T0 - MIN), 0); // 時計が戻っても負にしない
});

test('表示: 金額・H:MM:SS・○時間○○分・閉じていた間', () => {
  assert.equal(core.formatYen(0), '¥0');
  assert.equal(core.formatYen(1200), '¥1,200');
  assert.equal(core.formatYen(1234567), '¥1,234,567');
  assert.equal(core.formatHMS(0), '0:00:00');
  assert.equal(core.formatHMS(2 * 3600 + 3 * 60 + 15), '2:03:15');
  assert.equal(core.formatHMS(12 * 60 + 40), '0:12:40');
  assert.equal(core.formatHMS(25 * 3600), '25:00:00');
  assert.equal(core.formatHoursMinutes(2 * 3600 + 3 * 60 + 59), '2時間03分');
  assert.equal(core.formatDuration(3600 + 12 * 60), '1時間12分');
  assert.equal(core.formatDuration(5 * 60 + 30), '5分');
});

test('今日の合計: 退勤した日の端末の日付で数え、日付が変わると0から', () => {
  let history = {};
  history = core.addToHistory(history, T0 + 8 * HOUR, 8 * 3600, 9600);
  assert.deepEqual(core.todayTotals(history, T0 + 9 * HOUR), { seconds: 8 * 3600, amount: 9600 });
  history = core.addToHistory(history, T0 + 10 * HOUR, 3600, 1200);
  assert.deepEqual(core.todayTotals(history, T0 + 10 * HOUR), { seconds: 9 * 3600, amount: 10800 });

  const nextDay = new Date(2026, 10, 8, 0, 0, 1).getTime();
  assert.deepEqual(core.todayTotals(history, nextDay), { seconds: 0, amount: 0 });

  // 0時をまたいだ勤務は、退勤した日に全部入れる
  const lateStart = new Date(2026, 10, 7, 22, 0, 0).getTime();
  const lateEnd = new Date(2026, 10, 8, 2, 0, 0).getTime();
  const lateSession = { start: lateStart, breaks: [], breakStart: null };
  const sec = core.workedSeconds(lateSession, lateEnd);
  history = core.addToHistory(history, lateEnd, sec, core.earnings(sec, 1200));
  assert.deepEqual(core.todayTotals(history, lateEnd), { seconds: 4 * 3600, amount: 4800 });
  assert.equal(core.todayTotals(history, T0).amount, 10800); // 前の日の分は変わらない
});

test('今日の合計の記録: 14日より古い日は消す', () => {
  let history = { '2026-10-01': { seconds: 1, amount: 1 } };
  history = core.addToHistory(history, T0, 60, 20);
  assert.deepEqual(Object.keys(history), ['2026-11-07']);
});

test('進み具合: 8時間で 100% にして止める', () => {
  assert.equal(core.progressRatio(0), 0);
  assert.equal(core.progressRatio(4 * 3600), 0.5);
  assert.equal(core.progressRatio(10 * 3600), 1);
});

test('閉じていた間: 1分以上あいていたときだけ', () => {
  assert.equal(core.awayMs(null, T0), 0);
  assert.equal(core.awayMs(T0, T0 + 59 * 1000), 0);
  assert.equal(core.awayMs(T0, T0 + MIN), MIN);
  assert.equal(core.awayMs(T0, T0 + HOUR + 12 * MIN), HOUR + 12 * MIN);
});

test('感想のリンク: 何も選ばなければ、入力なしのフォーム', () => {
  assert.equal(core.buildFeedbackUrl({}), core.FORM_URL + '?usp=pp_url');
  assert.equal(core.buildFeedbackUrl({ willUse: null, source: null, comment: '  \n ' }), core.FORM_URL + '?usp=pp_url');
});

test('感想のリンク: 選んだもの・書いたものだけを、URL エンコードして入れる', () => {
  const url = core.buildFeedbackUrl({ willUse: '使いたい', source: 'TikTok', comment: '時給 & 休憩 #1\n2行目' });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, core.FORM_URL);
  assert.deepEqual([...u.searchParams.keys()], ['usp', 'entry.991601904', 'entry.2036366728', 'entry.685114059']);
  assert.equal(u.searchParams.get('usp'), 'pp_url');
  assert.equal(u.searchParams.get('entry.991601904'), '使いたい');
  assert.equal(u.searchParams.get('entry.2036366728'), 'TikTok');
  assert.equal(u.searchParams.get('entry.685114059'), '時給 & 休憩 #1\n2行目');
  assert.ok(!/[&#\s]/.test(url.split('?')[1].replace(/&(?=entry\.|usp=)/g, '')), '値の中の & # 空白はエンコードする');
});

test('感想のリンク: 選択肢の文字はフォームと同じで、それ以外は入れない', () => {
  assert.deepEqual(core.FEEDBACK_QUESTIONS.willUse.options, ['使いたい', 'たぶん', '今はいい']);
  assert.deepEqual(core.FEEDBACK_QUESTIONS.source.options, ['YouTube', 'TikTok', 'X', 'その他']);
  const u = new URL(core.buildFeedbackUrl({ willUse: '使いたい!', source: 'Instagram' }));
  assert.equal(u.searchParams.has('entry.991601904'), false);
  assert.equal(u.searchParams.has('entry.2036366728'), false);
});

test('感想のリンク: 時給・金額・時間は入れない', () => {
  const url = core.buildFeedbackUrl({ willUse: 'たぶん', wage: 1200, amount: 9600, seconds: 28800 });
  assert.deepEqual([...new URL(url).searchParams.keys()], ['usp', 'entry.991601904']);
});

test('感想の長さ: 絵文字も1文字として数え、500文字で切る', () => {
  assert.equal(core.FEEDBACK_MAX_CHARS, 500);
  assert.equal('🔔'.length, 2);
  assert.equal(core.countChars('🔔あa'), 3);
  const long = '🔔'.repeat(600);
  assert.equal(core.countChars(core.truncateChars(long, 500)), 500);
  const u = new URL(core.buildFeedbackUrl({ comment: 'あ'.repeat(700) }));
  assert.equal(core.countChars(u.searchParams.get('entry.685114059')), 500);
  // 500文字でもリンクの長さは、ふつうのブラウザで開ける長さに収まる
  assert.ok(core.buildFeedbackUrl({ willUse: '今はいい', source: 'その他', comment: 'あ'.repeat(500) }).length < 5000);
});
