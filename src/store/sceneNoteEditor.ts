/** Which scene note's window is open (the timeline draws it under its bubble). */
import { create } from 'zustand';

export const useNoteEditor = create<{ id: string | null }>(() => ({ id: null }));
export const openNote = (id: string | null) => useNoteEditor.setState({ id });
