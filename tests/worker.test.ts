import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import app, { hash, type Env } from '../worker/index';
import { makeTask } from '../src/model';

let mf: Miniflare, database: D1Database;
let env: Env;
const host = 'https://sui.example';
const fakeToken = 'test-only-session-not-a-real-secret';
const fakeTokenB = 'test-only-other-user';
function request(path: string, body?: unknown, token = fakeToken, origin = host, override: Partial<Env> = {}) {
  return app.request(`${host}${path}`, body === undefined ? { headers: { Cookie: `sui_session=${token}` } } : {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `sui_session=${token}` }, body: JSON.stringify(body)
  }, { ...env, ...override });
}
beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch(){ return new Response("ok") } }', d1Databases: ['DB'], compatibilityDate: '2026-11-06' }));
  database = await mf.getD1Database('DB') as unknown as D1Database;
  const schema = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
  for (const query of schema.split(';').map(s => s.trim()).filter(Boolean)) await database.prepare(query).run();
  await database.batch([
    database.prepare('INSERT INTO users VALUES(?,?,?)').bind('user-a', 'a@example.com', 'Test A'),
    database.prepare('INSERT INTO users VALUES(?,?,?)').bind('user-b', 'b@example.com', 'Test B'),
    database.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(fakeToken), 'user-a', Date.now() + 600000),
    database.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(fakeTokenB), 'user-b', Date.now() + 600000)
  ]);
  env = { DB: database, APP_ORIGIN: host, ALLOWED_GOOGLE_EMAIL: 'a@example.com', ASSETS: {} as Fetcher } as Env;
}, 30000);
afterAll(async () => { await mf?.dispose(); });

describe('認証・送信元の保護', () => {
  it('未ログインの本人情報はnull', async () => { expect(await (await request('/api/me', undefined, '')).json()).toEqual({ user: null }); });
  it('セッションから本人情報を取得', async () => { expect(await (await request('/api/me')).json()).toMatchObject({ user: { id: 'user-a' } }); });
  it('本人以外は既存セッションがあっても拒否する', async () => { expect((await request('/api/sync', { tasks: [] }, fakeTokenB)).status).toBe(401); expect(await (await request('/api/me', undefined, fakeTokenB)).json()).toEqual({ user: null }); });
  it('本人限定の設定がない場合はログインを認めない', async () => { expect((await request('/api/sync', { tasks: [] }, fakeToken, host, { ALLOWED_GOOGLE_EMAIL: undefined })).status).toBe(401); });
  it('偽のセッションは同期不可', async () => { expect((await request('/api/sync', { tasks: [] }, 'forged')).status).toBe(401); });
  it('別の送信元は拒否', async () => { expect((await request('/api/sync', { tasks: [] }, fakeToken, 'https://evil.example')).status).toBe(403); });
  it('Originなしの変更操作は拒否', async () => {
    const r = await app.request(`${host}/api/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, env);
    expect(r.status).toBe(403);
  });
  it('JSON以外の変更操作は拒否', async () => {
    const r = await app.request(`${host}/api/sync`, { method: 'POST', headers: { Origin: host, 'Content-Type': 'text/plain' }, body: '{}' }, env);
    expect(r.status).toBe(415);
  });
  it('認証未設定は接続待ちへ遷移', async () => { expect((await request('/auth/google')).headers.get('location')).toBe('/?auth_error=setup'); });
  it('OAuthのstate不一致で認証しない', async () => { expect((await request('/auth/callback?state=forged&code=test')).headers.get('location')).toBe('/?auth_error=cancelled'); });
  it('本人情報をキャッシュさせない', async () => { expect((await request('/api/me')).headers.get('cache-control')).toBe('no-store'); });
});
describe('D1の保存・同期', () => {
  const task = makeTask('APIテスト用メモ');
  it('保存と取得が成功する', async () => {
    const r = await request('/api/sync', { tasks: [task] }); expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ userId: 'user-a', tasks: [task] });
  });
  it('他の利用者から取得できない', async () => {
    const data = await (await request('/api/sync', { tasks: [] }, fakeTokenB, host, { ALLOWED_GOOGLE_EMAIL: 'b@example.com' })).json(); expect(data).toEqual({ userId: 'user-b', tasks: [] });
  });
  it('他利用者が同じIDを書いても元のデータは変更されない', async () => {
    await request('/api/sync', { tasks: [{ ...task, text: '別ユーザーのデータ' }] }, fakeTokenB, host, { ALLOWED_GOOGLE_EMAIL: 'b@example.com' });
    const data = await (await request('/api/sync', { tasks: [] })).json() as { tasks: { text: string }[] };
    expect(data.tasks[0].text).toBe(task.text);
  });
  it('新しい更新だけを反映する', async () => {
    const next = { ...task, text: '更新後', status: 'doing', updatedAt: task.updatedAt + 100 };
    await request('/api/sync', { tasks: [next] });
    const r = await request('/api/sync', { tasks: [task] });
    expect(await r.json()).toMatchObject({ tasks: [{ text: '更新後', status: 'doing' }] });
  });
  it('削除も同期し、復元できる', async () => {
    const r = await request('/api/sync', { tasks: [{ ...task, deleted: true, updatedAt: task.updatedAt + 200 }] });
    expect(await r.json()).toMatchObject({ tasks: [{ deleted: true }] });
    const restored = await request('/api/sync', { tasks: [{ ...task, deleted: false, updatedAt: task.updatedAt + 300 }] });
    expect(await restored.json()).toMatchObject({ tasks: [{ deleted: false }] });
  });
  it('不正なステータスを拒否', async () => { expect((await request('/api/sync', { tasks: [{ ...task, status: 'bad' }] })).status).toBe(400); });
  it('空のメモを拒否', async () => { expect((await request('/api/sync', { tasks: [{ ...task, text: ' ' }] })).status).toBe(400); });
  it('大量リクエストを拒否', async () => { expect((await request('/api/sync', { tasks: Array(101).fill(task) })).status).toBe(400); });
  it('未来の端末時計を拒否', async () => { expect((await request('/api/sync', { tasks: [{ ...task, updatedAt: Date.now() + 3600000 }] })).status).toBe(400); });
});
describe('Workers AIの接続と制限', () => {
  const body = { text: '報告書を作ってメールを送る', today: '2026-11-06' };
  it('未接続は未接続として応答する', async () => { expect((await request('/api/ai', body)).status).toBe(503); });
  it('未ログインは実行できない', async () => { expect((await request('/api/ai', body, 'invalid')).status).toBe(401); });
  it('AI応答を検証して候補だけを返す（AI呼出はスタブ）', async () => {
    env.AI = { run: async () => ({ response: JSON.stringify({ tasks: [{ text: '報告書を作る', category: 'work', due: null }] }) }) } as unknown as Ai;
    const r = await request('/api/ai', body); expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ tasks: [{ text: '報告書を作る', category: 'work', due: null }] });
    const rows = await database.prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id=?').bind('user-a').first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });
  it('AIの不正応答を保存しない', async () => {
    env.AI = { run: async () => ({ response: 'not-json' }) } as unknown as Ai;
    expect((await request('/api/ai', body)).status).toBe(502);
  });
  it('1日30回の上限を適用する', async () => {
    await database.prepare('UPDATE ai_usage SET count=30 WHERE user_id=?').bind('user-a').run();
    expect((await request('/api/ai', body)).status).toBe(429);
  });
});
