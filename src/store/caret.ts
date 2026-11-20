/**
 * Where the text cursor last was in a subtitle's text (or translation), so Split (S, the row button)
 * can cut the text there: the field loses focus when the button is clicked, the position is kept.
 */
import { create } from 'zustand';
import { useApp } from './store';

export interface Caret {
  id: string;
  field: 'text' | 'target';
  index: number;
  /** The text the index refers to: ignored if the subtitle changed since. */
  value: string;
}

let last: Caret | null = null;

export const rememberCaret = (c: Caret) => (last = c);
export const forgetCaret = () => (last = null);

/** The cursor in this subtitle, if it's still valid for its current text. */
export function caretFor(id: string, current: { text: string; target?: string }, editable: (raw: string) => string): Caret | null {
  if (!last || last.id !== id) return null;
  const raw = last.field === 'text' ? current.text : (current.target ?? '');
  return editable(raw) === last.value ? last : null;
}

/**
 * The subtitle whose text field is open: a selected subtitle shows its text; the field opens on a
 * click on the text, Enter, Insert, spotting… and closes on Enter (saved), Escape (cancelled) or
 * when it loses the focus (saved).
 */
export const useEditing = create<{ id: string | null }>(() => ({ id: null }));
export const stopEditing = () => useEditing.setState({ id: null });

/** The open field's "save what's typed", for buttons used while typing (italics, capitals…). */
let commitOpen: (() => void) | null = null;
export const setOpenCommit = (f: (() => void) | null) => (commitOpen = f);
export const commitEditing = () => commitOpen?.();

/** The list draws only the rows near the view: it scrolls a row in (and draws it) before its field is focused. */
let reveal: ((id: string) => void) | null = null;
export const setRevealRow = (f: ((id: string) => void) | null) => (reveal = f);

/** Open the field of a subtitle (the selected one by default) and put the caret at its end. */
export function focusField(field: 'text' | 'target', id: string | null = useApp.getState().selection[0] ?? null) {
  if (!id) return;
  useEditing.setState({ id });
  reveal?.(id);
  // The field appears once the row is drawn as selected: try for a few moments (timeouts, not
  // animation frames, which don't run in a background tab).
  let tries = 0;
  const focus = () => {
    const el = document.querySelector<HTMLTextAreaElement>(`.rows [data-id="${id}"] textarea[data-field="${field}"]`);
    if (!el) {
      if (tries++ < 20) setTimeout(focus, 25);
      return;
    }
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };
  setTimeout(focus, 0);
}
