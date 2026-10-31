# Latefolar 公式サイト

Latefolar(ラテフォラール)の公式サイトです。プレーンなHTML/CSSのみで構成された静的サイトで、
フレームワークやビルドツールは使用していません。

ブランドメッセージ: **「仕事の時間を、力強く乗り越える。」**

「Latefolar」は、Lavoro(伊:仕事)× Tempo(伊:時間)× Fortissimo(伊:力強く)× Superar(伊/西:乗り越える)
を組み合わせた造語です。

## ディレクトリ構成

```
latefolar-web/
├── .claude/
│   └── skills/                # Claude Code 用のスキル(開発用。サイトには公開されない)
├── .github/
│   └── workflows/
│       └── announcements.yml  # お知らせの JSON の確認(GitHub Actions)
├── .gitignore
├── README.md
├── scripts/                   # 開発用のスクリプト(サイトには公開されない)
│   ├── validate-announcements.js  # お知らせの JSON を確かめるスクリプト
│   └── tests/                 # 上のスクリプトのテストと、テストの例(fixtures/)
└── docs/                      # ★ 公式サイトとして公開されるフォルダ(GitHub Pages の公開元)
    ├── .nojekyll              # GitHub PagesのJekyll処理を無効化(プレーンHTML配信のため)
    ├── CNAME                  # 独自ドメイン(latefolar.com)
    ├── announcements.json     # アプリ内のお知らせ(アプリが読む)
    ├── index.html             # トップページ
    ├── privacy.html           # プライバシーポリシー(草案)
    ├── terms.html             # 利用規約(草案)
    ├── support.html           # サポート(問い合わせ)
    ├── account-delete.html    # アカウント削除案内(簡易版)
    └── assets/
        ├── css/
        │   └── style.css      # 共通スタイル
        ├── js/
        │   └── main.js        # モバイル用ハンバーガーメニュー
        └── img/
            └── logo.svg       # ロゴ(favicon兼用)
```

> **注意:`docs/` は公式サイトとして公開されるフォルダです。** `docs/` の中に置いたファイルはすべて
> サイトのURLから誰でも開けるようになります。メモ・設計書・スキルなどの内部向けのファイルは
> `docs/` に置かないでください。

外部CDN・Webフォント等は使用しておらず、オフラインでも表示を確認できます。

## ローカルでの確認方法

`docs/` の中の `index.html` 等をブラウザで直接開くか、`docs/` を公開元にして簡易サーバーを立てて確認してください。

```bash
python -m http.server 8000 --directory docs
```

上記実行後、`http://localhost:8000/` にアクセスします。

## GitHub Pages での公開設定

このリポジトリは「ブランチからデプロイ(Deploy from a branch)」方式でGitHub Pagesに公開しています。
ビルド不要のプレーンなHTML/CSSのため、GitHub Actionsによるビルドは行いません(GitHub Actions は、お知らせの JSON の確認にだけ使います)。

1. GitHubリポジトリの **Settings > Pages** を開く
2. **Source** を `Deploy from a branch` に設定
3. **Branch** を `main` / `/docs` に設定して保存

`docs/` の中だけがサイトとして公開されます。`docs/.nojekyll` を配置済みのため、Jekyllによる変換は行われず、
プレーンなHTMLがそのまま公開されます。

### 公開元を `/` から `/docs` に変えた経緯(2026-10-11)

以前は `main` の `/(root)` を公開元にしており、`.nojekyll` によりJekyllを通さないため、`.claude/` や
`README.md`・`.gitignore` もサイトのURLから開ける状態でした。リポジトリは Public のため新たに漏れた情報は
ありませんが、サイトとして公開する範囲を限定するため、公開用のファイルを `docs/` に分け、公開元を
`/docs` に変更しました。

## お知らせ(announcements.json)の出し方

アプリ内のお知らせは `docs/announcements.json` に置き、アプリは `https://latefolar.com/announcements.json` を読みます。
JSON の形などの仕様の正本は、バックエンドのリポジトリ(salary-countup-app)の `docs/design.md` の「お知らせ」です。

