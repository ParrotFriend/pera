import { Download, Share, CircleCheck } from 'lucide-react';
import { usePwa } from '../services/app.jsx';
import { useToast } from './ui.jsx';

export default function InstallCard() {
  const { canPrompt, install, installed, isIOS } = usePwa();
  const toast = useToast();
  if (installed) return <p className="flex items-center gap-2 text-sm text-gain"><CircleCheck size={16} /> Pera is installed on this device.</p>;
  if (canPrompt) return <button className="btn-primary btn-sm" onClick={async () => { if (await install()) toast('Pera installed'); }}><Download size={16} /> Install Pera</button>;
  if (isIOS) return <p className="text-sm muted flex flex-wrap items-center gap-1">In Safari, tap <Share size={15} className="inline" aria-label="Share" /> Share, then <strong>Add to Home Screen</strong>.</p>;
  return <p className="text-sm muted">Open this site in Chrome, Edge or Safari over HTTPS, then use the browser menu → <strong>Install app</strong> / <strong>Add to Home screen</strong>.</p>;
}
