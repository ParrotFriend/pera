import { Cloud, CloudOff, RefreshCw, CircleCheck, TriangleAlert, HardDrive } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../services/app.jsx';

export function useSyncLabel() {
  const { online, sync, user } = useApp();
  if (user?.local) return { tone: 'muted', icon: HardDrive, text: 'Saved on this device' };
  if (user?.offlineOnly) return { tone: 'warn', icon: CloudOff, text: online ? 'Sign in to sync' : 'Offline mode' };
  if (!online) return { tone: 'warn', icon: CloudOff, text: sync.pending ? `Offline · ${sync.pending} waiting to sync` : 'Offline mode' };
  if (sync.conflicts) return { tone: 'loss', icon: TriangleAlert, text: `${sync.conflicts} change${sync.conflicts > 1 ? 's' : ''} need review` };
  if (sync.status === 'syncing') return { tone: 'info', icon: RefreshCw, text: 'Syncing…', spin: true };
  if (sync.status === 'error' || sync.lastError) return { tone: 'warn', icon: TriangleAlert, text: 'Sync pending' };
  if (sync.pending) return { tone: 'info', icon: Cloud, text: `${sync.pending} waiting to sync` };
  return { tone: 'gain', icon: CircleCheck, text: 'All data synced' };
}

export default function SyncBadge({ compact = false }) {
  const s = useSyncLabel();
  const color = { muted: 'text-ink-400 dark:text-slate-400', warn: 'text-warn', loss: 'text-loss', info: 'text-info', gain: 'text-gain dark:text-gain-dark' }[s.tone];
  const I = s.icon;
  return (
    <Link to="/sync" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-8 text-[12.5px] font-medium hover:bg-ink-50 dark:hover:bg-night-line ${color}`} aria-live="polite">
      <I size={15} className={s.spin ? 'animate-spin' : ''} aria-hidden />
      <span className={compact ? 'sr-only sm:not-sr-only' : ''}>{s.text}</span>
    </Link>
  );
}
