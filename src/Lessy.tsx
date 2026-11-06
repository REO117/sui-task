import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import './lessy.css';

type Pose = 'idle' | 'wave' | 'think' | 'groom' | 'salute' | 'victory';
const sheets = {
  base: '/lessy-sprites-v2.png',
  gestures: '/lessy-gestures-v1.png',
  salute: '/lessy-salute-v3.png'
};
const poses = {
  idle: { sheet: 'base', row: 0, speed: 480, frames: [0, 0, 1, 2, 2, 1, 0, 3], still: 0 },
  wave: { sheet: 'gestures', row: 0, speed: 280, frames: [0, 1, 2, 3], still: 0 },
  think: { sheet: 'gestures', row: 1, speed: 450, frames: [0, 1, 2, 3, 2, 1], still: 2 },
  groom: { sheet: 'gestures', row: 2, speed: 420, frames: [3, 2, 2, 3], still: 2 },
  salute: { sheet: 'salute', row: 0, speed: 300, frames: [0, 1, 2, 3], still: 2 },
  victory: { sheet: 'base', row: 3, speed: 240, frames: [0, 1, 2, 3], still: 0 }
} as const;

export function readCompanionPreference() {
  try { return localStorage.getItem('sui:lessy') !== 'off'; } catch { return true; }
}
export function saveCompanionPreference(enabled: boolean) {
  try { localStorage.setItem('sui:lessy', enabled ? 'on' : 'off'); } catch { /* Display preference only. */ }
}

export default function Lessy({ enabled, busy, completion, typing, obscured }: {
  enabled: boolean; busy: boolean; completion: number; typing: boolean; obscured: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 640px)').matches);
  const [ambient, setAmbient] = useState<Pose>('idle');
  const [reaction, setReaction] = useState<Pose | null>(null);
  const [frame, setFrame] = useState(0);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previousCompletion = useRef(completion);
  const reduce = useReducedMotion();
  const active = enabled && ready && visible && !obscured && !(mobile && typing);
  const pose: Pose = busy ? 'think' : reaction || ambient;

  useEffect(() => {
    const media = matchMedia('(max-width: 640px)');
    const resize = () => setMobile(media.matches);
    const visibility = () => setVisible(document.visibilityState === 'visible');
    media.addEventListener('change', resize);
    document.addEventListener('visibilitychange', visibility);
    return () => { media.removeEventListener('change', resize); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  // Load existing artwork after the memo UI, without delaying capture or its skeleton.
  useEffect(() => {
    if (!enabled || ready) return;
    let live = true;
    const images: HTMLImageElement[] = [];
    const delay = setTimeout(() => {
      void Promise.all(Object.values(sheets).map(src => new Promise<void>((resolve, reject) => {
        const image = new Image(); images.push(image);
        image.onload = () => resolve(); image.onerror = () => reject(); image.src = src;
      }))).then(() => { if (live) setReady(true); }).catch(() => {});
    }, 700);
    return () => { live = false; clearTimeout(delay); images.forEach(image => { image.onload = null; image.onerror = null; }); };
  }, [enabled, ready]);

  function react(next: Pose, duration: number) {
    clearTimeout(reactionTimer.current);
    setReaction(next);
    reactionTimer.current = setTimeout(() => setReaction(null), duration);
  }
  useEffect(() => {
    if (completion > previousCompletion.current && enabled) react('victory', 2600);
    previousCompletion.current = completion;
  }, [completion, enabled]);
  useEffect(() => () => clearTimeout(reactionTimer.current), []);

  useEffect(() => {
    setAmbient('idle');
    if (!active || reduce || busy || reaction) return;
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timeout = setTimeout(() => {
        const choices: Pose[] = ['wave', 'groom', 'think'];
        setAmbient(choices[Math.floor(Math.random() * choices.length)]!);
        timeout = setTimeout(() => { setAmbient('idle'); schedule(); }, 2100);
      }, 6500 + Math.random() * 4500);
    };
    schedule();
    return () => clearTimeout(timeout);
  }, [active, reduce, busy, reaction]);

  useEffect(() => {
    const motion = poses[pose];
    setFrame(reduce ? motion.still : 0);
    if (!active || reduce) return;
    const started = performance.now();
    const timer = setInterval(() => {
      const time = performance.now() - started;
      if (pose === 'salute') setFrame(time < 400 ? 0 : time < 700 ? 1 : time < 2400 ? 2 : time < 2700 ? 1 : 3);
      else setFrame(motion.frames[Math.floor(time / motion.speed) % motion.frames.length]!);
    }, 120);
    return () => clearInterval(timer);
  }, [active, reduce, pose]);

  const motion = poses[pose];
  const position = pose === 'salute'
    ? `${frame % 2 * 100}% ${Math.floor(frame / 2) * 100}%`
    : `${frame / 3 * 100}% ${motion.row / 3 * 100}%`;
  return <div className={`lessy-companion ${!enabled ? 'is-disabled' : ''} ${!active ? 'is-hidden' : ''}`} data-testid="lessy-companion" data-pose={pose} data-frame={frame}>
    <button type="button" className="lessy-button" aria-label="レッシィに声をかける" title="レッシィ" disabled={!active}
      onClick={() => { if (!busy) react('salute', 3000); }}>
      <span className="lessy-sprite" aria-hidden="true" style={{ backgroundImage: ready ? `url("${sheets[motion.sheet]}")` : undefined,
        backgroundSize: pose === 'salute' ? '200% 200%' : '400% 400%', backgroundPosition: position }}/>
    </button>
  </div>;
}
