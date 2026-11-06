import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCheck, ChevronDown, Circle, Cloud, CloudOff, Download, Droplets, FileText, Flag, Inbox, LayoutGrid, LoaderCircle, LogOut, MoreHorizontal, Pin, Plus, RotateCcw, Search, Settings2, Sparkles, Trash2, X, CalendarDays, CheckCircle2, SlidersHorizontal, WifiOff } from 'lucide-react';
import { db, migrateLocal, saveTask, syncTasks } from './db';
import { readCachedUser, cacheUser, type User } from './identity';
import Lessy, { readCompanionPreference, saveCompanionPreference } from './Lessy';
import { advance, dateKey, labels, makeTask, statuses, type Status, type Task, type LocalTask, plainTask } from './model';
import './style.css';

type View = 'all' | Status | 'today' | 'trash';
type Suggestion = { text: string; category: Task['category']; due: string | null };
type Toast = { message: string; undo?: () => void };
const icons = { inbox: FileText, todo: Circle, doing: LoaderCircle, done: CheckCheck };
const categories = { none: 'カテゴリなし', work: '仕事', personal: 'プライベート' };
const easing = { type: 'spring' as const, stiffness: 380, damping: 32 };

function Modal({ title, children, close }: { title: string; children: React.ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current!; d.showModal(); return () => d.close(); }, []);
  return <dialog ref={ref} className="modal" onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }} aria-label={title}>
    <motion.div className="modal-inner glass" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={easing}>
      <div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="閉じる"><X size={20}/></button></div>{children}
    </motion.div>
  </dialog>;
}