このリポジトリは push するとそのまま公開されるため、次の手順で出します。

1. 下書きは、リポジトリの外の `D:\latefolar-announcements\drafts\` に、1件1ファイルで作ります。
   公開前の内容はリポジトリに入れません(Public リポジトリなので、commit すると履歴にも残るため)。
2. 公開するときに初めて、`docs/announcements.json` に加えます。
   この作業のついでに、終了日(`expires_at`)を過ぎたお知らせを JSON から消します。終了日のないお知らせは、
   公開から1年を目安に見直して消します。消したお知らせの `id` も使い回しません(公開リポジトリの履歴に残るため)。
3. commit の前に、手元で次の2つを実行し、どちらも成功することを確かめます。

   ```bash
   node scripts/validate-announcements.js
   ```

   ```bash
   node --test scripts/tests/validate-announcements.test.js
   ```

   問題があると、どのお知らせのどの欄が、なぜだめかを日本語で出し、終了コードが 0 以外になります。
   文言の長さの上限(`title` 40文字・`body` 1000文字・`label` 16文字。全角・半角を区別せず、絵文字も含めて
   1文字ずつ数える)も、このスクリプトで確かめます。
4. commit と push をします。push のあと、GitHub Actions の「お知らせの JSON の確認」が成功したことと、
   `https://latefolar.com/announcements.json` の中身を確かめます。キャッシュのため、反映に10分ほど、
   またはそれ以上かかることがあります。
5. 一度出したお知らせの `id` は、あとから変えたり、使い回したりしません。

GitHub Actions の確認は、公開を止めるものではなく、あとから気付くための仕組みです(push と同時に公開が始まるため)。
公開の前に止めるのは、手順 3 の手元での確認です。スクリプトとテストは Node.js(24 系)だけで動き、
外部のライブラリは使いません。

## セキュリティ・秘密情報について

このリポジトリは **Public** です。APIキー・秘密鍵・アクセストークン・パスワード・`.env` ファイル等の
秘密情報は絶対にコミットしないでください。`.gitignore` にて主要な秘密情報ファイルを除外していますが、
機械的な除外に頼らず、コミット前に必ず内容を確認してください。

## Privacy Policy / Terms / Account Delete は草案です

`docs/privacy.html`・`docs/terms.html`・`docs/account-delete.html` には、現時点で未確定の情報を
`[プレースホルダー: ○○]` の形で明示しています。これらのページは公開前に必ず内容を精査・編集し、
必要に応じて専門家(弁護士等)によるレビューを経てください。「法令やApple/Googleの規約に準拠している」
ことを保証する記述は意図的に避けています。

## 今後の課題(アカウント削除機能について)

Android 版は 2026-10-31 に保留としました。下の Google Play の要件は、Android 版を再開するときに必要になります。

`account-delete.html` は、現時点では「窓口は準備中」という
**お知らせのみ**です。Apple / Google の正式なストア公開要件を満たすには、以下がいずれも必要です。

- **Google Play**: 「アプリ内削除パス」と「Web削除リソース」の**両方**が必須要件であり、どちらか一方だけでは
  要件を満たしません。本リポジトリの `docs/account-delete.html` はこのうち Web削除リソースに相当する部分の
  簡易版に過ぎず、**アプリ内から削除を行える機能は別途必ず実装が必要**で、代替はできません。
- **Apple (App Store)**: アプリ内からアカウント削除を開始できる機能が必須要件です。

上記を踏まえ、今後実装が必要な項目は以下のとおりです。

1. アプリ内からアカウント削除を開始できる機能の実装(Apple要件 / Google Playの「アプリ内削除パス」要件)
2. Webからアカウント削除をリクエストできる機能の実装(Google Playの「Web削除リソース」要件。
   現状は準備中のお知らせのみの `account-delete.html` から、実際にリクエストを受け付け処理するための
   バックエンド側の削除APIの実装が必要)
3. アカウントに紐づくデータの削除処理(バックエンド側)

**現状のままではApple / Googleのアカウント削除要件を満たさないため、アカウント作成を伴う正式なストア申請に
進む前に、上記の実装が必要です。**
