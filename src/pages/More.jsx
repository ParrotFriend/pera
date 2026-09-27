import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { NAV } from '../components/Layout.jsx';
import { PageHeader } from '../components/ui.jsx';
import InstallCard from '../components/InstallCard.jsx';
import { RefreshCw as SyncIcon } from 'lucide-react';

export default function More() {
  const items = NAV.slice(3);
  return (
    <div>
      <PageHeader title="More" />
      <nav className="card p-1.5" aria-label="More">
        {items.map(([to, label, I]) => (
          <Link key={to} to={to} className="flex items-center gap-3 px-3 h-14 rounded-xl hover:bg-ink-50 dark:hover:bg-night-line">
            <I size={20} className="muted" aria-hidden /> <span className="flex-1 font-medium">{label}</span> <ChevronRight size={18} className="muted" />
          </Link>
        ))}
        <Link to="/sync" className="flex items-center gap-3 px-3 h-14 rounded-xl hover:bg-ink-50 dark:hover:bg-night-line">
          <SyncIcon size={20} className="muted" aria-hidden /> <span className="flex-1 font-medium">Sync status</span> <ChevronRight size={18} className="muted" />
        </Link>
      </nav>
      <div className="card p-5 mt-5"><h2 className="text-base font-semibold mb-3">Install app</h2><InstallCard /></div>
    </div>
  );
}
