/**
 * Scene notes: a note placed at a moment of the film ("a priest scolds his pupil") describes the
 * scene from there to the next note (or the end). Sent to the AI with every subtitle of the scene,
 * so it can tell who speaks to whom and keep tu / vous and the tone consistent. A note left empty
 * just ends the scene before it.
 */
import type { Cue } from './types';

export interface SceneNote {
  id: string;
  /** ms */
  time: number;
  text: string;
}

export const sortNotes = (notes: SceneNote[]) => [...notes].sort((a, b) => a.time - b.time);

/** The scene a moment belongs to: the last note at or before it (null before the first, or after an empty one). */
export function noteAt(notes: SceneNote[], t: number): SceneNote | null {
  let found: SceneNote | null = null;
  for (const n of sortNotes(notes)) {
    if (n.time > t) break;
    found = n;
  }
  return found && found.text.trim() ? found : null;
}

/** A subtitle belongs to the scene of its middle (one starting just before the note still counts). */
const noteOfCue = (notes: SceneNote[], c: Cue) => noteAt(notes, (c.start + c.end) / 2);

/** Where a note's scene ends: the next note's time, or null (the end of the film). */
export function sceneEnd(notes: SceneNote[], note: SceneNote): number | null {
  return sortNotes(notes).find((n) => n.time > note.time)?.time ?? null;
}

export const cuesInScene = (cues: Cue[], notes: SceneNote[], note: SceneNote) => cues.filter((c) => noteOfCue(notes, c)?.id === note.id);

/** A note already at this moment (a second press shouldn't add another one). */
export const noteNear = (notes: SceneNote[], t: number, tolMs = 250) => notes.find((n) => Math.abs(n.time - t) <= tolMs);

/** For a batch sent to the AI: the notes it touches (numbered from 1) and each subtitle's scene number. */
export function batchScenes(cues: Cue[], notes: SceneNote[]): { scenes: string[]; sceneOf: (number | undefined)[] } {
  const scenes: string[] = [];
  const index = new Map<string, number>();
  const sceneOf = cues.map((c) => {
    const n = noteOfCue(notes, c);
    if (!n) return undefined;
    if (!index.has(n.id)) {
      scenes.push(n.text.trim());
      index.set(n.id, scenes.length);
    }
    return index.get(n.id);
  });
  return { scenes, sceneOf };
}

/** Scenes to draw as bands: from each note to the next (or `totalMs`), empty notes left out; `alt` alternates the colour. */
export function sceneSpans(notes: SceneNote[], totalMs: number): { note: SceneNote; from: number; to: number; alt: boolean }[] {
  const sorted = sortNotes(notes);
  return sorted
    .map((note, i) => ({ note, from: note.time, to: Math.max(note.time, sorted[i + 1]?.time ?? totalMs), alt: i % 2 === 1 }))
    .filter((s) => s.note.text.trim());
}
