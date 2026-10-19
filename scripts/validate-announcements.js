#!/usr/bin/env node
// お知らせの JSON(docs/announcements.json)を、公開する前に確かめるスクリプト。
// 仕様の正本は salary-countup-app の docs/design.md の「お知らせ」。
// Node.js の標準の機能だけで動かす(外部のライブラリは使わない)。
//
// 使い方: node scripts/validate-announcements.js [ファイル]
//   ファイルを省くと docs/announcements.json を確かめる。
// 終了コード: 0 = 問題なし / 1 = 問題あり / 2 = ファイルが読めない・使い方の誤り
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE = path.join(__dirname, '..', 'docs', 'announcements.json');

const ROOT_KEYS = ['schema_version', 'announcements'];
const ANNOUNCEMENT_KEYS = [
  'id', 'kind', 'title', 'body', 'published_at', 'expires_at',
  'links', 'platforms', 'min_app_version', 'below_app_version',
];
const LINK_KEYS = ['label', 'url'];
const KINDS = ['important', 'update', 'info'];
const PLATFORMS = ['ios', 'android'];
const LINK_HOSTS = ['latefolar.com', 'apps.apple.com', 'play.google.com'];
const MAX_LINKS = 3;
const ID_MAX_LENGTH = 64;
// 文言の長さの上限。全角・半角を区別せず、Unicode のコードポイント単位で数える(countChars)
const TITLE_MAX_LENGTH = 40;
const BODY_MAX_LENGTH = 1000;
const LABEL_MAX_LENGTH = 16;

// 英小文字・数字・ハイフンだけで、先頭と末尾はハイフン以外
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
// YYYY-MM-DDTHH:MM:SS に Z か ±HH:MM。秒は必須、秒の小数は不可、T は大文字だけ
const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:Z|([+-])(\d{2}):(\d{2}))$/;
// 数字3つをドットで区切った形。各部分は 0 か、先頭が 0 でない数字
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isAbsent = (obj, key) => !has(obj, key) || obj[key] === null;
const show = (v) => JSON.stringify(v);

// 1つの問題: path は機械で比べるための場所、code は理由の種類、message は人が読む日本語
function createCollector() {
  const problems = [];
  const add = (where, p, code, message) => problems.push({ path: p, code, message: `${where}: ${message}` });
  return { problems, add };
}

function rootWhere(key) {
  return key ? `全体の ${key}` : '全体';
}

function announcementWhere(index, item, field) {
  const id = isPlainObject(item) && typeof item.id === 'string' ? item.id : '(なし)';
  return `お知らせ ${index + 1}件目(id: ${id})${field ? `の ${field}` : ''}`;
}

// 日時を確かめ、正しければ UTC のミリ秒を返す。正しくなければ null を返す
function checkDateTime(value, where, p, add) {
  if (typeof value !== 'string') {
    add(where, p, 'not_string', `文字列で書く必要があります(今は ${show(value)})。`);
    return null;
  }
  const m = DATETIME_PATTERN.exec(value);
  if (!m) {
    add(where, p, 'invalid_datetime_format',
      `「${value}」は使えない形です。「2026-11-01T09:00:00+09:00」や「2026-11-01T00:00:00Z」のように、秒まで書き、時差を付けてください(秒の小数は使えません)。`);
    return null;
  }
  const [, ys, mos, ds, hs, mis, ss, sign, ohs, oms] = m;
  const [y, mo, d, h, mi, s] = [ys, mos, ds, hs, mis, ss].map(Number);
  const daysInMonth = mo >= 1 && mo <= 12 ? new Date(Date.UTC(y, mo, 0)).getUTCDate() : 0;
  const offsetOk = sign === undefined
    || (Number(ohs) <= 14 && Number(oms) <= 59 && !(Number(ohs) === 14 && Number(oms) !== 0));
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth || h > 23 || mi > 59 || s > 59 || !offsetOk) {
    add(where, p, 'invalid_datetime',
      `「${value}」は実在しない日時か、範囲の外の時差です(時差は -14:00〜+14:00)。`);
    return null;
  }
  const offsetMinutes = sign === undefined ? 0 : (sign === '+' ? 1 : -1) * (Number(ohs) * 60 + Number(oms));
  return Date.UTC(y, mo - 1, d, h, mi, s) - offsetMinutes * 60 * 1000;
}

