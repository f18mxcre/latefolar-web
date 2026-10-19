// scripts/validate-announcements.js のテスト。
// Node.js に最初から入っている node:test と node:assert だけを使う(外部のライブラリは使わない)。
// 実行: node --test scripts/tests/validate-announcements.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateText, countChars } = require('../validate-announcements.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const SCRIPT = path.join(__dirname, '..', 'validate-announcements.js');
const PUBLISHED = path.join(__dirname, '..', '..', 'docs', 'announcements.json');

// 失敗の例ごとに、出てほしい問題(場所と理由の種類)を書く。
// 日本語の文ではなく、場所と理由の種類で比べる(文言を直してもテストが壊れないように)。
const A0 = 'announcements[0]';
const INVALID = {
  'not-json': [['', 'invalid_json']],
  'bom': [['', 'bom']],
  'root-is-array': [['', 'root_not_object']],
  'schema-version-2': [['schema_version', 'invalid_value']],
  'schema-version-missing': [['schema_version', 'required']],
  'announcements-missing': [['announcements', 'required']],
  'announcements-not-array': [['announcements', 'not_array']],
  'announcement-not-object': [[A0, 'not_object']],
  'unknown-root-field': [['updated_at', 'unknown_field']],
  'unknown-announcement-field': [[`${A0}.titel`, 'unknown_field']],
  'unknown-link-field': [[`${A0}.links[0].target`, 'unknown_field']],

  'id-missing': [[`${A0}.id`, 'required']],
  'id-not-string': [[`${A0}.id`, 'not_string']],
  'id-uppercase': [[`${A0}.id`, 'invalid_format']],
  'id-invalid-char': [[`${A0}.id`, 'invalid_format']],
  'id-leading-hyphen': [[`${A0}.id`, 'invalid_format']],
  'id-trailing-hyphen': [[`${A0}.id`, 'invalid_format']],
  'id-65-chars': [[`${A0}.id`, 'too_long']],
  'id-duplicate': [['announcements[1].id', 'duplicate_id']],

  'kind-missing': [[`${A0}.kind`, 'required']],
  'kind-unknown': [[`${A0}.kind`, 'invalid_value']],

  'title-missing': [[`${A0}.title`, 'required']],
  'title-empty': [[`${A0}.title`, 'empty']],
  'title-whitespace-only': [[`${A0}.title`, 'empty']],
  'body-not-string': [[`${A0}.body`, 'not_string']],
  'title-41-chars': [[`${A0}.title`, 'too_long']],
  'body-1001-chars': [[`${A0}.body`, 'too_long']],
  // 家族の絵文字は見た目は1文字だが、5つのコードポイントをつないだものなので 36 + 5 = 41 文字と数える
  'title-zwj-emoji': [[`${A0}.title`, 'too_long']],

  'published-at-missing': [[`${A0}.published_at`, 'required']],
  'published-at-no-offset': [[`${A0}.published_at`, 'invalid_datetime_format']],
  'published-at-date-only': [[`${A0}.published_at`, 'invalid_datetime_format']],
  'published-at-no-seconds': [[`${A0}.published_at`, 'invalid_datetime_format']],
  'published-at-fraction': [[`${A0}.published_at`, 'invalid_datetime_format']],
  'published-at-lowercase-t': [[`${A0}.published_at`, 'invalid_datetime_format']],
  'published-at-impossible-date': [[`${A0}.published_at`, 'invalid_datetime']],
  'published-at-offset-out-of-range': [[`${A0}.published_at`, 'invalid_datetime']],

  'expires-at-missing-for-important': [[`${A0}.expires_at`, 'required']],
  'expires-at-null-for-important': [[`${A0}.expires_at`, 'required']],
  'expires-at-before-published': [[`${A0}.expires_at`, 'expires_not_after_published']],
  'expires-at-equal-published': [[`${A0}.expires_at`, 'expires_not_after_published']],
  'expires-at-no-offset': [[`${A0}.expires_at`, 'invalid_datetime_format']],

  'links-not-array': [[`${A0}.links`, 'not_array']],
  'links-4-items': [[`${A0}.links`, 'too_many']],
  'link-label-empty': [[`${A0}.links[0].label`, 'empty']],
  'link-label-whitespace-only': [[`${A0}.links[0].label`, 'empty']],
  'link-label-17-chars': [[`${A0}.links[0].label`, 'too_long']],
  'link-url-http': [[`${A0}.links[0].url`, 'url_not_https']],
  'link-url-www': [[`${A0}.links[0].url`, 'url_host_not_allowed']],
  'link-url-subdomain': [[`${A0}.links[0].url`, 'url_host_not_allowed']],
  'link-url-other-host': [[`${A0}.links[0].url`, 'url_host_not_allowed']],
  'link-url-not-url': [[`${A0}.links[0].url`, 'invalid_url']],
  'link-url-port': [[`${A0}.links[0].url`, 'url_has_port']],
  'link-url-userinfo': [[`${A0}.links[0].url`, 'url_has_userinfo']],
  'link-url-uppercase-host': [[`${A0}.links[0].url`, 'url_host_uppercase']],

  'platforms-empty-array': [[`${A0}.platforms`, 'empty_array']],
  'platforms-unknown': [[`${A0}.platforms[1]`, 'invalid_value']],
  'platforms-not-array': [[`${A0}.platforms`, 'not_array']],
  'platforms-duplicate': [[`${A0}.platforms[1]`, 'duplicate_value']],

  'min-version-empty-string': [[`${A0}.min_app_version`, 'empty_string']],
  'min-version-two-parts': [[`${A0}.min_app_version`, 'invalid_version_format']],
  'below-version-four-parts': [[`${A0}.below_app_version`, 'invalid_version_format']],
  'version-with-letters': [[`${A0}.min_app_version`, 'invalid_version_format']],
  'version-leading-zero': [[`${A0}.min_app_version`, 'invalid_version_format']],
  'min-equal-below': [[`${A0}.min_app_version`, 'version_range_invalid']],
  'min-greater-than-below': [[`${A0}.min_app_version`, 'version_range_invalid']],

  'multiple-errors': [
    [`${A0}.kind`, 'invalid_value'],
    [`${A0}.title`, 'empty'],
    [`${A0}.links[0].url`, 'url_not_https'],
  ],
};

