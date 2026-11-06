import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cacheUser, readCachedUser } from '../src/identity';
let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) || null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key)
  });
});
afterEach(() => vi.unstubAllGlobals());
it('オフライン起動用に最後の保存領域を復元できる', () => {
  const user = { id: 'a', name: 'Test', email: 'a@example.com' };
  cacheUser(user); expect(readCachedUser()).toEqual(user);
});
it('表示情報以外の認証情報をキャッシュしない', () => {
  cacheUser({ id: 'a', name: 'Test', email: 'a@example.com', token: 'must-not-persist' } as Parameters<typeof cacheUser>[0]);
  expect(Array.from(data.values()).join()).not.toContain('must-not-persist');
});
it('ログアウト時にオフライン用の本人情報を解除する', () => {
  cacheUser({ id: 'a', name: 'Test', email: 'a@example.com' }); cacheUser(null); expect(readCachedUser()).toBeNull();
});
it('壊れたキャッシュや保存権限がない場合もメモ画面を壊さない', () => {
  data.set('sui:last-user', 'invalid-json'); expect(readCachedUser()).toBeNull();
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  expect(readCachedUser()).toBeNull(); expect(() => cacheUser({ id: 'a', name: 'Test', email: 'a@example.com' })).not.toThrow();
});