// 文字の数。string.length(UTF-16 の単位)では絵文字などが2つに数えられるため、コードポイント単位で数える
const countChars = (s) => [...s].length;

// 空でない文字列で、上限の文字数以内か(空白や改行だけも「空」とみなす。改行や前後の空白も1文字として数える)
function checkText(obj, key, maxLength, where, p, add) {
  if (!has(obj, key)) {
    add(where, p, 'required', '必須の欄がありません。');
    return;
  }
  const v = obj[key];
  if (typeof v !== 'string') {
    add(where, p, 'not_string', `文字列で書く必要があります(今は ${show(v)})。`);
  } else if (v.trim() === '') {
    add(where, p, 'empty', '空です(空白や改行だけも空とみなします)。');
  } else if (countChars(v) > maxLength) {
    add(where, p, 'too_long',
      `${maxLength} 文字までです(今は ${countChars(v)} 文字。全角・半角を区別せず、1文字ずつ数えます)。`);
  }
}

function checkUnknownKeys(obj, allowed, whereOf, pathOf, add) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      add(whereOf(key), pathOf(key), 'unknown_field',
        `知らない欄です。使える欄は ${allowed.join('・')} です(書き間違いがないか確かめてください)。`);
    }
  }
}

function checkUrl(value, where, p, add) {
  if (typeof value !== 'string') {
    add(where, p, 'not_string', `文字列で書く必要があります(今は ${show(value)})。`);
    return;
  }
  if (!value.startsWith('https://')) {
    add(where, p, 'url_not_https', `「${value}」は https:// で始まっていません。`);
    return;
  }
  try {
    new URL(value);
  } catch {
    add(where, p, 'invalid_url', `「${value}」は URL として読めません。`);
    return;
  }
  // URL の正規化に頼らず、書かれたままのホストの部分で判定する
  const authority = value.slice('https://'.length).split(/[/?#]/)[0];
  if (authority.includes('@')) {
    add(where, p, 'url_has_userinfo', `「${value}」にユーザー名などが入っています。ホストだけを書いてください。`);
    return;
  }
  if (authority.includes(':')) {
    add(where, p, 'url_has_port', `「${value}」にポート番号が入っています。ポート番号は書かないでください。`);
    return;
  }
  if (LINK_HOSTS.includes(authority)) return;
  if (LINK_HOSTS.includes(authority.toLowerCase())) {
    add(where, p, 'url_host_uppercase', `ホスト「${authority}」に大文字が入っています。小文字で書いてください。`);
    return;
  }
  add(where, p, 'url_host_not_allowed',
    `ホスト「${authority}」は使えません。${LINK_HOSTS.join('・')} のどれかと完全に一致する必要があります(www. や他のサブドメインも使えません)。`);
}

function checkLinks(item, index, add) {
  if (isAbsent(item, 'links')) return;
  const base = `announcements[${index}].links`;
  const links = item.links;
  if (!Array.isArray(links)) {
    add(announcementWhere(index, item, 'links'), base, 'not_array', `配列か null で書く必要があります(今は ${show(links)})。`);
    return;
  }
  if (links.length > MAX_LINKS) {
    add(announcementWhere(index, item, 'links'), base, 'too_many', `リンクは ${MAX_LINKS} 個までです(今は ${links.length} 個)。`);
  }
  links.forEach((link, j) => {
    const lp = `${base}[${j}]`;
    const lw = (field) => announcementWhere(index, item, `links[${j}]${field ? `.${field}` : ''}`);
    if (!isPlainObject(link)) {
      add(lw(), lp, 'not_object', `label と url を持つオブジェクトで書く必要があります(今は ${show(link)})。`);
      return;
    }
    checkUnknownKeys(link, LINK_KEYS, lw, (key) => `${lp}.${key}`, add);
    checkText(link, 'label', LABEL_MAX_LENGTH, lw('label'), `${lp}.label`, add);
    if (!has(link, 'url')) {
      add(lw('url'), `${lp}.url`, 'required', '必須の欄がありません。');
    } else {
      checkUrl(link.url, lw('url'), `${lp}.url`, add);
    }
  });
}

function checkPlatforms(item, index, add) {
  if (isAbsent(item, 'platforms')) return;
  const p = `announcements[${index}].platforms`;
  const v = item.platforms;
  if (!Array.isArray(v)) {
    add(announcementWhere(index, item, 'platforms'), p, 'not_array', `配列か null で書く必要があります(今は ${show(v)})。`);
    return;
  }
  if (v.length === 0) {
    add(announcementWhere(index, item, 'platforms'), p, 'empty_array',
      '空の配列は使えません。両方に出すときは null にするか、欄を書かないでください。');
    return;
  }
  const seen = new Set();
  v.forEach((platform, j) => {
    const w = announcementWhere(index, item, `platforms[${j}]`);
    if (!PLATFORMS.includes(platform)) {
      add(w, `${p}[${j}]`, 'invalid_value', `${show(platform)} は使えません。${PLATFORMS.join('・')} のどれかです。`);
    } else if (seen.has(platform)) {
      add(w, `${p}[${j}]`, 'duplicate_value', `「${platform}」が重なっています。`);
    }
    seen.add(platform);
  });
}

// バージョンを確かめ、正しければ [major, minor, patch](BigInt)を返す
function checkVersion(item, index, key, add) {
  if (isAbsent(item, key)) return null;
  const v = item[key];
  const w = announcementWhere(index, item, key);
  const p = `announcements[${index}].${key}`;
  if (typeof v !== 'string') {
    add(w, p, 'not_string', `文字列か null で書く必要があります(今は ${show(v)})。`);
    return null;
  }
  if (v === '') {
    add(w, p, 'empty_string', '空の文字列は使えません。絞らないときは null にするか、欄を書かないでください。');
    return null;
  }
  const m = VERSION_PATTERN.exec(v);
  if (!m) {
    add(w, p, 'invalid_version_format',
      `「${v}」は使えない形です。「0.1.0」のように、数字3つをドットで区切ってください(各部分の先頭に 0 は付けられません)。`);
    return null;
  }
  return m.slice(1).map((s) => BigInt(s));
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function validateAnnouncement(item, index, seenIds, add) {
  const base = `announcements[${index}]`;
  const w = (field) => announcementWhere(index, item, field);
  if (!isPlainObject(item)) {
    add(w(), base, 'not_object', `オブジェクトで書く必要があります(今は ${show(item)})。`);
    return;
  }
  checkUnknownKeys(item, ANNOUNCEMENT_KEYS, w, (key) => `${base}.${key}`, add);

  // id
  if (!has(item, 'id')) {
    add(w('id'), `${base}.id`, 'required', '必須の欄がありません。');
  } else if (typeof item.id !== 'string') {
    add(w('id'), `${base}.id`, 'not_string', `文字列で書く必要があります(今は ${show(item.id)})。`);
  } else if (item.id.length > ID_MAX_LENGTH) {
    add(w('id'), `${base}.id`, 'too_long', `${ID_MAX_LENGTH} 文字までです(今は ${item.id.length} 文字)。`);
  } else if (!ID_PATTERN.test(item.id)) {
    add(w('id'), `${base}.id`, 'invalid_format',
      `「${item.id}」は使えない形です。英小文字・数字・ハイフンだけで、先頭と末尾はハイフン以外にしてください。`);
  } else if (seenIds.has(item.id)) {
    add(w('id'), `${base}.id`, 'duplicate_id', `「${item.id}」は ${seenIds.get(item.id) + 1}件目と重なっています。`);
  } else {
    seenIds.set(item.id, index);
  }

  // kind
  if (!has(item, 'kind')) {
    add(w('kind'), `${base}.kind`, 'required', '必須の欄がありません。');
  } else if (!KINDS.includes(item.kind)) {
    add(w('kind'), `${base}.kind`, 'invalid_value', `${show(item.kind)} は使えません。${KINDS.join('・')} のどれかです。`);
  }

  // title・body
  checkText(item, 'title', TITLE_MAX_LENGTH, w('title'), `${base}.title`, add);
  checkText(item, 'body', BODY_MAX_LENGTH, w('body'), `${base}.body`, add);

  // published_at
  let publishedMs = null;
  if (!has(item, 'published_at')) {
    add(w('published_at'), `${base}.published_at`, 'required', '必須の欄がありません。');
  } else {
    publishedMs = checkDateTime(item.published_at, w('published_at'), `${base}.published_at`, add);
  }

  // expires_at(important のときは必須。null は「書いていない」と同じに扱う)
  if (isAbsent(item, 'expires_at')) {
    if (item.kind === 'important') {
      add(w('expires_at'), `${base}.expires_at`, 'required', 'kind が important のときは必須です。');
    }
  } else {
    const expiresMs = checkDateTime(item.expires_at, w('expires_at'), `${base}.expires_at`, add);
    if (expiresMs !== null && publishedMs !== null && expiresMs <= publishedMs) {
      add(w('expires_at'), `${base}.expires_at`, 'expires_not_after_published',
        `published_at(${item.published_at})より後にする必要があります(今は ${item.expires_at})。`);
    }
  }

  checkLinks(item, index, add);
  checkPlatforms(item, index, add);

  const min = checkVersion(item, index, 'min_app_version', add);
  const below = checkVersion(item, index, 'below_app_version', add);
  if (min && below && compareVersions(min, below) >= 0) {
    add(w('min_app_version'), `${base}.min_app_version`, 'version_range_invalid',
      `min_app_version(${item.min_app_version})は below_app_version(${item.below_app_version})より小さくする必要があります。`);
  }
}

// 読み込んだあとのデータを確かめる
function validateData(data) {
  const { problems, add } = createCollector();
  if (!isPlainObject(data)) {
    add(rootWhere(), '', 'root_not_object', `全体は { } のオブジェクトで書く必要があります(今は ${Array.isArray(data) ? '配列' : show(data)})。`);
    return problems;
  }
  checkUnknownKeys(data, ROOT_KEYS, rootWhere, (key) => key, add);

  if (!has(data, 'schema_version')) {
    add(rootWhere('schema_version'), 'schema_version', 'required', '必須の欄がありません。');
  } else if (data.schema_version !== 1) {
    add(rootWhere('schema_version'), 'schema_version', 'invalid_value', `1 にする必要があります(今は ${show(data.schema_version)})。`);
  }

  if (!has(data, 'announcements')) {
    add(rootWhere('announcements'), 'announcements', 'required', '必須の欄がありません。');
  } else if (!Array.isArray(data.announcements)) {
    add(rootWhere('announcements'), 'announcements', 'not_array', `配列で書く必要があります(今は ${show(data.announcements)})。`);
  } else {
    const seenIds = new Map();
    data.announcements.forEach((item, i) => validateAnnouncement(item, i, seenIds, add));
  }
  return problems;
}

// ファイルの中身(文字列)を確かめる
function validateText(text) {
  if (text.charCodeAt(0) === 0xfeff) {
    return [{ path: '', code: 'bom', message: '全体: ファイルの先頭に BOM があります。BOM なしの UTF-8 で保存してください。' }];
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // Node.js の版によって、誤りの位置が「line N column M」か「position N」で出る(出ないこともある)
    let where = '';
    const lc = /line (\d+) column (\d+)/.exec(e.message);
    const pos = /position (\d+)/.exec(e.message);
    if (lc) {
      where = `${lc[1]}行目の${lc[2]}文字目のあたりに誤りがあります。`;
    } else if (pos) {
      const before = text.slice(0, Number(pos[1]));
      where = `${before.split('\n').length}行目の${before.length - before.lastIndexOf('\n')}文字目のあたりに誤りがあります。`;
    }
    const detail = e.message.replace(/\s*\n\s*/g, ' ');
    return [{
      path: '', code: 'invalid_json',
      message: `全体: JSON として読めません。${where}カンマ・括弧・引用符の付け忘れや付けすぎがないか確かめてください(詳細: ${detail})。`,
    }];
  }
  return validateData(data);
}

function main(argv) {
  if (argv.length > 1) {
    console.error('使い方: node scripts/validate-announcements.js [ファイル]');
    return 2;
  }
  const file = argv[0] ? path.resolve(argv[0]) : DEFAULT_FILE;
  const shown = path.relative(process.cwd(), file) || file;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`${shown} を読めません(${e.code || e.message})。`);
    return 2;
  }
  const problems = validateText(text);
  if (problems.length > 0) {
    console.error(`${shown} に問題が ${problems.length} 件あります。`);
    for (const p of problems) console.error(`- ${p.message}`);
    return 1;
  }
  const count = JSON.parse(text).announcements.length;
  console.log(`${shown}: 問題は見つかりませんでした(お知らせ ${count} 件)。`);
  return 0;
}

module.exports = { validateText, validateData, countChars };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
