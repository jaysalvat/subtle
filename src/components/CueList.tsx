import { commitEditing, focusField, setOpenCommit, setRevealRow, stopEditing, useEditing } from '../store/caret';
import { offsetsOf, rangeAt, rowInView, scrollFor } from '../lib/windowing';
import { sideField, viewOf, type EditSide } from '../lib/translation';
import { languageName } from '../lib/languages';
import { middleEllipsis } from '../lib/filename';
import { ProgressBand } from './Progress';
import { Pill } from './Pill';
import { WithKeys } from './Keys';
import { rememberCaret } from '../store/caret';
import { spotTyped, useSpot } from '../store/spot';
import { stopStt, useStt } from '../store/stt';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { collectIssues, cps, cueAt, nextCueIndex, type IssueKind } from '../lib/tools';
import { formatDuration, formatTimecode } from '../lib/time';
import type { Cue, Settings } from '../lib/types';
import { player, usePlayback } from '../store/playback';
import { useApp } from '../store/store';
import {
  deleteSelected,
  goToCue,
  goToIndex,
  mergeSelected,
  nudge,
  splitSelected,
  switchEditSide,
  setCueColour,
  toggleBold,
  toggleItalic,
  togglePosition,
  toggleTextCase,
} from '../actions';
import { isUpperCase } from '../lib/textCase';
import { colourOf, editableText, isBold, isItalic, setItalic, withEditedText } from '../lib/markup';
import { FormatButtons } from './FormatButtons';
import { renderCueText } from './Player';
import { isTop } from '../lib/position';
import { DropZone, SUBS_ACCEPT } from './DropZone';
import { IssuesButton, issueText } from './IssuesPanel';
import { FileIcon, Merge, Minus, Plus, Split, SwapIcon, Trash } from './Icons';
import { SearchField } from './SearchField';

function ActiveProgress({ cue }: { cue: Cue }) {
  const pct = usePlayback((s) => Math.min(100, Math.max(0, ((s.time - cue.start) / Math.max(1, cue.end - cue.start)) * 100)));
  return <div className="row-progress" style={{ width: `${pct}%` }} />;
}

