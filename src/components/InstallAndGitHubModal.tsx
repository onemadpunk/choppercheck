import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { X } from 'lucide-react';
export const InstallAndGitHubModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [copied, setCopied] = useState(false);
  if (!isOpen) return null;
  const copy = async () => { try { await navigator.clipboard.writeText('https://choppercheck.com'); setCopied(true); } catch { setCopied(false); } };
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-3"><div className="w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 space-y-4">
    <div className="flex justify-between items-center"><h2 className="font-bold text-white">ChopperCheck on your phone</h2><button onClick={onClose} aria-label="Close install instructions" className="p-2 rounded bg-slate-800"><X className="w-4 h-4" /></button></div>
    {isInstalled ? <p className="text-sm text-cyan-300">Installed on this device.</p> : isInstallable && <button onClick={install} className="w-full p-3 bg-cyan-500 text-slate-950 rounded font-semibold">Install ChopperCheck</button>}
    <div className="text-sm space-y-3"><p><strong>iPhone / iPad:</strong> Open choppercheck.com in Safari, tap Share, then Add to Home Screen.</p><p><strong>Android:</strong> Open choppercheck.com in Chrome, open the browser menu and select Install app or Add to Home screen when available.</p></div>
    <button onClick={copy} className="text-cyan-300 text-sm underline">{copied ? 'Link copied' : 'Copy app link'}</button>
    <div className="text-xs text-slate-400 border-t border-slate-700 pt-3 space-y-3"><p>Star a rig to save it in this browser. Favourites and pinned aircraft stay on this device and do not sync. Clearing browser storage removes them.</p><p>Shows received aircraft positions within up to 250 NM of the map view. Pan or zoom to find aircraft; offshore reception can have gaps. Flight updates need an internet connection and ADS-B coverage. Position estimates stop after 10 seconds without a report; targets expire after 45 seconds.</p><p>Page alerts need this page to remain running. Installing the app does not enable closed-app push notifications. Aircraft detection does not confirm take-off time.</p></div>
    <section className="text-xs text-slate-400 border-t border-slate-700 pt-3 space-y-2"><h3 className="font-semibold text-slate-200">Aircraft data & reuse</h3><p>Aircraft information supplied by <a href="https://www.adsb.lol/" target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">adsb.lol</a> is available under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">Open Database Licence (ODbL) 1.0</a>. ChopperCheck's database-derived aircraft additions are shared under that licence. Other providers and independent map/weather layers retain their own terms.</p><a href="/adsb-data-notice.json" target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline inline-block">Data notice and processing method (JSON)</a></section>
    <button onClick={onClose} className="w-full py-2 bg-slate-800 rounded text-sm">Back to radar</button>
  </div></div>;
};
