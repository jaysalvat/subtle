/**
 * This browser's missing features (lib/support), known at start; the banner about them, closed for
 * good once closed (until something else goes missing, another browser for instance).
 */
import { create } from 'zustand';
import { capabilitiesHere, missingFeatures, type Feature } from '../lib/support';

const KEY = 'subtle.supportSeen';
const seen = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

const missing = missingFeatures(capabilitiesHere());

export const useSupport = create<{ missing: Feature[]; bannerClosed: boolean }>(() => ({
  missing,
  bannerClosed: seen() === missing.join(','),
}));

export function closeSupportBanner() {
  useSupport.setState({ bannerClosed: true });
  try {
    localStorage.setItem(KEY, useSupport.getState().missing.join(','));
  } catch {
    /* private mode */
  }
}

/** Video and audio decoding (WebCodecs): waveform, filmstrip, exact frames, speech to text. */
export const canDecode = () => !useSupport.getState().missing.includes('codecs');
