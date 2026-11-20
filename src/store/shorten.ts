/**
 * Tools › Shorten with AI… opens Check quality straight on the review, for these subtitles (the
 * selected ones, else every one too fast to read).
 */
import { create } from 'zustand';

export const useShortenRequest = create<{ ids: string[] | null }>(() => ({ ids: null }));
