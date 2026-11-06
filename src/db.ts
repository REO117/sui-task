import Dexie, { type EntityTable } from 'dexie';
import { type LocalTask, type Task, plainTask } from './model';
export const db = new Dexie('sui-v1') as Dexie & {
  tasks: EntityTable<LocalTask, 'id'>;
  outbox: EntityTable<{ id: string; workspace: string; task: Task }, 'id'>;
  drafts: EntityTable<{ id: string; text: string }, 'id'>;
};
db.version(1).stores({ tasks: 'id,workspace,status,updatedAt', outbox: 'id,workspace', drafts: 'id' });
export async function saveTask(workspace: string, task: Task) {
  await db.transaction('rw', db.tasks, db.outbox, async () => {
    await db.tasks.put({ ...task, workspace });
    if (workspace !== 'local') await db.outbox.put({ id: task.id, workspace, task });
  });
}
export async function migrateLocal(workspace: string) {
  await db.transaction('rw', db.tasks, db.outbox, db.drafts, async () => {
    const local = await db.tasks.where('workspace').equals('local').toArray();
    for (const t of local) {
      const task = plainTask(t);
      await db.tasks.put({ ...task, workspace });
      await db.outbox.put({ id: task.id, workspace, task });
    }
    const localDraft = await db.drafts.get('local');
    if (localDraft?.text) {
      const signedDraft = await db.drafts.get(workspace);
      await db.drafts.put({ id: workspace, text: [signedDraft?.text, localDraft.text].filter(Boolean).join('\n') });
      await db.drafts.delete('local');
    }
  });
}
let syncing = false;
export async function syncTasks(workspace: string) {
  if (workspace === 'local' || syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const pending = await db.outbox.where('workspace').equals(workspace).toArray();
    // Bounded requests; repeat remaining changes on the next cycle.
    const sent = pending.slice(0, 100);
    const response = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: sent.map(x => x.task) }) });
    if (!response.ok) throw new Error(response.status === 401 ? 'ログインし直してください' : '同期できませんでした');
    const result = await response.json() as { userId: string; tasks: Task[] };
    if (`user:${result.userId}` !== workspace) throw new Error('アカウントが変更されています');
    await db.transaction('rw', db.tasks, db.outbox, async () => {
      for (const entry of sent) {
        const current = await db.outbox.get(entry.id);
        if (current?.task.updatedAt === entry.task.updatedAt) await db.outbox.delete(entry.id);
      }
      for (const task of result.tasks) {
        const stillPending = await db.outbox.get(task.id);
        if (!stillPending) await db.tasks.put({ ...task, workspace });
      }
    });
  } finally { syncing = false; }
}