function TaskCard({ task, change, edit, trash }: { task: Task; change: (patch: Partial<Task>, undo?: boolean) => void; edit: () => void; trash: boolean }) {
  const x = useMotionValue(0);
  const leftOpacity = useTransform(x, [0, 75], [0, 1]);
  const rightOpacity = useTransform(x, [-75, 0], [1, 0]);
  const reduced = useReducedMotion();
  const [dragging, setDragging] = useState(false);
  const StatusIcon = icons[task.status];
  const prev = advance(task.status, -1), next = advance(task.status, 1);
  const due = task.due && new Date(`${task.due}T12:00:00`);
  const dueLabel = task.due === dateKey() ? '今日' : due ? `${due.getMonth() + 1}/${due.getDate()}` : '';
  return <motion.div layout={!reduced} className="card-wrap" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .95, height: 0, marginBottom: 0 }} transition={easing}>
    {!trash && <><motion.div className={`swipe-under swipe-next status-${next}`} style={{ opacity: leftOpacity }}><ArrowRight size={20}/>{labels[next]}</motion.div>
      <motion.div className={`swipe-under swipe-prev status-${prev}`} style={{ opacity: rightOpacity }}>{labels[prev]}<ArrowLeft size={20}/></motion.div></>}
    <motion.article className={`task-card glass ${task.status === 'done' ? 'is-done' : ''}`} data-task-id={task.id}
      drag={trash ? false : 'x'} dragConstraints={{ left: 0, right: 0 }} dragElastic={.65} dragSnapToOrigin
      style={{ x, touchAction: 'pan-y' }} onDragStart={() => setDragging(true)}
      onDragEnd={(_, info) => {
        setTimeout(() => setDragging(false), 80);
        if (Math.abs(info.offset.x) > 72 || (Math.abs(info.velocity.x) > 550 && Math.abs(info.offset.x) > 22)) {
          const status = advance(task.status, info.offset.x > 0 ? 1 : -1);
          if (status !== task.status) { change({ status }, true); navigator.vibrate?.(10); }
        }
      }}
      tabIndex={0} aria-label={`${labels[task.status]}: ${task.text}`} aria-description="左右の矢印キーでステータス変更"
      onKeyDown={e => { if (e.target === e.currentTarget && ['ArrowRight', 'ArrowLeft'].includes(e.key) && !trash) { e.preventDefault(); change({ status: advance(task.status, e.key === 'ArrowRight' ? 1 : -1) }, true); } }}>
      <button className={`task-check status-${task.status}`} aria-label={task.status === 'done' ? '未着手に戻す' : '完了にする'} disabled={trash}
        onClick={() => { if (!dragging) change({ status: task.status === 'done' ? 'todo' : 'done' }, true); }}>
        {task.status === 'done' ? <Check size={17}/> : task.status === 'doing' ? <span className="half-circle"/> : task.status === 'inbox' ? <FileText size={16}/> : <span/>}
      </button>
      <button className="task-content" onClick={() => { if (!dragging) edit(); }} aria-label={`編集: ${task.text}`}>
        <span className="task-text">{task.text}</span>
        <span className="task-meta"><span className={`status-label status-${task.status}`}><StatusIcon size={12}/>{labels[task.status]}</span>
          {task.category !== 'none' && <span className={`category category-${task.category}`}><i/>{categories[task.category]}</span>}
          {dueLabel && <span className={task.due! < dateKey() && task.status !== 'done' ? 'overdue' : ''}><CalendarDays size={12}/>{dueLabel}</span>}
        </span>
      </button>
      {task.pinned && <Pin size={14} className="pin-indicator"/>}
      <button className="icon-button task-more" onClick={edit} aria-label={`詳細: ${task.text}`}><MoreHorizontal size={19}/></button>
    </motion.article>
  </motion.div>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(readCachedUser);
  const [workspace, setWorkspace] = useState(() => user ? `user:${user.id}` : 'local');
  const [sessionVerified, setSessionVerified] = useState(false);
  const [config, setConfig] = useState<{ google: boolean; ai: boolean } | null>(null);
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Task['category'] | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftStatus, setDraftStatus] = useState<Status>('inbox');
  const [saving, setSaving] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState('');
  const [syncState, setSyncState] = useState<'local' | 'syncing' | 'synced' | 'error'>('local');
  const [online, setOnline] = useState(navigator.onLine);
  const [aiBusy, setAiBusy] = useState(false);
  const [lessyEnabled, setLessyEnabled] = useState(readCompanionPreference);
  const [completion, setCompletion] = useState(0);
  const [typing, setTyping] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [aiSelection, setAiSelection] = useState<Set<number>>(new Set());
  const [aiSource, setAiSource] = useState('');
  const [installPrompt, setInstallPrompt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const serviceWorker = useRef<ServiceWorkerRegistration | null>(null);
  const { needRefresh: [updateAvailable], updateServiceWorker } = useRegisterSW({
    onRegisteredSW: (_, registration) => { serviceWorker.current = registration || null; }
  });
  const touched = useRef(false);
  const draftWrites = useRef(Promise.resolve());
  const workspaceRef = useRef(workspace);
  const verifiedSession = useRef(false);
  const identityEpoch = useRef(0);
  const loggingOut = useRef(false);
  const refreshIdentity = useRef<() => Promise<void>>(async () => {});
  const all = useLiveQuery(() => db.tasks.where('workspace').equals(workspace).toArray(), [workspace]);
  const pendingCount = useLiveQuery(() => db.outbox.where('workspace').equals(workspace).count(), [workspace]) || 0;
  const reduced = useReducedMotion();
  const active = (all || []).filter(t => !t.deleted);
  const counts = { all: active.filter(t => t.status !== 'done').length, inbox: active.filter(t => t.status === 'inbox').length,
    todo: active.filter(t => t.status === 'todo').length, doing: active.filter(t => t.status === 'doing').length,
    done: active.filter(t => t.status === 'done').length,
    today: active.filter(t => t.due && t.due <= dateKey() && t.status !== 'done').length,
    trash: (all || []).filter(t => t.deleted).length };
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  const progress = active.length ? Math.round(counts.done / active.length * 100) : 0;
  const notify = useCallback((message: string, undo?: () => void) => setToast({ message, undo }), []);
  const report = (e: unknown) => setError(e instanceof Error ? e.message : '保存できませんでした');

  const runSync = useCallback(async () => {
    const w = workspaceRef.current;
    if (w === 'local' || !navigator.onLine) return;
    if (!verifiedSession.current) { await refreshIdentity.current(); return; }
    setSyncState('syncing');
    try { await syncTasks(w); setSyncState(navigator.onLine ? 'synced' : 'local'); }
    catch { setSyncState('error'); }
  }, []);

  useEffect(() => {
    let live = true;
    let identifying = false;
    db.drafts.get(workspaceRef.current).then(d => { if (live && !touched.current && d) setDraft(d.text); }).catch(report);
    fetch('/api/config').then(r => r.ok ? r.json() as Promise<{ google: boolean; ai: boolean }> : null).then(c => { if (live) setConfig(c); }).catch(() => {});
    async function identify() {
      if (!live || identifying || loggingOut.current || !navigator.onLine) return;
      identifying = true;
      const epoch = identityEpoch.current;
      try {
        const response = await fetch('/api/me');
        if (!response.ok) throw new Error('本人確認に接続できませんでした');
        const result = await response.json() as { user: User | null };
        if (!live || epoch !== identityEpoch.current) return;
        if (result.user) {
          const w = `user:${result.user.id}`;
          if (workspaceRef.current !== w) {
            await draftWrites.current;
            await migrateLocal(w);
            if (!live || epoch !== identityEpoch.current) return;
            workspaceRef.current = w; setWorkspace(w);
            const d = await db.drafts.get(w);
            if (live) setDraft(d?.text || '');
          }
          cacheUser(result.user); setUser(result.user);
          verifiedSession.current = true; setSessionVerified(true);
          await runSync();
        } else {
          verifiedSession.current = false; setSessionVerified(false); cacheUser(null); setUser(null);
          if (workspaceRef.current !== 'local') {
            await draftWrites.current;
            workspaceRef.current = 'local'; setWorkspace('local');
            const d = await db.drafts.get('local');
            if (live) setDraft(d?.text || '');
          }
          setSyncState('local');
        }
      } catch { if (live) setSyncState('error'); }
      finally { identifying = false; }
    }
    refreshIdentity.current = identify;
    void identify();
    const params = new URLSearchParams(location.search);
    if (params.has('auth_error')) {
      const code = params.get('auth_error');
      setError(code === 'setup' ? 'Googleログインは接続設定待ちです。メモはこの端末に保存できます' : code === 'forbidden' ? 'このGoogleアカウントは許可されていません' : 'Googleログインを完了できませんでした。もう一度試してください');
      history.replaceState(null, '', location.pathname);
    }
    const onConnection = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) { verifiedSession.current = false; setSessionVerified(false); void identify(); }
      else setSyncState('local');
    };
    const onFocus = () => { void identify(); void serviceWorker.current?.update().catch(() => {}); };
    const onInstall = (e: Event) => { e.preventDefault(); setInstallPrompt(e as Event & { prompt: () => Promise<void> }); };
    const keys = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('dialog')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); search.current?.focus(); }
      if (e.key === 'n' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('online', onConnection); window.addEventListener('offline', onConnection);
    window.addEventListener('focus', onFocus); window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('keydown', keys);
    const timer = setInterval(() => void runSync(), 15000);
    return () => { live = false; refreshIdentity.current = async () => {}; clearInterval(timer); window.removeEventListener('online', onConnection); window.removeEventListener('offline', onConnection);
      window.removeEventListener('focus', onFocus); window.removeEventListener('beforeinstallprompt', onInstall); window.removeEventListener('keydown', keys); };
  }, [runSync]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 6000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (input.current) { input.current.style.height = 'auto'; input.current.style.height = `${Math.min(260, input.current.scrollHeight)}px`; } }, [draft]);
  useEffect(() => { if (pendingCount) void runSync(); }, [pendingCount, runSync]);

  function writeDraft(value: string) {
    touched.current = true; setDraft(value);
    const w = workspaceRef.current;
    draftWrites.current = draftWrites.current.catch(() => {}).then(async () => { await db.drafts.put({ id: w, text: value }); }).catch(report);
  }
  async function capture() {
    if (!draft.trim() || saving) return;
    setSaving(true);
    const text = draft.trim();
    try {
      await saveTask(workspaceRef.current, makeTask(text, { status: draftStatus }));
      // Keep anything typed while the IndexedDB transaction was pending.
      setDraft(current => { if (current.trim() === text) { draftWrites.current = draftWrites.current.catch(() => {}).then(async () => { await db.drafts.put({ id: workspaceRef.current, text: '' }); }); return ''; } return current; });
      notify(draftStatus === 'inbox' ? 'メモを保存しました' : 'タスクを追加しました');
      input.current?.focus(); void runSync();
    } catch (e) { report(e); } finally { setSaving(false); }
  }
  async function update(task: Task, patch: Partial<Task>, undo = false) {
    try {
      const next = { ...task, ...patch, updatedAt: Math.max(Date.now(), task.updatedAt + 1) };
      await saveTask(workspaceRef.current, next); void runSync();
      if (task.status !== 'done' && next.status === 'done' && !task.deleted && !next.deleted) setCompletion(value => value + 1);
      if (undo) notify(patch.deleted !== undefined ? patch.deleted ? 'ゴミ箱に移動しました' : '復元しました' : `${labels[next.status]}に変更しました`, () => { void update(next, { ...task, updatedAt: Date.now() }); });
      return true;
    } catch (e) { report(e); return false; }
  }
  async function organize() {
    if (!draft.trim() || aiBusy || suggestions) return;
    if (!online) { notify('AIでの整理はオンラインで使えます'); return; }
    if (!user || !sessionVerified) { setSettings(true); return; }
    setError(''); setAiBusy(true); setAiSource(draft);
    try {
      const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: draft, today: dateKey() }) });
      const data = await response.json() as { error?: string; tasks: Suggestion[] };
      if (!response.ok) throw new Error(data.error || 'AIに接続できませんでした');
      setSuggestions(data.tasks); setAiSelection(new Set(data.tasks.map((_, i) => i)));
    } catch (e) { report(e); } finally { setAiBusy(false); }
  }
  async function applySuggestions() {
    if (!suggestions || !aiSelection.size || saving) return;
    setSaving(true);
    try {
      await db.transaction('rw', db.tasks, db.outbox, async () => {
        for (const [i, item] of suggestions.entries()) if (aiSelection.has(i)) await saveTask(workspaceRef.current, makeTask(item.text, { status: 'todo', category: item.category, due: item.due }));
      });
      setSuggestions(null); setView('todo'); notify(`${aiSelection.size}件のタスクを追加しました`); void runSync();
    } catch (e) { report(e); } finally { setSaving(false); }
  }
  async function logout() {
    loggingOut.current = true; identityEpoch.current += 1;
    try {
      const response = await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('ログアウトできませんでした');
      await draftWrites.current;
      cacheUser(null); verifiedSession.current = false; setSessionVerified(false);
      setUser(null); workspaceRef.current = 'local'; setWorkspace('local'); setDraft(''); touched.current = false;
      setSyncState('local'); setSettings(false); notify('ログアウトしました');
    } catch (e) { report(e); } finally { loggingOut.current = false; }
  }
  function login() {
    if (config && !config.google) { setError('Googleログインは接続設定待ちです。メモはこの端末に保存できます'); return; }
    void draftWrites.current.finally(() => { location.href = '/auth/google'; });
  }
  async function applyUpdate() {
    if (editTask || saving || aiBusy) { notify('編集中の内容を保存してから更新してください'); return; }
    await draftWrites.current;
    await updateServiceWorker(true);
  }
  function exportData() {
    const blob = new Blob([JSON.stringify({ version: 1, tasks: (all || []).map(plainTask) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `sui-${dateKey()}.json`; a.click(); URL.revokeObjectURL(url);
  }
  const filtered = (all || []).filter(t => {
    if (view === 'trash' ? !t.deleted : t.deleted) return false;
    if (view === 'all' && t.status === 'done') return false;
    if (statuses.includes(view as Status) && t.status !== view) return false;
    if (view === 'today' && (!t.due || t.due > dateKey() || t.status === 'done')) return false;
    if (category !== 'all' && t.category !== category) return false;
    return t.text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
  const mainTitle = view === 'trash' ? 'ゴミ箱' : view === 'today' ? '今日のタスク' : view === 'all' ? 'すべて' : labels[view];
  const nav = [{ id: 'all' as View, title: 'すべて', icon: LayoutGrid }, { id: 'today' as View, title: '今日', icon: CalendarDays },
    { id: 'inbox' as View, title: 'メモ', icon: FileText }, { id: 'todo' as View, title: '未着手', icon: Circle },
    { id: 'doing' as View, title: '進行中', icon: LoaderCircle }, { id: 'done' as View, title: '完了', icon: CheckCheck }];
  const pinned = filtered.filter(t => t.pinned), rest = filtered.filter(t => !t.pinned);
  const renderCard = (t: LocalTask) => <TaskCard key={t.id} task={t} change={(patch, undo) => void update(t, patch, undo)} edit={() => setEditTask(t)} trash={view === 'trash'}/>;

  return <div className="app-shell" onFocusCapture={e => setTyping(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)}
    onBlurCapture={e => setTyping(e.relatedTarget instanceof HTMLInputElement || e.relatedTarget instanceof HTMLTextAreaElement)}>
    <div className="ambient" aria-hidden="true"><div className="orb orb-one"/><div className="orb orb-two"/><div className="orb orb-three"/><div className="grain"/></div>
    <aside className="sidebar glass">
      <a className="brand" href="/" aria-label="Sui ホーム"><span className="brand-mark"><Droplets size={23}/></span><span>Sui<span className="brand-dot">.</span></span></a>
      <button className="new-note" onClick={() => input.current?.focus()}><Plus size={18}/><span>新しいメモ</span><kbd>N</kbd></button>
      <div className="nav-label">ワークスペース</div>
      <nav aria-label="メインナビゲーション">{nav.map(n => <button key={n.id} onClick={() => { setView(n.id); setQuery(''); }} className={`nav-item ${view === n.id ? 'selected' : ''}`} aria-current={view === n.id ? 'page' : undefined}>
        {view === n.id && <motion.span layoutId="sidebar-active" className="nav-active" transition={easing}/>}<n.icon size={18}/><span>{n.title}</span><span className="nav-count">{counts[n.id]}</span>
      </button>)}</nav>
      <div className="sidebar-bottom"><button className={`nav-item ${view === 'trash' ? 'selected' : ''}`} onClick={() => setView('trash')}><Trash2 size={17}/><span>ゴミ箱</span>{counts.trash > 0 && <span className="nav-count">{counts.trash}</span>}</button>
        <button className="nav-item" onClick={() => setSettings(true)}><Settings2 size={17}/><span>設定</span></button>
        <button className="profile-button" onClick={() => setSettings(true)}><span className="avatar">{user ? user.name.slice(0, 1) : <Cloud size={18}/>}</span><span><strong>{user ? user.name : 'Googleでログイン'}</strong><small>{user ? pendingCount ? `${pendingCount}件の同期待ち` : 'クラウド同期' : 'この端末に保存中'}</small></span><ChevronDown size={15}/></button>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumb"><span className="mobile-brand"><Droplets size={21}/>Sui.</span><span className="desktop-only">ワークスペース</span><span className="breadcrumb-slash">/</span><strong>{mainTitle}</strong></div>
        <div className="header-actions"><button className={`sync-indicator ${!online || syncState === 'error' ? 'muted' : ''}`} onClick={() => user ? void runSync() : setSettings(true)} aria-label="同期状態">
          {!online ? <WifiOff size={15}/> : syncState === 'syncing' ? <LoaderCircle size={15} className="spin"/> : user ? <Cloud size={15}/> : <CloudOff size={15}/>}
          <span>{!online ? 'オフライン' : !user ? '端末に保存' : !sessionVerified ? syncState === 'error' ? 'ログイン再確認' : 'ログイン確認中' : syncState === 'error' ? '再同期' : syncState === 'syncing' || pendingCount ? '同期中' : '同期済み'}</span></button>
          {updateAvailable && <button className="update-pill" onClick={() => void applyUpdate()} aria-label="新しいバージョンに更新"><RotateCcw size={13}/><span>更新</span></button>}
          <span className="top-divider"/><button className="avatar mobile-profile" onClick={() => setSettings(true)} aria-label="アカウント設定">{user ? user.name.slice(0, 1) : <Settings2 size={17}/>}</button>
        </div>
      </header>
      <main>
        <div className="page-heading"><div><p className="date-line">{dateLabel}</p><h1>メモとタスク<span className="heading-dot"/></h1></div><div className="heading-actions"><Lessy enabled={lessyEnabled} busy={aiBusy} completion={completion} typing={typing} obscured={!!(settings || help || editTask || suggestions)}/><button className="icon-button help-button glass" onClick={() => setHelp(true)} aria-label="操作方法"><ArrowRight size={18}/><ArrowLeft size={18}/></button></div></div>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="エラーを閉じる" onClick={() => setError('')}><X size={16}/></button></div>}
        <section className="capture-section glass" aria-label="すぐにメモ" data-testid="composer">
          <div className="capture-heading"><span className="capture-icon"><Plus size={17}/></span><span>新しいメモ</span><span className="draft-indicator">{draft.trim() ? '下書き' : ''}</span></div>
          <textarea ref={input} value={draft} onChange={e => writeDraft(e.target.value)} maxLength={5000} placeholder="メモを入力…" aria-label="メモを入力" rows={2}
            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void capture(); } }}/>
          <div className="capture-footer"><div className="capture-options"><select value={draftStatus} aria-label="保存先のステータス" onChange={e => setDraftStatus(e.target.value as Status)}>{statuses.filter(s => s !== 'done').map(s => <option key={s} value={s}>{labels[s]}</option>)}</select><span className="input-shortcut">Ctrl ↵</span></div>
            <div className="capture-buttons"><button className="ai-button" onClick={() => void organize()} disabled={!draft.trim() || aiBusy} aria-label="AIでタスクに整理">{aiBusy ? <LoaderCircle size={16} className="spin"/> : <Sparkles size={16}/>}<span>{aiBusy ? '整理中' : 'AIで整理'}</span></button>
              <motion.button className="save-button" disabled={!draft.trim() || saving} whileTap={{ scale: .93 }} onClick={() => void capture()} aria-label="メモを保存">{saving ? <LoaderCircle size={18} className="spin"/> : <ArrowUp size={20}/>}</motion.button></div>
          </div>
        </section>
        <div className="overview"><div className="overview-stats glass">
          {(['todo', 'doing', 'done'] as Status[]).map(s => { const Icon = icons[s]; return <button key={s} className={`stat stat-${s}`} onClick={() => setView(s)} aria-label={`${labels[s]} ${counts[s]}件`}><span className="stat-top"><span className={`stat-icon status-${s}`}><Icon size={16}/></span><span>{labels[s]}</span></span><span className="stat-number">{counts[s]}<small>件</small></span></button>; })}
        </div><div className="progress-card glass"><svg className="progress-ring" width="58" height="58" viewBox="0 0 58 58" aria-hidden="true"><circle cx="29" cy="29" r="24" fill="none" stroke="#e7edf1" strokeWidth="4"/><motion.circle cx="29" cy="29" r="24" fill="none" stroke="url(#progress-color)" strokeWidth="4" strokeLinecap="round" strokeDasharray="150.8" animate={{ strokeDashoffset: 150.8 * (1 - progress / 100) }} transition={{ duration: reduced ? 0 : .8 }} transform="rotate(-90 29 29)"/><defs><linearGradient id="progress-color"><stop stopColor="#8bd1ca"/><stop offset="1" stopColor="#65a5e7"/></linearGradient></defs><text x="29" y="33" textAnchor="middle">{progress}%</text></svg><div><strong>完了率</strong><small>{counts.done} / {active.length} 件</small></div></div></div>
        <section className="task-section" aria-label="タスク一覧">
          <div className="list-heading"><h2>{mainTitle}<span>{filtered.length}</span></h2><div className="list-tools"><label className="search"><Search size={16}/><input ref={search} value={query} onChange={e => setQuery(e.target.value)} placeholder="検索" aria-label="メモ・タスクを検索"/>{query && <button onClick={() => setQuery('')} aria-label="検索をクリア"><X size={14}/></button>}</label><button className={`icon-button filter-button ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)} aria-label="絞り込み" aria-expanded={showFilters}><SlidersHorizontal size={17}/></button></div></div>
          <div className="filter-row"><div className="segments" role="group" aria-label="ステータス絞り込み">{[{ id: 'all', label: 'すべて' }, ...statuses.map(id => ({ id, label: labels[id] }))].map(s => <button key={s.id} className={view === s.id ? 'active' : ''} aria-pressed={view === s.id} onClick={() => setView(s.id as View)}>{view === s.id && <motion.span className="segment-active" layoutId="segment-active" transition={easing}/>}<span>{s.label}</span></button>)}</div><button className="swipe-help" onClick={() => setHelp(true)}><ArrowLeft size={12}/><ArrowRight size={12}/>フリックで変更</button></div>
          <AnimatePresence>{showFilters && <motion.div className="category-filters" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>{(['all', 'none', 'work', 'personal'] as const).map(c => <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c === 'all' ? '全カテゴリ' : categories[c]}</button>)}</motion.div>}</AnimatePresence>
          <div className="task-list" aria-busy={!all}>
            {pinned.length > 0 && <><div className="group-label"><Pin size={12}/>ピン留め</div><AnimatePresence initial={false}>{pinned.map(renderCard)}</AnimatePresence></>}
            {pinned.length > 0 && rest.length > 0 && <div className="group-label group-rest">その他</div>}
            <AnimatePresence initial={false}>{rest.map(renderCard)}</AnimatePresence>
            {all && filtered.length === 0 && <motion.div className="empty-state" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}><span className="empty-icon">{view === 'done' ? <CheckCheck size={30}/> : query ? <Search size={29}/> : view === 'trash' ? <Trash2 size={29}/> : <Inbox size={30}/>}</span><p>{query || category !== 'all' ? '一致する項目はありません' : view === 'trash' ? 'ゴミ箱は空です' : view === 'done' ? '完了したタスクはありません' : 'まだ項目はありません'}</p>{view !== 'trash' && <button onClick={() => input.current?.focus()}><Plus size={15}/>メモを追加</button>}</motion.div>}
          </div>
        </section>
        <footer className="workspace-footer"><span className="footer-dot"/>{user ? 'Googleアカウントに同期' : 'この端末に保存'}<span className="footer-spacer"/>Sui <span className="footer-version">1.0</span></footer>
      </main>
    </div>
    <nav className="mobile-nav glass" aria-label="モバイルナビゲーション">{[{ id: 'all' as View, icon: LayoutGrid, title: 'すべて' }, { id: 'today' as View, icon: CalendarDays, title: '今日' }, { id: 'inbox' as View, icon: FileText, title: 'メモ' }, { id: 'done' as View, icon: CheckCheck, title: '完了' }].map(n => <button key={n.id} className={view === n.id ? 'active' : ''} onClick={() => { setView(n.id); setQuery(''); }} aria-current={view === n.id ? 'page' : undefined}>{view === n.id && <motion.span layoutId="mobile-active" className="mobile-active" transition={easing}/>}<n.icon size={21}/><span>{n.title}</span></button>)}</nav>
    <AnimatePresence>{!all && <motion.div className="full-skeleton" data-testid="full-skeleton" initial={{ opacity: 1 }} exit={{ opacity: 0 }} aria-label="読み込み中" role="status"><div className="skeleton-sidebar"/><div className="skeleton-body"><div className="skeleton-line skeleton-title"/><div className="skeleton-space"/><div className="skeleton-stats"/><div className="skeleton-line"/>{[0, 1, 2, 3].map(i => <div key={i} className="skeleton-card"/>)}</div></motion.div>}</AnimatePresence>
    <AnimatePresence>{toast && <motion.div className="toast glass" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}><CheckCircle2 size={18}/><span>{toast.message}</span>{toast.undo && <button onClick={() => { toast.undo?.(); setToast(null); }}>元に戻す</button>}<button className="toast-close" aria-label="通知を閉じる" onClick={() => setToast(null)}><X size={14}/></button></motion.div>}</AnimatePresence>
    {editTask && <Editor task={editTask} close={() => setEditTask(null)} save={async patch => { if (await update(editTask, patch)) setEditTask(null); }} remove={async () => { if (await update(editTask, { deleted: true }, true)) setEditTask(null); }} restore={async () => { if (await update(editTask, { deleted: false }, true)) setEditTask(null); }}/ >}
    {settings && <Modal title="設定" close={() => setSettings(false)}><div className="settings-account"><span className="settings-avatar">{user ? user.name.slice(0, 1) : <Cloud size={26}/>}</span><strong>{user ? user.name : 'アカウント'}</strong><p>{user ? user.email : 'Googleログインで端末間を同期'}</p></div>
      {user && sessionVerified ? <><div className="setting-row"><Cloud size={18}/><span>{!online ? 'オフライン・端末に保存中' : pendingCount ? `${pendingCount}件の同期待ち` : syncState === 'error' ? '同期できませんでした' : '同期済み'}</span><button onClick={() => void runSync()}>再同期</button></div><button className="setting-row" onClick={() => void logout()}><LogOut size={18}/><span>ログアウト</span></button></> : <button className="google-button" onClick={login} disabled={!online}><GoogleIcon/>Googleでログイン</button>}
      <div className="settings-divider"/><button className="setting-row" onClick={exportData}><Download size={18}/><span>データを書き出す</span><small>JSON</small></button>
      <label className="setting-row lessy-setting"><Droplets size={18}/><span>レッシィを表示</span><input type="checkbox" role="switch" checked={lessyEnabled} onChange={e => { setLessyEnabled(e.target.checked); saveCompanionPreference(e.target.checked); }}/></label>
      {updateAvailable && <button className="setting-row" onClick={() => void applyUpdate()}><RotateCcw size={18}/><span>新しいバージョンに更新</span></button>}
      <a className="setting-row" href="/privacy.html" target="_blank" rel="noopener noreferrer"><FileText size={18}/><span>プライバシー</span></a>
      {installPrompt && <button className="setting-row" onClick={() => { void installPrompt.prompt(); setInstallPrompt(null); }}><Plus size={18}/><span>ホーム画面に追加</span></button>}
      <button className="setting-row" onClick={() => { setSettings(false); setHelp(true); }}><ArrowRight size={18}/><span>操作方法</span></button><button className="setting-row" onClick={() => { setSettings(false); setView('trash'); }}><Trash2 size={18}/><span>ゴミ箱</span><small>{counts.trash}件</small></button>
      <p className="settings-footnote">未ログインのメモはこのブラウザに保存されます。ログイン時にGoogleアカウントの保存領域へ移ります。ブラウザのデータを削除すると、未同期のメモも消去されます。</p>
      <p className="settings-version">Sui 1.0</p></Modal>}
    {help && <Modal title="操作方法" close={() => setHelp(false)}><div className="help-gesture"><span><ArrowRight size={22}/><strong>右フリック</strong><small>次のステータスへ</small></span><span><ArrowLeft size={22}/><strong>左フリック</strong><small>前のステータスへ</small></span></div><div className="status-flow">メモ <ArrowRight size={12}/> 未着手 <ArrowRight size={12}/> 進行中 <ArrowRight size={12}/> 完了</div><div className="help-list"><p>本文をタップすると編集できます。</p><p>丸いボタンをタップすると完了になります。</p><p>変更直後の「元に戻す」で取り消せます。</p><p>AIで整理した候補は、選んで追加できます。元のメモは残ります。</p><p className="desktop-only">Ctrl + Enter：保存 / Ctrl + K：検索 / N：メモ入力<br/>カードを選択して左右キー：ステータス変更</p></div></Modal>}
    {suggestions && <Modal title="タスクに整理" close={() => setSuggestions(null)}><p className="ai-modal-note">追加するタスクを選択</p><div className="suggestions">{suggestions.map((s, i) => <label className={`suggestion ${aiSelection.has(i) ? 'selected' : ''}`} key={i}><input type="checkbox" checked={aiSelection.has(i)} onChange={e => setAiSelection(prev => { const next = new Set(prev); e.target.checked ? next.add(i) : next.delete(i); return next; })}/><span><strong>{s.text}</strong><small>{categories[s.category]}{s.due ? ` · ${s.due}` : ''}</small></span></label>)}</div><details className="source-note"><summary>元のメモ</summary><p>{aiSource}</p></details><button className="primary-button" disabled={!aiSelection.size || saving} onClick={() => void applySuggestions()}>{saving ? '保存中…' : `${aiSelection.size}件を追加`}</button></Modal>}
  </div>;
}

function Editor({ task, close, save, remove, restore }: { task: Task; close: () => void; save: (patch: Partial<Task>) => Promise<void>; remove: () => Promise<void>; restore: () => Promise<void> }) {
  const [text, setText] = useState(task.text);
  const [status, setStatus] = useState(task.status);
  const [due, setDue] = useState(task.due || '');
  const [category, setCategory] = useState(task.category);
  const [pinned, setPinned] = useState(task.pinned);
  const [busy, setBusy] = useState(false);
  return <Modal title={task.deleted ? 'ゴミ箱の項目' : '編集'} close={close}><form onSubmit={e => { e.preventDefault(); if (busy || !text.trim()) return; setBusy(true); void save({ text: text.trim(), status, due: due || null, category, pinned }).finally(() => setBusy(false)); }}>
    <textarea autoFocus className="editor-text" value={text} maxLength={5000} onChange={e => setText(e.target.value)} aria-label="内容" rows={5} required readOnly={task.deleted}/>
    {!task.deleted && <><div className="field-row"><label htmlFor="edit-status">ステータス</label><select id="edit-status" value={status} onChange={e => setStatus(e.target.value as Status)}>{statuses.map(s => <option value={s} key={s}>{labels[s]}</option>)}</select></div>
      <div className="field-row"><label htmlFor="edit-due">期限</label><input id="edit-due" type="date" value={due} onInput={e => setDue(e.currentTarget.value)} onChange={e => setDue(e.target.value)}/>{due && <button type="button" className="icon-button" aria-label="期限をクリア" onClick={() => setDue('')}><X size={14}/></button>}</div>
      <div className="field-row"><label htmlFor="edit-category">カテゴリ</label><select id="edit-category" value={category} onChange={e => setCategory(e.target.value as Task['category'])}>{Object.entries(categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
      <label className="field-row pin-field"><Pin size={16}/><span>ピン留め</span><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} role="switch"/></label></>}
    <div className="editor-actions">{task.deleted ? <button className="primary-button" type="button" disabled={busy} onClick={() => { setBusy(true); void restore().finally(() => setBusy(false)); }}><RotateCcw size={16}/>復元する</button> : <><button className="delete-button" type="button" disabled={busy} onClick={() => { setBusy(true); void remove().finally(() => setBusy(false)); }}><Trash2 size={17}/>ゴミ箱へ</button><button className="primary-button" type="submit" disabled={!text.trim() || busy}>{busy ? '保存中…' : '保存する'}</button></>}</div>
  </form></Modal>;
}
function GoogleIcon() { return <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4L15.4 17a6 6 0 0 1-9-3.1H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5L18.7 4A9.7 9.7 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6A6 6 0 0 1 12 6Z"/></svg>; }

