/**
 * The app's sounds, only two (more clashed with the message that follows):
 * - `done`: a long job's progress reaches the end and there is something to do (subtitles from the
 *   audio, translation, Review / Shorten with AI; not when stopped or failed);
 * - `toast`: a message shows (every `notify`; quiet right after `done`, which already says it).
 * Settings › General › App › Play sounds turns them off. Files in src/sounds/ (kept offline).
 */
import doneUrl from '../sounds/done.mp3';
import toastUrl from '../sounds/toast.mp3';
import { useApp } from './store';

export type Sound = 'done' | 'toast';

const URLS: Record<Sound, string> = { done: doneUrl, toast: toastUrl };
const players: Partial<Record<Sound, HTMLAudioElement>> = {};
/** When `done` last played: the message that comes with it stays quiet. */
let jobSoundAt = 0;

export function playSound(sound: Sound) {
  if (!useApp.getState().settings.sounds) return;
  if (sound === 'toast' && Date.now() - jobSoundAt < 1500) return;
  if (sound !== 'toast') jobSoundAt = Date.now();
  const a = (players[sound] ??= new Audio(URLS[sound]));
  a.volume = 0.7;
  a.currentTime = 0;
  // The browser may refuse to play before a click on the page: nothing to say then.
  void a.play().catch(() => {});
}
