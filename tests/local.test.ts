import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, migrateLocal, saveTask, syncTasks } from '../src/db';
import { advance, makeTask, taskSchema } from '../src/model';
beforeEach(async () => { vi.stubGlobal('navigator', { onLine: true }); await db.tasks.clear(); await db.outbox.clear(); await db.drafts.clear(); });
afterEach(() => vi.unstubAllGlobals());
describe('メモ・フリック・端末保存', () => {
  it('ステータスの端で止まり、削除されない', () => { expect(advance('inbox', -1)).toBe('inbox'); expect(advance('done', 1)).toBe('done'); expect(advance('todo', 1)).toBe('doing'); });
  it('5000字を超えるメモは保存しない', () => { expect(taskSchema.safeParse({ ...makeTask('test'), text: 'a'.repeat(5001) }).success).toBe(false); });
  it('未ログインは端末のみに保存する', async () => { const task = makeTask('ローカル'); await saveTask('local', task); expect((await db.tasks.get(task.id))?.text).toBe('ローカル'); expect(await db.outbox.count()).toBe(0); });
  it('ログイン済みの保存は同期待ちにも残す', async () => { const task = makeTask('同期'); await saveTask('user:a', task); expect(await db.outbox.get(task.id)).toMatchObject({ workspace: 'user:a', task }); });
  it('ログイン時に端末のメモ・下書きを移す', async () => {
    const task = makeTask('端末メモ'); await saveTask('local', task); await db.drafts.put({ id: 'local', text: '下書き' });
    await migrateLocal('user:a'); expect((await db.tasks.get(task.id))?.workspace).toBe('user:a');
    expect(await db.outbox.get(task.id)).toBeDefined(); expect(await db.drafts.get('local')).toBeUndefined(); expect(await db.drafts.get('user:a')).toMatchObject({ text: '下書き' });
  });
  it('通信失敗でも同期待ちを失わない', async () => {
    const task = makeTask('通信失敗'); await saveTask('user:a', task); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(syncTasks('user:a')).rejects.toThrow(); expect(await db.outbox.get(task.id)).toBeDefined();
  });
  it('同期成功でのみ送信待ちを取り除く', async () => {
    const task = makeTask('同期成功'); await saveTask('user:a', task);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ userId: 'a', tasks: [task] })));
    await syncTasks('user:a'); expect(await db.outbox.count()).toBe(0); expect(await db.tasks.get(task.id)).toMatchObject(task);
  });
  it('同期中に編集された内容は上書きしない', async () => {
    const task = makeTask('送信前'); await saveTask('user:a', task);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      await saveTask('user:a', { ...task, text: '送信中の編集', updatedAt: task.updatedAt + 1 });
      return Response.json({ userId: 'a', tasks: [task] });
    }));
    await syncTasks('user:a'); expect((await db.tasks.get(task.id))?.text).toBe('送信中の編集'); expect(await db.outbox.count()).toBe(1);
  });
  it('アカウントが違う応答は取り込まない', async () => {
    const task = makeTask('アカウントA'); await saveTask('user:a', task);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ userId: 'b', tasks: [] })));
    await expect(syncTasks('user:a')).rejects.toThrow('アカウント'); expect(await db.outbox.count()).toBe(1);
  });
});