/** Textarea that keeps a local draft and commits on blur (one undo step per edit). */
function TextEditor({ cue, field }: { cue: Cue; field: 'text' | 'target' }) {
  const updateCue = useApp((s) => s.updateCue);
  const creating = useApp((s) => s.creatingSubs);
  // The editor shows the text only: position tag and whole-subtitle italics stay hidden (lib/markup).
  const raw = (field === 'text' ? cue.text : cue.target) ?? '';
  // The field's language, for its placeholder ("Type in French…").
  const lang = useApp((s) => (field === 'target' ? s.translation?.targetLang : (s.translation?.sourceLang ?? s.doc?.lang)) ?? null);
  const value = editableText(raw);
  const italic = isItalic(raw);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + 2}px`;
    }
  }, [draft]);
  // The draft as typed, read by commit even right after Escape reset it (state updates later).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const commit = () => {
    const draft = draftRef.current;
    if (draft !== value) updateCue(cue.id, { [field]: withEditedText(raw, draft) }, field === 'text' ? t.list.editTextUndo : t.list.editTranslationUndo);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  return (
    <textarea
      ref={ref}
      rows={1}
      data-field={field}
      className={italic ? 'italic' : ''}
      value={draft}
      readOnly={creating}
      aria-label={field === 'text' ? t.list.textField : t.list.translationField}
      placeholder={t.list.typeIn(lang ? languageName(lang) : null)}
      onChange={(e) => setDraft(e.target.value)}
      onSelect={(e) => {
        const el = e.currentTarget;
        rememberCaret({ id: cue.id, field, index: el.selectionStart, value: el.value });
      }}
      // The latest commit (the subtitle may change while the field is open: italics, capitals…).
      onFocus={() => setOpenCommit(() => commitRef.current())}
      // Leaving the field saves it and closes it (the text shows again).
      onBlur={() => {
        setOpenCommit(null);
        commit();
        if (useEditing.getState().id === cue.id) stopEditing();
      }}
      onKeyDown={(e) => {
        // Just spotted: Enter saves the text and plays on (Shift+Enter for a second line), Esc stays paused.
        if (useSpot.getState().typing === cue.id) {
          if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
            spotTyped(true);
            return;
          }
          if (e.key === 'Escape') spotTyped(false);
        }
        if (e.key === 'Escape') {
          // Cancel: the text as it was, the field closed.
          setDraft(value);
          draftRef.current = value;
          (e.target as HTMLTextAreaElement).blur();
        }
        // Enter: done (saved, the field closes, the keyboard goes back to the timeline);
        // Shift+Enter: a new line.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.altKey && e.code === 'KeyT' && useApp.getState().translation) {
          // ⌥T while typing: save what's typed, then type in the other language of this subtitle.
          e.preventDefault();
          e.stopPropagation(); // not again by the window's shortcuts
          commit();
          switchEditSide();
          return;
        }
        if (e.altKey && e.code === 'Space') {
          // ⌥Space plays / pauses even while typing.
          e.preventDefault();
          player.toggle();
        }
        if (e.key === 'Tab') {
          // Tab / Shift+Tab: save and move to the same field of the next / previous subtitle.
          e.preventDefault();
          commit();
          const list = useApp.getState().doc?.cues ?? [];
          const i = list.findIndex((c) => c.id === cue.id) + (e.shiftKey ? -1 : 1);
          if (i >= 0 && i < list.length) {
            goToIndex(i);
            focusField(field);
          }
        }
        if (e.key.toLowerCase() === 'i' && (e.metaKey || e.ctrlKey)) {
          // ⌘I while typing: keep what's typed and switch italics in one step.
          e.preventDefault();
          updateCue(cue.id, { [field]: setItalic(withEditedText(raw, draft), !italic) }, italic ? t.list.italicOffUndo : t.list.italicOnUndo);
        }
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

interface RowProps {
  cue: Cue;
  n: number;
  /** Every other row, barely lighter (by its place in the list: not every row is drawn). */
  alt: boolean;
  active: boolean;
  selected: boolean;
  single: boolean;
  issues: IssueKind[];
  translating: boolean;
  /** While translating: the language edited (the other one is shown dimmed, as a model). */
  side: EditSide;
  settings: Settings;
  /** Subtitles are being created: no editing, row buttons greyed. */
  locked: boolean;
}

const Row = memo(function Row({ cue, n, alt, active, selected, single, issues, translating, side, settings, locked }: RowProps) {
  const select = useApp((s) => s.select);
  const field = translating ? sideField(side) : 'text';
  // The text field is open only while editing; otherwise the text shows (a click on it edits).
  const editing = useEditing((s) => s.id === cue.id);
  const open = selected && single && !locked && editing;
  const editHere = (f: 'text' | 'target') => (e: React.MouseEvent) => {
    if (!selected || !single || locked || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.stopPropagation();
    // The other language's line: edit that one (the switch follows).
    if (translating && f !== field) switchEditSide(f === 'text' ? 'source' : 'target');
    focusField(f, cue.id);
  };
  // Names for an empty line ("No English yet"): an empty subtitle still shows both languages.
  const sourceName = useApp((s) => (s.translation ? languageName(s.translation.sourceLang ?? s.doc?.lang ?? 'en') : null));
  const edited = field === 'target' ? (cue.target ?? '') : cue.text;
  const speed = Math.round(cps({ ...cue, text: field === 'target' && cue.target ? cue.target : cue.text }));
  const isHi = issues.includes('hi');
  const top = isTop(cue);
  const italicCue = isItalic(cue.text);
  const boldCue = isBold(cue.text);
  return (
    <div
      className={`row ${alt ? 'alt' : ''} ${selected ? 'selected' : ''} ${active ? 'active' : ''}`}
      data-id={cue.id}
      // ⇧ / ⌘-click selects subtitles, not the page's text (the browser would select it all in between).
      onMouseDown={(e) => {
        if ((e.shiftKey || e.metaKey || e.ctrlKey) && !(e.target as HTMLElement).closest('textarea, input')) e.preventDefault();
      }}
      onClick={(e) => {
        // A text selection made in the open field and released outside it ends here as a "click":
        // not a click on the row (it would put the cursor at the end and lose the selection).
        if (open && (document.activeElement as HTMLElement | null)?.closest?.(`[data-id="${cue.id}"] textarea`)) return;
        if (e.metaKey || e.ctrlKey) select(cue.id, 'toggle');
        else if (e.shiftKey) select(cue.id, 'range');
        else {
          goToCue(cue.id);
          if (translating && !locked) focusField(field); // translating: ready to type
        }
      }}
    >
      <div className="row-meta">
        <span className="num">#{n}</span>
        <span className="tc">{formatTimecode(cue.start)}</span>
        <span className="dim">–</span>
        <span className="tc">{formatTimecode(cue.end)}</span>
        {top && (
          <span className="pos-badge" title={t.list.atTopHint}>
            {t.list.atTop}
          </span>
        )}
        <span className="spacer" />
        <span className="muted">{formatDuration(cue.end - cue.start)}</span>
        <span className={settings.showIssues && issues.includes('cps') ? 'cps-warn' : 'dim'}>
          {Number.isFinite(speed) ? speed : '–'} {t.common.cps}
        </span>
      </div>
      {translating ? (
        // Original above, translation below; the one edited in full, the other dimmed.
        <>
          {open && side === 'source' ? (
            <TextEditor cue={cue} field="text" />
          ) : (
            <div className={`row-text ${side === 'target' ? 'src' : ''} editable ${cue.text.trim() ? '' : 'empty'}`} onClick={editHere('text')}>
              {cue.text.trim() ? renderCueText(cue.text).nodes : t.list.emptyIn(sourceName)}
            </div>
          )}
          {open && side === 'target' ? (
            <TextEditor cue={cue} field="target" />
          ) : (
            <div className={`row-text ${side === 'source' ? 'src' : ''} editable ${cue.target ? '' : 'empty'}`} onClick={editHere('target')}>
              {cue.target ? renderCueText(cue.target).nodes : t.list.emptyTarget}
            </div>
          )}
        </>
      ) : open ? (
        <TextEditor cue={cue} field="text" />
      ) : (
        <div className={`row-text editable ${isHi ? 'hi' : ''}`} onClick={editHere('text')}>
          {renderCueText(cue.text).nodes}
        </div>
      )}
      {issues.filter((k) => k !== 'hi' || !isHi || !translating).length > 0 && (
        <div className="row-warn">{issues.map((k) => issueText(k, settings)).join('. ')}</div>
      )}
      {selected && single && (
        <div
          className={`row-actions ${locked ? 'locked' : ''}`}
          aria-disabled={locked || undefined}
          onClick={(e) => e.stopPropagation()}
          // While typing: the field keeps the focus (it stays open); what's typed is saved first, so
          // italics, capitals, position… apply to it.
          onMouseDown={(e) => {
            if (!(e.target as HTMLElement).closest('button')) return;
            e.preventDefault();
            commitEditing();
          }}
        >
          <button className="icon-btn sm" aria-label={t.list.shorten} title={`${t.list.shorten} (⌥←)`} onClick={() => nudge(-1)}>
            <Minus />
          </button>
          <button className="icon-btn sm" aria-label={t.list.lengthen} title={`${t.list.lengthen} (⌥→)`} onClick={() => nudge(1)}>
            <Plus />
          </button>
          <span className="dim" style={{ fontSize: 'var(--fs-s)' }}>
            {t.list.by(settings.nudgeStepMs)}
          </span>
          <span className="spacer" />
          <FormatButtons
            bold={boldCue}
            italic={italicCue}
            upper={isUpperCase(edited.trim() ? edited : cue.text)}
            colour={colourOf(cue.text)}
            top={top}
            onBold={toggleBold}
            onItalic={toggleItalic}
            onCase={toggleTextCase}
            onColour={setCueColour}
            onTop={togglePosition}
          />
          <button className="icon-btn sm" aria-label={t.list.split} title={`${t.list.split} (S)`} onClick={splitSelected}>
            <Split />
          </button>
          <button className="icon-btn sm" aria-label={t.list.merge} title={`${t.list.merge} (M)`} onClick={mergeSelected}>
            <Merge />
          </button>
          <button className="icon-btn sm" aria-label={t.list.delete} title={`${t.list.delete} (⌫)`} onClick={() => deleteSelected(useApp.getState().selection)}>
            <Trash />
          </button>
        </div>
      )}
      {active && <ActiveProgress cue={cue} />}
    </div>
  );
});

const NO_ROWS: (readonly [Cue, number])[] = [];
const NO_ISSUES: IssueKind[] = [];

export function CueList() {
  const doc = useApp((s) => s.doc);
  const selection = useApp((s) => s.selection);
  const settings = useApp((s) => s.settings);
  const translation = useApp((s) => s.translation);
  const loadSubs = useApp((s) => s.loadSubtitleFile);
  const expected = useApp((s) => s.expectedVideo);
  const creating = useApp((s) => s.creatingSubs);
  const editSide = useApp((s) => s.editSide);
  const side: EditSide = translation ? editSide : 'target';
  const cues = doc?.cues;
  const activeIdx = usePlayback((s) => (cues ? cueAt(cues, s.time) : -1));
  const playing = usePlayback((s) => s.playing);
  const followPaused = usePlayback((s) => s.followPaused);
  const setFollowPaused = usePlayback((s) => s.setFollowPaused);
  const [query, setQuery] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  // Checks follow the language edited (the original's when editing it while translating).
  const seen = useMemo(() => (cues ? viewOf(cues, side) : undefined), [cues, side]);
  const issues = useMemo(() => (seen ? collectIssues(seen, settings) : new Map<string, IssueKind[]>()), [seen, settings]);

  const sel = useMemo(() => new Set(selection), [selection]);
  const activeId = activeIdx >= 0 && cues ? cues[activeIdx].id : null;
  const scrollTargetId = playing ? activeId : (selection[selection.length - 1] ?? activeId);
  // "Back" goes where you are: the one subtitle being edited (paused), else the one at the playhead,
  // else the next one after it (playhead in a gap). Several selected: the playhead too.
  const nearId = usePlayback((s) => {
    if (!cues?.length) return null;
    const i = cueAt(cues, s.time);
    if (i >= 0) return cues[i].id;
    const n = nextCueIndex(cues, s.time);
    return (n >= 0 ? cues[n] : cues[cues.length - 1]).id;
  });
  const backId = !playing && selection.length === 1 ? selection[0] : nearId;
  const backIsEdit = !playing && selection.length === 1;

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!cues) return NO_ROWS;
    const all = cues.map((c, i) => [c, i] as const);
    return q ? all.filter(([c]) => c.text.toLowerCase().includes(q) || (c.target ?? '').toLowerCase().includes(q)) : all;
  }, [cues, q]);

  // Only the rows near the view are drawn (thousands would take seconds), between two spacers that
  // keep the list's full height. Heights are measured once drawn, guessed (their average) before.
  const heights = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState(0);
  const [view, setView] = useState({ top: 0, height: 0 });
  const offsets = useMemo(() => {
    // Rows of the same shape (lines of text, a warning or not) have the same height: a row not
    // drawn yet is guessed from the ones of its shape already measured, else from them all.
    const shape = (c: Cue) =>
      `${c.text.split('\n').length + (translation ? (c.target ?? '').split('\n').length : 0)}${settings.showIssues && issues.has(c.id) ? 'w' : ''}`;
    const byShape = new Map<string, [number, number]>();
    let sum = 0;
    let n = 0;
    for (const [c] of visible) {
      const h = heights.current.get(c.id);
      if (h === undefined) continue;
      const k = shape(c);
      const b = byShape.get(k) ?? [0, 0];
      byShape.set(k, [b[0] + h, b[1] + 1]);
      sum += h;
      n++;
    }
    const all = n ? sum / n : translation ? 96 : 66;
    return offsetsOf(
      visible.map(([c]) => {
        const h = heights.current.get(c.id);
        if (h !== undefined) return h;
        const b = byShape.get(shape(c));
        return b ? b[0] / b[1] : all;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, measured, translation, issues, settings.showIssues]);
  const indexOf = useMemo(() => new Map(visible.map(([c], k) => [c.id, k])), [visible]);
  const [start, end] = rangeAt(offsets, view.top, view.height || 900, 600);

  const readView = useCallback(() => {
    const b = scroller.current;
    if (b) setView((v) => (v.top === b.scrollTop && v.height === b.clientHeight ? v : { top: b.scrollTop, height: b.clientHeight }));
  }, []);
  const measure = useCallback((els: Iterable<Element>) => {
    let changed = false;
    for (const el of els) {
      const id = (el as HTMLElement).dataset.id;
      const h = (el as HTMLElement).offsetHeight;
      if (id && h && heights.current.get(id) !== h) {
        heights.current.set(id, h);
        changed = true;
      }
    }
    if (changed) setMeasured((m) => m + 1);
    return changed;
  }, []);
  // Rows change height on their own too (field opened, buttons shown): watched.
  const rowsObserver = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    rowsObserver.current = new ResizeObserver((entries) => measure(entries.map((e) => e.target)));
    return () => rowsObserver.current?.disconnect();
  }, [measure]);
  // After every render on purpose (no dependencies): rows just drawn are measured.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const rows = box.querySelectorAll(':scope > .row');
    const changed = measure(rows);
    // A jump aimed with guessed heights: aim again with the measured ones until the row shows and
    // the heights around it are all known (a change re-renders, and comes back here).
    const a = aim.current;
    const k = a ? indexOf.get(a.id) : undefined;
    if (a && k !== undefined && a.tries-- > 0) {
      const top = scrollFor(offsets, k, box.scrollTop, box.clientHeight, a.block);
      if (top !== null) {
        box.scrollTop = top;
        setView({ top: box.scrollTop, height: box.clientHeight });
      } else if (!changed) aim.current = null;
    } else aim.current = null;
    const ro = rowsObserver.current;
    if (ro) {
      ro.disconnect();
      rows.forEach((el) => ro.observe(el));
    }
  });
  useLayoutEffect(readView, [readView, !!cues]);
  const hasCues = !!cues;
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const ro = new ResizeObserver(readView);
    ro.observe(box);
    return () => ro.disconnect();
  }, [readView, hasCues]);

  const aim = useRef<{ id: string; block: 'center' | 'nearest'; tries: number } | null>(null);
  /** Scrolls a row into view; far away (or `instant`), jumps there and draws it at once. */
  const scrollToRow = useCallback(
    (id: string, block: 'center' | 'nearest', instant = false) => {
      const box = scroller.current;
      const k = indexOf.get(id);
      if (!box || k === undefined) return;
      const top = scrollFor(offsets, k, box.scrollTop, box.clientHeight, block);
      if (top === null) return;
      const jump = instant || Math.abs(top - box.scrollTop) > box.clientHeight * 2;
      box.scrollTo({ top, behavior: jump ? 'auto' : 'smooth' });
      if (!jump) return;
      setView({ top, height: box.clientHeight });
      // Rows on the way were guessed: once the ones drawn there are measured, aim again.
      aim.current = { id, block, tries: 12 };
    },
    [indexOf, offsets],
  );
  // A field opened on a row out of view (Enter, spotting, Insert…): drawn first.
  useEffect(() => {
    setRevealRow((id) => scrollToRow(id, 'nearest', true));
    return () => {
      setRevealRow(null);
    };
  }, [scrollToRow]);

  // Shown only when that subtitle has been scrolled out of view.
  const backIndex = backId ? indexOf.get(backId) : undefined;
  const backVisible = backIndex === undefined || !view.height || rowInView(offsets, backIndex, view.top, view.height);
  const goBack = () => {
    if (backId) scrollToRow(backId, 'center');
    setFollowPaused(false);
  };

  useEffect(() => {
    if (followPaused || !scrollTargetId) return;
    scrollToRow(scrollTargetId, playing ? 'center' : 'nearest');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTargetId, followPaused, playing, selection]);

  if (!cues) {
    return (
      <aside className="list" aria-label={t.list.title}>
        <div className="list-empty">
          <DropZone accept={SUBS_ACCEPT} onFile={loadSubs} className="subs" label={t.drop.subs}>
            <FileIcon />
            <span className="title">{t.drop.subs}</span>
            <span className="muted">
              {t.drop.subsOr} <span className="link">{t.drop.subsBrowse}</span>
            </span>
            <span className="hint">{expected ? t.drop.expected(middleEllipsis(expected.name, 40)) : t.drop.subsHint}</span>
          </DropZone>
        </div>
      </aside>
    );
  }

  return (
    <aside className="list" aria-label={t.list.title}>
      <div className="list-head">
        <span className="list-title">{t.list.title}</span>
        <Pill>{cues.length}</Pill>
        <IssuesButton cues={seen ?? cues} issues={issues} />
        <span className="spacer" />
        <SearchField value={query} onChange={setQuery} label={t.list.search} />
      </div>
      {translation && <EditSideSwitch />}
      <SttProgress />
      <div className="rows" ref={scroller} onWheel={() => setFollowPaused(true)} onTouchMove={() => setFollowPaused(true)} onScroll={readView}>
        {visible.length === 0 && (
          <div className="no-video">
            <WithKeys text={doc.cues.length ? t.list.noMatch : t.list.noCues} />
          </div>
        )}
        {start > 0 && <div style={{ height: offsets[start] }} aria-hidden />}
        {visible.slice(start, end).map(([c, i], k) => (
          <Row
            key={c.id}
            cue={c}
            n={i + 1}
            alt={(start + k) % 2 === 1}
            active={c.id === activeId}
            selected={sel.has(c.id)}
            single={selection.length === 1}
            issues={settings.showIssues ? (issues.get(c.id) ?? NO_ISSUES) : NO_ISSUES}
            translating={!!translation}
            side={side}
            settings={settings}
            locked={creating}
          />
        ))}
        {end < visible.length && <div style={{ height: offsets[visible.length] - offsets[end] }} aria-hidden />}
      </div>
      {followPaused && backId && !backVisible && (
        <button className="btn sm back-to-current" onClick={goBack}>
          {backIsEdit ? t.list.backToSelected : t.list.backToPlayhead}
        </button>
      )}
    </aside>
  );
}

/** Subtitles being created from the audio: a band under the list header (the list is locked meanwhile). */
function SttProgress() {
  const phase = useStt((st) => st.phase);
  const doneMs = useStt((st) => st.doneMs);
  const totalMs = useStt((st) => st.totalMs);
  const startedAt = useStt((st) => st.startedAt);
  if (phase !== 'running') return null;
  return <ProgressBand title={t.stt.running} done={doneMs} total={totalMs} show="percent" startedAt={startedAt} onStop={stopStt} note={t.stt.lockedNote} />;
}

/** While translating: which language the list, the tools and the picture work on (⌥T switches, even while typing). */
function EditSideSwitch() {
  const translation = useApp((s) => s.translation)!;
  const lang = useApp((s) => s.doc?.lang);
  const side = useApp((s) => s.editSide);
  const source = translation.sourceLang ?? (lang && lang !== translation.targetLang ? lang : null);
  const names: Record<EditSide, string> = { source: source ? languageName(source) : t.translate.original, target: languageName(translation.targetLang) };
  const pick = (k: EditSide) => (
    <button className="btn sm toggle" aria-pressed={side === k} title={t.translate.editingHint} onClick={() => switchEditSide(k)}>
      {names[k]}
    </button>
  );
  return (
    <div className="edit-side" role="group" aria-label={t.translate.editing}>
      <span className="muted">{t.translate.editing}</span>
      <span className="spacer" />
      {pick('source')}
      <button className="icon-btn sm" aria-label={t.translate.swap} title={t.translate.editingHint} onClick={() => switchEditSide()}>
        <SwapIcon />
      </button>
      {pick('target')}
    </div>
  );
}
