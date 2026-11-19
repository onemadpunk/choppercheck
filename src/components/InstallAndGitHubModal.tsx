import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Server,
  Share2,
  Smartphone,
  Star,
  X,
} from 'lucide-react';

interface InstallAndGitHubModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const GITHUB_PAGES_IPS = [
  '185.199.108.153',
  '185.199.109.153',
  '185.199.110.153',
  '185.199.111.153',
];

const CLOUDFLARE_WORKER_SNIPPET = `export default {
  async fetch(request) {
    const url = new URL(request.url);
    const lat = url.searchParams.get("lat") || "57.20";
    const lon = url.searchParams.get("lon") || "-2.20";
    const radius = url.searchParams.get("radius") || "250";
    const target = \`https://opendata.adsb.fi/api/v2/lat/\${lat}/lon/\${lon}/dist/\${radius}\`;
    const res = await fetch(target, { headers: { "User-Agent": "ChopperCheck-Radar/1.0" } });
    const body = await res.text();
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=5"
      }
    });
  }
};`;

export const InstallAndGitHubModal: React.FC<InstallAndGitHubModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showAdminDns, setShowAdminDns] = useState<boolean>(false);
  // The owner setup is only for the site owner: open the site once with ?owner=1 to show it
  const [isOwner] = useState<boolean>(() => {
    try {
      if (new URLSearchParams(window.location.search).get('owner') === '1') {
        localStorage.setItem('choppercheck_owner', '1');
      }
      return localStorage.getItem('choppercheck_owner') === '1';
    } catch {
      return false;
    }
  });
  const [workerUrl, setWorkerUrl] = useState<string>(() => {
    try {
      return localStorage.getItem('choppercheck_worker_url') || '';
    } catch {
      return '';
    }
  });
  const [savedWorkerBanner, setSavedWorkerBanner] = useState<boolean>(false);

  if (!isOpen) return null;

  const currentLiveUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://choppercheck.com';

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2200);
    } catch {
      // ignore
    }
  };

  const handleSaveWorkerUrl = () => {
    try {
      const trimmed = workerUrl.trim();
      if (trimmed) {
        localStorage.setItem('choppercheck_worker_url', trimmed);
      } else {
        localStorage.removeItem('choppercheck_worker_url');
      }
      setSavedWorkerBanner(true);
      setTimeout(() => setSavedWorkerBanner(false), 2500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 text-slate-100 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-5 h-5 text-cyan-400" />
            <h2 className="text-base sm:text-lg font-bold text-white">
              Install ChopperCheck.com to Your Phone
            </h2>
          </div>
          <button
            onClick={onClose}
            className="min-w-[38px] min-h-[38px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 mt-4 text-sm text-slate-300">
          {/* 1. Primary Phone Home Screen Install Card */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-cyan-400" />
                Add to Home Screen (iPhone & Android)
              </h3>
              <button
                onClick={() => copyText('live-url', currentLiveUrl)}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-mono flex items-center gap-1 cursor-pointer"
              >
                {copiedKey === 'live-url' ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                {copiedKey === 'live-url' ? 'Link Copied!' : 'Copy App Link'}
              </button>
            </div>

            {isInstalled ? (
              <div className="mt-2.5 flex items-center gap-2 text-emerald-400 text-xs font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Installed on this phone — launch anytime from your home screen.
              </div>
            ) : isInstallable ? (
              <button
                onClick={install}
                className="mt-3 w-full py-2.5 px-4 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold rounded-lg text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Install ChopperCheck App Now
              </button>
            ) : null}

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <div className="font-semibold text-amber-400">iPhone / iPad (Safari):</div>
                <ol className="list-decimal list-inside text-slate-300 space-y-1.5 mt-1.5">
                  <li>
                    Open <strong>choppercheck.com</strong> in Safari.
                  </li>
                  <li>
                    Tap the <strong>Share</strong> icon (
                    <Share2 className="w-3 h-3 inline" />) at the bottom of the screen.
                  </li>
                  <li>
                    Scroll down and tap <strong>Add to Home Screen</strong> → <strong>Add</strong>.
                  </li>
                </ol>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <div className="font-semibold text-cyan-400">Android (Chrome / Samsung):</div>
                <ol className="list-decimal list-inside text-slate-300 space-y-1.5 mt-1.5">
                  <li>
                    Open <strong>choppercheck.com</strong> in Chrome.
                  </li>
                  <li>
                    Tap the <strong>3-dot menu (⋮)</strong> in the top-right corner.
                  </li>
                  <li>
                    Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                  </li>
                </ol>
              </div>
            </div>
          </div>

          {/* 2. Quick Tip: Star Your Rig & Single-Rig Focus */}
          <div className="bg-amber-950/25 border border-amber-500/35 rounded-lg p-3.5 text-xs space-y-1">
            <div className="font-bold text-amber-300 flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 shrink-0" />
              Pro Tip for Offshore Crew: Lock & Favourite Your Rig
            </div>
            <p className="text-slate-300 leading-relaxed">
              Tap <strong>Save Rig</strong> on the top-left map card to save your installation (e.g.{' '}
              <strong>Forties Charlie</strong>, <strong>Glen Lyon</strong>, <strong>Culzean</strong>).
              Tap <strong>Only [Rig]</strong> to hide all other platforms on the map so your phone
              only shows your rig, its shore base, and incoming choppers.
            </p>
          </div>

          {/* 3. Collapsed Admin Section for onemadpunk (hidden from normal users) */}
          {isOwner && (
          <div className="border-t border-slate-800 pt-3">
            <button
              onClick={() => setShowAdminDns((prev) => !prev)}
              className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 py-1 cursor-pointer"
            >
              <span className="flex items-center gap-1.5 font-mono">
                <Globe className="w-3.5 h-3.5 text-slate-400" />
                Site Owner Setup (onemadpunk · DNS & Live ADS-B Relay)
              </span>
              {showAdminDns ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {showAdminDns && (
              <div className="mt-3 bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3 text-xs">
                {/* Free Cloudflare Worker / Backend Relay for 100% Live ADS-B on GitHub Pages */}
                <div className="p-3 rounded bg-slate-900 border border-emerald-500/40 space-y-2">
                  <div className="font-bold text-emerald-400 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5" />
                      Live ADS-B Relay for Static GitHub Pages (choppercheck.com)
                    </span>
                    <button
                      onClick={() => copyText('cf-worker', CLOUDFLARE_WORKER_SNIPPET)}
                      className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono cursor-pointer"
                    >
                      {copiedKey === 'cf-worker'
                        ? 'Copied Worker Code!'
                        : 'Copy Free Cloudflare Worker'}
                    </button>
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    <strong>Why live flights need a relay on GitHub Pages:</strong> Open-Meteo's 5
                    weather models (<strong>UKMO UKV, ICON, ECMWF, GFS, GEM</strong>) allow direct browser
                    access (`Access-Control-Allow-Origin: *`), so the new Weather Streamlines &
                    Go/No-Go Matrix work 100% on GitHub Pages with zero backend. However, live ADS-B
                    providers (`adsb.fi` / `adsb.lol`) block browser CORS and use Cloudflare Bot
                    Fight Mode against shared proxies. Paste your free Cloudflare Worker or Render
                    backend URL below for instant 24/7 ADS-B feeds:
                  </p>
                  <div className="flex gap-1.5 pt-1">
                    <input
                      type="url"
                      value={workerUrl}
                      onChange={(e) => setWorkerUrl(e.target.value)}
                      placeholder="https://choppercheck-adsb.<your-subdomain>.workers.dev"
                      className="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                    />
                    <button
                      onClick={handleSaveWorkerUrl}
                      className="px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs cursor-pointer shrink-0"
                    >
                      {savedWorkerBanner ? 'Saved!' : 'Save Relay'}
                    </button>
                  </div>
                </div>

                <div className="p-3 rounded bg-slate-900 border border-slate-800 space-y-1.5">
                  <div className="font-bold text-amber-400">
                    1. Make Repository Public & Enable GitHub Pages
                  </div>
                  <ol className="list-decimal list-inside text-slate-300 space-y-1">
                    <li>
                      Open{' '}
                      <a
                        href="https://github.com/onemadpunk/choppercheck/settings"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 underline inline-flex items-center gap-0.5"
                      >
                        github.com/onemadpunk/choppercheck/settings{' '}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      .
                    </li>
                    <li>
                      On the left menu, click <strong>Pages</strong> and select{' '}
                      <strong>GitHub Actions</strong> under Source.
                    </li>
                    <li>
                      Under <strong>Custom domain</strong>, type{' '}
                      <code className="text-cyan-300 font-mono">choppercheck.com</code> and click{' '}
                      <strong>Save</strong>.
                    </li>
                  </ol>
                </div>

                <div className="p-3 rounded bg-slate-900 border border-cyan-500/40 space-y-2">
                  <div className="font-bold text-cyan-300">
                    2. DNS Records for choppercheck.com
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse font-mono text-[11px] mt-1">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-1.5 pr-2">Type</th>
                          <th className="py-1.5 pr-2">Host / Name</th>
                          <th className="py-1.5 pr-2">Value / Points To</th>
                          <th className="py-1.5 text-right">Copy</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {GITHUB_PAGES_IPS.map((ip) => (
                          <tr key={ip}>
                            <td className="py-1.5 pr-2 text-amber-400 font-bold">A</td>
                            <td className="py-1.5 pr-2 text-white">@</td>
                            <td className="py-1.5 pr-2 text-cyan-300 tabular-nums">{ip}</td>
                            <td className="py-1.5 text-right">
                              <button
                                onClick={() => copyText(ip, ip)}
                                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] cursor-pointer"
                              >
                                {copiedKey === ip ? 'Copied!' : 'Copy'}
                              </button>
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td className="py-1.5 pr-2 text-emerald-400 font-bold">CNAME</td>
                          <td className="py-1.5 pr-2 text-white">www</td>
                          <td className="py-1.5 pr-2 text-cyan-300">onemadpunk.github.io</td>
                          <td className="py-1.5 text-right">
                            <button
                              onClick={() => copyText('cname', 'onemadpunk.github.io')}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] cursor-pointer"
                            >
                              {copiedKey === 'cname' ? 'Copied!' : 'Copy'}
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg text-sm transition-colors cursor-pointer"
        >
          Back to Live Radar
        </button>
      </div>
    </div>
  );
};
