/**
 * Check quality's Adjust: opens a problem's own tool (Space out, Lengthen, Balance lines, Remove HI
 * tags) on the subtitles that have it, selected, the tool's scope on Selected.
 */
import { useEffect, useState } from 'react';
import type { ShiftScope } from '../lib/tools';
import { type DialogName, useApp } from './store';

/** The tool opened from Check quality, until it has read its first scope. */
let asked: DialogName | null = null;

export function openToolOn(dialog: DialogName, ids: string[]) {
  asked = ids.length ? dialog : null;
  useApp.setState({ selection: ids });
  useApp.getState().openDialog(dialog);
}

/** A tool's scope: Selected when Check quality opened it on its problems, else All. */
export function useToolScope(dialog: DialogName) {
  const scope = useState<ShiftScope>(() => (asked === dialog ? 'selection' : 'all'));
  useEffect(() => {
    if (asked === dialog) asked = null;
  }, [dialog]);
  return scope;
}
