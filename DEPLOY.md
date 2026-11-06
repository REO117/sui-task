# Cloudflareへの公開

## 1. リソース

公式Wranglerにログインし、専用のD1を作る。

```sh
npx wrangler login
npx wrangler d1 create sui-task-db
```

返されたdatabase_idをwrangler.jsoncのD1設定へ入れる。ローカル設定のIDはローカル検証用なので変更不要。

```sh
npm run db:remote
npm run deploy
```

## 2. Googleログイン

Google Cloudにアプリ専用のプロジェクトを作り、Google Auth Platformのブランド・対象・連絡先を設定する。Webアプリ用OAuthクライアントを作り、承認済みリダイレクトURIに以下を登録する。

```text
https://<公開ホスト>/auth/callback
```

Googleログイン以外のAPI権限は追加しない。テスト公開の間は、利用するGoogleアカウントをテストユーザーへ追加する。一般公開する場合は、Google側の公開状態と対象ユーザーを別途確認する。

クライアントIDとクライアントシークレットはWranglerのsecretとして登録する。値をコマンド引数、GitHub、チャット、スクリーンショット、公開コードへ残さない。

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

APP_ORIGINに最終的なHTTPS公開URLを設定して、再公開する。
APP_ORIGINはCookie・送信元確認・Googleへの戻り先に使用するため、URLを変更したらGoogle側も更新する。

## 3. Workers AI

wrangler.jsoncのAI bindingを利用する。初期モデルは `@cf/openai/gpt-oss-20b`。
選択モデルがその時点のプランとカタログで利用できることを確認する。プラン変更や請求先登録は自動で行わない。

## 4. 最終確認

- `/api/config` がgoogle=true / ai=trueを返す。
- Googleでログイン → 保存 → 再ログイン後に同じタスクを取得。
- 別ブラウザでも同じアカウントのタスクが同期される。
- 別アカウントから他人のタスクを取得・編集できない。
- AIで候補生成 → 候補を選択 → 追加。
- オフラインで保存 → オンライン復帰で同期。
- Android Chromeのホーム画面追加と単独起動。

公開したという事実と、認証・AI・Android実機の検証結果は分けて記録する。

## 公式情報

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Wrangler設定](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Workers AIモデル](https://developers.cloudflare.com/workers-ai/models/gpt-oss-20b/)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
