export type User = { id: string; name: string; email: string };
const key = 'sui:last-user';
// Display metadata only. This cache never authorizes API requests or contains tokens.
export function readCachedUser(): User | null {
  try {
    const user = JSON.parse(localStorage.getItem(key) || 'null');
    return user && typeof user.id === 'string' && user.id && typeof user.name === 'string' && typeof user.email === 'string'
      ? { id: user.id, name: user.name, email: user.email } : null;
  } catch { return null; }
}
export function cacheUser(user: User | null) {
  try {
    if (user) localStorage.setItem(key, JSON.stringify({ id: user.id, name: user.name, email: user.email }));
    else localStorage.removeItem(key);
  } catch { /* Capture remains available when browser storage policy rejects metadata. */ }
}
