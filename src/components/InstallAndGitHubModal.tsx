import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Share2,
  Smartphone,
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

export const InstallAndGitHubModal: React.FC<InstallAndGitHubModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 text-slate-100 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-cyan-400" />
            <h2 className="text-base sm:text-lg font-bold text-white">
              Connect choppercheck.com (GitHub Pages + Mobile Setup)
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
          {/* 1. Pre-Configured CNAME Notice */}
          <div className="bg-emerald-950/35 border border-emerald-500/40 rounded-lg p-3.5 text-xs">
            <div className="font-bold text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              We have already added <code className="font-mono text-white">/public/CNAME</code> set to <code className="font-mono text-cyan-300">choppercheck.com</code> inside your project!
            </div>
            <p className="text-slate-300 mt-1">
              That means as soon as you push this project to GitHub and point your domain DNS records below, GitHub Pages will automatically serve this app at <strong>https://choppercheck.com</strong> with a free SSL security certificate.
            </p>
          </div>

          {/* 2. Exact 3-Part Walkthrough to Connect choppercheck.com */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
            <h3 className="font-bold text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-amber-400" />
              Step-by-Step: Put This App Live on choppercheck.com
            </h3>

            <div className="space-y-3 text-xs">
              {/* PART 1 */}
              <div className="p-3 rounded bg-slate-900 border border-slate-800">
                <div className="font-bold text-amber-400">
                  Part 1 — Send This App from Google AI Studio to GitHub
                </div>
                <ol className="list-decimal list-inside text-slate-300 mt-1.5 space-y-1">
                  <li>
                    Create a free account at{' '}
                    <a
                      href="https://github.com/signup"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 underline inline-flex items-center gap-0.5"
                    >
                      github.com <ExternalLink className="w-3 h-3" />
                    </a>{' '}
                    (if you don't have one yet).
                  </li>
                  <li>
                    Look at the <strong>very top-right bar of your Google AI Studio screen</strong> (above this dark app window) and click the <strong>GitHub icon ("Save to GitHub")</strong>.
                  </li>
                  <li>
                    Name the repository <code className="text-cyan-300 font-mono">choppercheck</code>, set it to <strong>Public</strong>, and click <strong>Create / Push</strong>.
                  </li>
                </ol>
              </div>

              {/* PART 2 */}
              <div className="p-3 rounded bg-slate-900 border border-slate-800">
                <div className="font-bold text-amber-400">
                  Part 2 — Turn On GitHub Pages (on GitHub.com)
                </div>
                <ol className="list-decimal list-inside text-slate-300 mt-1.5 space-y-1">
                  <li>
                    On your new GitHub repository page, click <strong>Settings</strong> (top bar gear icon).
                  </li>
                  <li>
                    On the left-hand menu, click <strong>Pages</strong>.
                  </li>
                  <li>
                    Under <strong>Build and deployment → Source</strong>, change the dropdown from <em>"Deploy from a branch"</em> to <strong>GitHub Actions</strong>.
                  </li>
                  <li>
                    Under <strong>Custom domain</strong> on that same page, type <code className="text-cyan-300 font-mono">choppercheck.com</code> and click <strong>Save</strong>.
                  </li>
                </ol>
              </div>

              {/* PART 3: DNS Table */}
              <div className="p-3 rounded bg-slate-900 border border-cyan-500/40 space-y-2">
                <div className="font-bold text-cyan-300">
                  Part 3 — Copy These DNS Records into Where You Bought choppercheck.com
                </div>
                <p className="text-slate-300">
                  Log in to wherever you bought <strong>choppercheck.com</strong> (e.g. GoDaddy, Namecheap, 123-reg, Ionos, or Cloudflare), open <strong>DNS Settings / Manage DNS</strong>, and add these 4 <strong>A Records</strong> and 1 <strong>CNAME Record</strong>:
                </p>

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
                        <td className="py-1.5 pr-2 text-slate-300">
                          &lt;your-github-username&gt;.github.io
                        </td>
                        <td className="py-1.5 text-right text-slate-500">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-slate-400 pt-1">
                  Once saved, wait 10–15 minutes for DNS to connect, then tick the <strong>"Enforce HTTPS"</strong> box in GitHub <strong>Settings → Pages</strong>. Now <strong>https://choppercheck.com</strong> is live worldwide for free!
                </p>
              </div>
            </div>
          </div>

          {/* 3. How to Save to Phone Home Screen */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-cyan-400" />
                Save ChopperCheck.com as an App on Your Phone
              </h3>
              <button
                onClick={() => copyText('live-url', currentLiveUrl)}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-mono flex items-center gap-1 cursor-pointer"
              >
                {copiedKey === 'live-url' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedKey === 'live-url' ? 'Copied Preview Link' : 'Copy Current Preview Link'}
              </button>
            </div>

            {isInstalled ? (
              <div className="mt-2 flex items-center gap-2 text-emerald-400 text-xs font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Installed on this device — launch anytime from your home screen.
              </div>
            ) : isInstallable ? (
              <button
                onClick={install}
                className="mt-2.5 w-full py-2.5 px-4 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold rounded-lg text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Install ChopperCheck App Now
              </button>
            ) : null}

            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="font-semibold text-amber-400">iPhone / iPad (Safari):</div>
                <ol className="list-decimal list-inside text-slate-300 space-y-1 mt-1">
                  <li>Open <strong>choppercheck.com</strong> in Safari.</li>
                  <li>
                    Tap the <strong>Share</strong> icon (<Share2 className="w-3 h-3 inline" />) at the bottom.
                  </li>
                  <li>
                    Tap <strong>Add to Home Screen</strong> → <strong>Add</strong>.
                  </li>
                </ol>
              </div>
              <div>
                <div className="font-semibold text-cyan-400">Android (Chrome / Samsung):</div>
                <ol className="list-decimal list-inside text-slate-300 space-y-1 mt-1">
                  <li>Open <strong>choppercheck.com</strong> in Chrome.</li>
                  <li>Tap the <strong>3-dot menu (⋮)</strong> in the top-right.</li>
                  <li>
                    Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                  </li>
                </ol>
              </div>
            </div>
          </div>
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