const read = (rel) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');
const listJson = (dir) => fs.readdirSync(path.join(FIXTURES, dir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const summarize = (problems) => problems.map((p) => `${p.path} ${p.code}`).sort();

test('失敗の例のファイルと、期待する結果の表が1対1で対応している', () => {
  assert.deepEqual(listJson('invalid'), Object.keys(INVALID).sort());
});

for (const name of listJson('valid')) {
  test(`正しい例: valid/${name}.json は問題なし`, () => {
    assert.deepEqual(summarize(validateText(read(`valid/${name}.json`))), []);
  });
}

for (const [name, expected] of Object.entries(INVALID)) {
  test(`失敗の例: invalid/${name}.json`, () => {
    const problems = validateText(read(`invalid/${name}.json`));
    assert.deepEqual(summarize(problems), expected.map(([p, c]) => `${p} ${c}`).sort());
    for (const p of problems) {
      assert.match(p.message, /[ぁ-んァ-ヶ]/, `日本語の説明が付いていない: ${p.message}`);
    }
  });
}

test('文字の数え方: 絵文字も1文字、全角・半角を区別しない(コードポイント単位)', () => {
  assert.equal('🔔'.length, 2); // string.length(UTF-16 の単位)では2つに数えられる
  assert.equal(countChars('🔔'), 1);
  assert.equal(countChars('お知らせAbc'), 7); // 全角4文字 + 半角3文字
  assert.equal(countChars('1行目\n2行目'), 7); // 改行も1文字
  assert.equal(countChars('\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}'), 5); // ZWJ でつないだ絵文字は5つ
});

test('公開するファイル docs/announcements.json は問題なし', () => {
  assert.deepEqual(summarize(validateText(fs.readFileSync(PUBLISHED, 'utf8'))), []);
});

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('コマンド: 問題が無ければ終了コード 0', () => {
  const r = run(path.join(FIXTURES, 'valid', 'design-example.json'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /問題は見つかりませんでした\(お知らせ 1 件\)/);
});

test('コマンド: 問題があれば終了コード 1 で、どのお知らせのどの欄かを日本語で出す', () => {
  const r = run(path.join(FIXTURES, 'invalid', 'multiple-errors.json'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /問題が 3 件あります/);
  assert.match(r.stderr, /お知らせ 1件目\(id: test-important\)の links\[0\]\.url/);
});

test('コマンド: ファイルが読めなければ終了コード 2', () => {
  const r = run(path.join(FIXTURES, 'no-such-file.json'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /読めません/);
});
