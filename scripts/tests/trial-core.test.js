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

test('金額の小数2けた: 0.01円単位の整数(秒数 × 時給 × 100 ÷ 3600 の切り捨て)', () => {
  assert.equal(typeof core.earningsCents(1, 1200), 'bigint');
  assert.equal(core.earningsCents(0, 1200), 0n);
  assert.equal(core.earningsCents(1, 1200), 33n); // ¥0.33
  assert.equal(core.earningsCents(3, 1200), 100n); // ¥1.00
  assert.equal(core.earningsCents(-5, 1200), 0n);
  assert.equal(core.earningsCents(2.9, 1200), 66n); // 1秒未満は切り捨ててから
});

test('金額の小数2けた: 時給 ¥3,000 で 6秒と 7秒の小数が違う(円は同じ ¥5)', () => {
  assert.deepEqual(core.formatYenParts(core.earningsCents(6, 3000)), { yen: '¥5', frac: '.00' });
  assert.deepEqual(core.formatYenParts(core.earningsCents(7, 3000)), { yen: '¥5', frac: '.83' });
  assert.equal(core.earnings(6, 3000), core.earnings(7, 3000)); // 円だけだと止まって見えていた
});

test('金額の小数2けた: 時給 ¥1,200 で、毎秒小数が変わる', () => {
  let prev = null;
  for (let s = 0; s <= 3600; s++) {
    const cents = core.earningsCents(s, 1200);
    if (prev !== null) {
      assert.ok(cents > prev, `${s}秒で増えていない`);
    }
    prev = cents;
  }
  // 時給がいちばん低い ¥1 でも、36秒ごとに 0.01円ずつ増える
  assert.equal(core.earningsCents(35, 1), 0n);
  assert.equal(core.earningsCents(36, 1), 1n);
});

test('金額の小数2けた: 円の部分は、今までの円までの値と同じ', () => {
  const wages = [1, 7, 999, 1000, 1200, 1234, 3000, 3600, 3601, 7200, 12345, 99999, 100000];
  for (const w of wages) {
    for (let s = 0; s <= 20000; s += 7) {
      const old = Math.floor((s * w) / 3600); // これまでの計算(この範囲では整数のまま正しく出る)
      assert.equal(core.earnings(s, w), old, `時給 ${w}・${s}秒`);
      assert.equal(core.earningsCents(s, w) / 100n, BigInt(old), `時給 ${w}・${s}秒(小数の整数から)`);
    }
  }
});

test('金額の小数2けた: 上限の時給で長い勤務でも正しい(桁あふれしない)', () => {
  assert.deepEqual(core.formatYenParts(core.earningsCents(8 * 3600, 100000)), { yen: '¥800,000', frac: '.00' });
  assert.deepEqual(core.formatYenParts(core.earningsCents(8 * 3600 + 1, 100000)), { yen: '¥800,027', frac: '.77' });
  // 10年(87,600時間)働き続けた場合: ¥100,000 × 87,600 = ¥8,760,000,000
  const tenYears = 10 * 365 * 24 * 3600;
  assert.equal(core.earningsCents(tenYears, 100000), 876000000000n);
  assert.equal(core.earnings(tenYears, 100000), 8760000000);
  // ふつうの数の計算では桁があふれる長さ(秒数 × 時給 が 2^53 を超える)でも、整数のまま正しい
  const huge = 1e12; // 約3万年
  assert.ok(!Number.isSafeInteger(huge * 100000));
  assert.equal(core.earningsCents(huge, 100000), (1000000000000n * 100000n) / 36n);
  assert.deepEqual(core.formatYenParts(core.earningsCents(huge, 100000)), { yen: '¥27,777,777,777,777', frac: '.77' });
});

