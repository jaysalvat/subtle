/**
 * Tools › Sync from a reference file: well-timed subtitles of the same film (another language, another
 * release) put these right — the offset and speed of the whole file, then each subtitle on the
 * reference's edges (`syncToReference`). A side panel with a live preview on the timeline; nothing is
 * kept until Apply (one undo step), Cancel puts them back.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { decodeSubtitleBytes } from '../lib/encoding';
import { middleEllipsis } from '../lib/filename';
import { parseSubtitles } from '../lib/formats';
import { fpsLabel } from '../lib/fps';
import { formatOffset } from '../lib/sync';
import { fitWhole, refSpans, syncToReference } from '../lib/syncRef';
import { scopeFilter, type ShiftScope } from '../lib/tools';
import type { Cue } from '../lib/types';
import { useApp } from '../store/store';
import { Scope } from './dialogs/Dialog';
import { DropZone, SUBS_ACCEPT, isSubtitleFile } from './DropZone';
import { FileIcon } from './Icons';
import { NumberInput } from './NumberInput';
import { SidePanel } from './SidePanel';

export function SyncRefPanel() {
  const doc = useApp((s) => s.doc)!;
  const settings = useApp((s) => s.settings);
  const base = useRef(doc.cues).current;
  // The selection as it is now: it can change while the panel is open.
  const selected = useApp((s) => s.selection);
  const [ref, setRef] = useState<{ name: string; cues: Cue[] } | null>(null);
  const [whole, setWhole] = useState(true);
  const [each, setEach] = useState(true);
  const [maxS, setMaxS] = useState(1);
  const [starts, setStarts] = useState(true);
  const [ends, setEnds] = useState(true);
  const [scope, setScope] = useState<ShiftScope>('all');

  const ids = useMemo(() => (scope === 'all' ? undefined : base.filter(scopeFilter(base, scope, selected)).map((c) => c.id)), [base, scope, selected]);
  // Step 1 only changes with the file and the scope.
  const fit = useMemo(() => {
    if (!ref) return null;
    const set = ids ? new Set(ids) : null;
    return fitWhole(
      base.filter((c) => !set || set.has(c.id)),
      refSpans(ref.cues),
    );
  }, [base, ref, ids]);
  const result = useMemo(
    () =>
      ref
        ? syncToReference(
            base,
            ref.cues,
            { whole, each, maxMs: Math.round(maxS * 1000), starts, ends, gapMs: settings.minGapMs, floorMs: settings.floorDurationMs },
            ids,
            { fit },
          )
        : null,
    [base, ref, whole, each, maxS, starts, ends, settings.minGapMs, settings.floorDurationMs, ids, fit],
  );
  const moved = result?.moved.length ?? 0;
  const preview = result && moved ? result.cues : base;
  useEffect(() => useApp.getState().previewLive(base, preview), [base, preview]);

  const open = async (file: File) => {
    const cues = isSubtitleFile(file) ? parseSubtitles(file.name, decodeSubtitleBytes(await file.arrayBuffer()).text).cues : [];
    if (!cues.length) return useApp.getState().notify(t.syncRef.notSubs(file.name), { tone: 'warning' });
    setRef({ name: file.name, cues });
  };
  const close = () => useApp.getState().openDialog(null);
  const cancel = () => {
    useApp.getState().replaceLive(base);
    close();
  };
  const apply = () => {
    if (!result) return;
    const st = useApp.getState();
    st.previewLive(base, result.cues);
    st.endGesture(base, t.tools.syncRef);
    close();
  };

  return (
    <SidePanel title={t.tools.syncRef} onClose={cancel} closeLabel={t.common.cancel}>
      <div className="side-body">
        <DropZone accept={SUBS_ACCEPT} onFile={(f) => void open(f)} className="subs ref-drop" label={t.syncRef.choose} own>
          <FileIcon color="var(--text-muted)" />
          {ref ? (
            <>
              <span className="title">{middleEllipsis(ref.name, 36)}</span>
              <span className="muted">
                {t.projects.cueCount(ref.cues.length)} · <span className="link">{t.syncRef.change}</span>
              </span>
            </>
          ) : (
            <>
              <span className="title">{t.syncRef.drop}</span>
              <span className="muted">
                {t.drop.subsOr} <span className="link">{t.drop.subsBrowse}</span>
              </span>
              <span className="hint">{t.syncRef.dropHint}</span>
            </>
          )}
        </DropZone>

        {ref && whole && (
          <p className="note flush">
            {fit
              ? t.syncRef.fit(formatOffset(fit.offset), fit.scale !== 1 ? t.fps.convert(fpsLabel(fit.fps.from), fpsLabel(fit.fps.to)) : null)
              : t.syncRef.noMatch}
          </p>
        )}
        <label className="check">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
          <span>{t.syncRef.whole}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={each} onChange={(e) => setEach(e.target.checked)} />
          <span>{t.syncRef.each}</span>
        </label>
        {each && (
          <>
            <div className="align-edges">
              <label className="check">
                <input type="checkbox" checked={starts} onChange={(e) => setStarts(e.target.checked)} />
                <span>{t.align.starts}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={ends} onChange={(e) => setEnds(e.target.checked)} />
                <span>{t.align.ends}</span>
              </label>
            </div>
            <div className="field">
              <label>{t.align.maxMove}</label>
              <NumberInput value={maxS} onChange={setMaxS} step={0.1} min={0.1} max={5} label={t.align.maxMoveLabel} />
            </div>
          </>
        )}
        <Scope value={scope} onChange={setScope} />
        {ref && <div className="summary">{t.syncRef.summary(moved)}</div>}
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={cancel}>
          {t.common.cancel}
        </button>
        <button className="btn primary" disabled={!moved} onClick={apply}>
          {t.syncRef.apply(moved)}
        </button>
      </div>
    </SidePanel>
  );
}
