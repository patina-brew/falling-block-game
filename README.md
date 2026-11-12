# 落ちてくるブロックを並べて消すゲーム
落ちてくるブロックを並べて、隙間なく一列を並べられたら削除され、スコアが加算されるゲーム。

## セットアップ

### 必要なもの
#### 言語・実行環境
- HTML：ゲーム画面の構造を作る
- CSS：画面のデザインを整える
- JavaScript：ブラウザ側のゲーム画面・操作とサーバー側の処理を書く
- Webブラウザ：ゲーム画面を実行する
- Node.js 22.12以上：JavaScriptでサーバーやOpenSpecを動かす

#### 開発に使う道具
npm：OpenSpecや、必要なライブラリ・テストツールを管理する。通常、Node.jsと一緒にインストールされる
Docker：サーバーをコンテナで動かす
Git：ソースコードの変更履歴を管理する
VS Code：コードや仕様書を編集する
OpenSpec：ゲームの仕様を整理しながら開発する
テストツール：ゲームの動作を検証する。具体的なツールは開発時に選ぶ

### 手順

1. ブラウザとVS Codeの用意
    WindowsへのChromeまたはEdge、VS Codeのインストール。WSLで開発する場合は、VS CodeのWSL拡張機能のインストールも推奨。Pythonは不要。

2. Node.jsとnpmの確認
    WSLのターミナルでのバージョン確認。
    ```text
    node --version
    npm --version
    ```
    Node.jsは22.12以上が必要。未インストールの場合やバージョンが古い場合は、WSL内へのインストールが必要。

3. Gitとプロジェクトの確認
    falling-block-gameディレクトリ内での確認。
    ```text
    git --version
    git status
    ```
    git initは実行済みのため、再実行は不要。
    初回コミット前の、履歴に記録する名前とメールアドレスの設定。
    ```text
    git config --global user.name "GitHubのユーザー名など"
    git config --global user.email "GitHubに登録したメールアドレスなど"
    ```

4. プロジェクトの依存関係のインストール
    falling-block-gameディレクトリ内での実行。
    ```text
    npm install
    ```
    OpenSpecは追加済みのため、通常は個別の再インストールは不要。バージョンとグローバル設定の確認。

5. Dockerの準備
    WindowsへのDocker Desktopのインストールと起動。設定の「WSL Integration」での、使用中のUbuntuの有効化。
    WSLのターミナルからのDockerへの接続確認。
    ```text
    docker --version
    docker compose version
    docker info
    ```
    ゲーム用Docker設定の追加は、サーバー作成時の作業。

## 使い方

現在開発前のため、ゲームの起動やプレイは未対応。以下は予定している使い方。

1. Webブラウザからゲームサーバーへのアクセス。
2. 落ちてくるブロックの操作と配置。
3. 横一列を隙間なくそろえることによる列の消去とスコアの獲得。
4. 複数人でのプレイ。

アクセス先、操作方法、複数人での参加方法は未定。決定後に追記予定。

## 開発

この節は、OpenSpec を使った開発のためのものである。\
OpenSpec の部分を切り離して納品する場合は、納品物からこの節を削除する。

### 開発に必要なもの

- Node.js 22.12 以上と npm(OpenSpec CLI と検査スクリプトに使う)
- git(コミット前のフックで全体検証を実行する)

### OpenSpec のグローバル設定

OpenSpec が生成するワークフローは、マシンごとのグローバル設定で決まる。\
生成されるファイルを全員で一致させるため、各マシンで最初に1回だけ次を実行する。

```sh
npx --no-install openspec config set profile custom
npx --no-install openspec config set workflows '["explore","ff","apply","update","verify","sync","archive"]'
npx --no-install openspec config set delivery skills
```

Windows PowerShell 5.1 では、2行目が `expected array, received string` で失敗することがある。\
その場合は `npx --no-install openspec config profile` を実行し、対話の画面で上と同じワークフローと配信方法(skills)を選ぶ。\
設定は `npx --no-install openspec config list` で確認できる。

### 開発の準備

1. セットアップの手順で、プロダクトの依存を入れる。
2. `npm install` で、OpenSpec を入れる。
3. OpenSpec のグローバル設定を行う。
4. `git config core.hooksPath .githooks` で、コミット前のフックを有効にする。
5. `npm run check` で、全体検証が成功することを確かめる。

全体検証は、プロダクトの検査と OpenSpec の検査をまとめて実行し、コミットの前にフックで自動で実行される。\
AI ツール向けの生成されたファイル(`.github/skills/`、`.claude/skills/`、`.agents/skills/` のうち、使うツールのもの)はコミットし、手で編集しない。\
OpenSpec を更新した後は、`npx --no-install openspec update` で生成し直す。

### 参照する文書

- プロダクトの目的と範囲: [product.md](openspec/product.md)
- 開発の進め方: [AGENTS.md](AGENTS.md)
- 仕様書の一覧: [openspec/specs/README.md](openspec/specs/README.md)