test('金額の表示: 3けたごとの区切りと小数2けた', () => {
  assert.deepEqual(core.formatYenParts(0n), { yen: '¥0', frac: '.00' });
  assert.deepEqual(core.formatYenParts(5n), { yen: '¥0', frac: '.05' });
  assert.deepEqual(core.formatYenParts(123456789n), { yen: '¥1,234,567', frac: '.89' });
  assert.deepEqual(core.formatYenParts(83), { yen: '¥0', frac: '.83' }); // 数でも受け付ける
  assert.equal(core.formatNumber(1234567n), '1,234,567');
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

// ---------- シェア ----------

const SHARE_HEAD = 'ラテフォラールの体験版で、働いた時間がお給料になって増えていくのを見てみました。';
const SHARE_TAIL = ' #ラテフォラール体験版 https://latefolar.com/try/';

test('シェアの文: チェックなしなら、金額を入れない', () => {
  assert.equal(core.buildShareText(false, 9600), SHARE_HEAD + SHARE_TAIL);
  assert.equal(core.buildShareText(false), SHARE_HEAD + SHARE_TAIL);
});

test('シェアの文: チェックありなら、「見てみました。」の後に金額を入れる', () => {
  assert.equal(core.buildShareText(true, 9600), SHARE_HEAD + '今回は ¥9,600 になりました。' + SHARE_TAIL);
});

test('シェアの文: 金額は「今回の給料」と同じ円までの表示(3けた区切り)', () => {
  assert.equal(core.buildShareText(true, 1234567), SHARE_HEAD + '今回は ¥1,234,567 になりました。' + SHARE_TAIL);
  assert.equal(core.buildShareText(true, 999), SHARE_HEAD + '今回は ¥999 になりました。' + SHARE_TAIL);
  assert.ok(core.buildShareText(true, 9600).includes(core.formatYen(9600)));
});

test('シェアの文: 0円でも金額を入れる', () => {
  assert.equal(core.buildShareText(true, 0), SHARE_HEAD + '今回は ¥0 になりました。' + SHARE_TAIL);
});

test('シェアの文: 金額が正しい数でなければ、金額の文を入れない', () => {
  for (const bad of [undefined, null, NaN, Infinity, -1, '9600']) {
    assert.equal(core.buildShareText(true, bad), SHARE_HEAD + SHARE_TAIL);
  }
});

test('X の投稿画面: x.com/intent/tweet に、文を text だけに入れる', () => {
  for (const text of [core.buildShareText(false, 0), core.buildShareText(true, 1234567)]) {
    const url = core.buildXShareUrl(text);
    assert.ok(url.startsWith('https://x.com/intent/tweet?text='));
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, 'https://x.com/intent/tweet');
    assert.deepEqual([...u.searchParams.keys()], ['text']);
    assert.equal(u.searchParams.get('text'), text);
    // # や & をそのまま入れない(URL エンコードする)
    assert.ok(url.includes('%23'));
    assert.ok(!url.slice(url.indexOf('?') + 1).includes('#'));
  }
});

// X の数え方(日本語などは2、URL は 23)で数える
function xWeightedLength(text) {
  const urlPattern = /https?:\/\/\S+/g;
  let n = 0;
  for (const m of text.match(urlPattern) || []) n += 23;
  for (const ch of text.replace(urlPattern, '')) {
    const c = ch.codePointAt(0);
    const light = c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247);
    n += light ? 1 : 2;
  }
  return n;
}

test('シェアの文: 金額ありでも、X の 280 文字に収まる', () => {
  assert.ok(xWeightedLength(core.buildShareText(true, 7 * 100000 * 24 * 365)) <= 280);
  assert.ok(xWeightedLength(core.buildShareText(false)) <= 280);
});

test('シェアの文: ハッシュタグの前に半角スペースがある(X がハッシュタグとして扱うため)', () => {
  for (const text of [core.buildShareText(false), core.buildShareText(true, 9600), core.buildShareText(true, 0)]) {
    const i = text.indexOf('#');
    assert.ok(i > 1);
    assert.equal(text.split('#').length, 2);
    assert.equal(text[i - 1], ' ');
    assert.equal(text.slice(i - 2, i + 1), '。 #');
    // X の URL の text でも同じ
    assert.equal(new URL(core.buildXShareUrl(text)).searchParams.get('text').slice(i - 1, i + 1), ' #');
    // URL の前にも半角スペースがある
    assert.ok(text.includes('#ラテフォラール体験版 https://latefolar.com/try/'));
  }
});
