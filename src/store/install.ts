/**
 * Subtle as an installed app (Chrome: install from the address bar).
 * - The service worker (src/sw.js, production only) keeps the app's files: it opens offline.
 * - A new version: a message with Reload (the open page keeps its files until then).
 * - Settings › Install Subtle: Chrome's install offer kept (beforeinstallprompt), shown on a button.
 * - Files opened with Subtle from the Finder (manifest `file_handlers`): a film and / or subtitles
 *   start a new project (their file handles kept: ⌘S saves into them), a .subtle is imported.
 */
import { t } from '../i18n';
import { isSubtitleFile, isVideoFile } from '../lib/files';
import { importProjectFile, newProject } from './projects';
import { create } from 'zustand';
import { useApp } from './store';

/** Chrome's offer to install (it can be shown once). */
interface InstallOffer extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const runsInstalled = () => {
  try {
    return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches;
  } catch {
    return false;
  }
};

/** `offer`: Chrome would install Subtle now (null: already installed, or this browser doesn't offer it). */
export const useInstall = create<{ offer: InstallOffer | null; installed: boolean }>(() => ({
  offer: null,
  installed: typeof window !== 'undefined' && runsInstalled(),
}));

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // kept for the button; Chrome's own icon in the address bar stays
    useInstall.setState({ offer: e as InstallOffer });
  });
  window.addEventListener('appinstalled', () => {
    useInstall.setState({ offer: null, installed: true });
    useApp.getState().notify(t.install.done, { tone: 'success' });
  });
}

/** Settings › Install Subtle: Chrome's own install window. */
export async function installApp() {
  const offer = useInstall.getState().offer;
  if (!offer) return;
  await offer.prompt();
  await offer.userChoice.catch(() => null);
  useInstall.setState({ offer: null }); // an offer is used once; Chrome sends another if still possible
}

/** Set when Reload was clicked: the new version taking over then reloads the page (not the first install). */
let reloadAsked = false;

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
    const offer = (w: ServiceWorker) =>
      useApp.getState().notify(t.install.updated, {
        stay: true,
        action: {
          label: t.install.reload,
          onClick: () => {
            reloadAsked = true;
            w.postMessage('skip-waiting');
          },
        },
      });
    // A version already waiting (found on an earlier visit), or one found now.
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
    // Look for a new version now and then while Subtle stays open.
    setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
  });
  // The new version took over after Reload: load it.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadAsked) return;
    reloadAsked = false;
    location.reload();
  });
}

interface LaunchParams {
  files: FileSystemFileHandle[];
}

/** Files Subtle was opened with (installed app, Finder › Open with). Call once the projects are loaded. */
export function handleLaunchFiles(open: (f: File, handle: FileSystemFileHandle) => void) {
  const queue = (window as unknown as { launchQueue?: { setConsumer: (f: (p: LaunchParams) => void) => void } }).launchQueue;
  queue?.setConsumer(async ({ files }) => {
    if (!files?.length) return;
    const all = await Promise.all(files.map(async (h) => ({ h, f: await h.getFile() })));
    for (const { f } of all.filter(({ f }) => /\.subtle$/i.test(f.name))) await importProjectFile(f);
    const work = all.filter(({ f }) => isVideoFile(f) || isSubtitleFile(f));
    if (!work.length) return;
    // A film and its subtitles: a project of their own (the open one is kept in Projects).
    if (useApp.getState().doc || useApp.getState().videoUrl) await newProject();
    // The film first, so its subtitles land in its project.
    work.sort((a, b) => Number(isVideoFile(b.f)) - Number(isVideoFile(a.f)));
    for (const { f, h } of work) open(f, h);
  });
}
