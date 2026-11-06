import { z } from 'zod';
export const statuses = ['inbox', 'todo', 'doing', 'done'] as const;
export type Status = typeof statuses[number];
export const labels: Record<Status, string> = { inbox: 'メモ', todo: '未着手', doing: '進行中', done: '完了' };
export const taskSchema = z.object({
  id: z.string().uuid(), text: z.string().trim().min(1).max(5000),
  status: z.enum(statuses), category: z.enum(['none', 'work', 'personal']),
  pinned: z.boolean(), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  createdAt: z.number().int().positive(), updatedAt: z.number().int().positive(), deleted: z.boolean()
});
export type Task = z.infer<typeof taskSchema>;
export type LocalTask = Task & { workspace: string };
export function advance(status: Status, direction: number): Status {
  return statuses[Math.max(0, Math.min(3, statuses.indexOf(status) + direction))];
}
export function makeTask(text: string, extra: Partial<Task> = {}): Task {
  const now = Date.now();
  return taskSchema.parse({ id: crypto.randomUUID(), text, status: 'inbox', category: 'none', pinned: false,
    due: null, createdAt: now, updatedAt: now, deleted: false, ...extra });
}
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function plainTask({ workspace: _, ...task }: LocalTask): Task { return task; }
