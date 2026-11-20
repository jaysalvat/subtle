/**
 * Tools › Sign the subtitles: the subtitler's or translator's lines, a few seconds after the start or
 * after the last subtitle (lib/sign.ts), shown on the timeline as you type. Each block has the row's
 * look buttons (italics, capitals, top…); the blocks are kept for the next files (settings.signatures).
 * Nothing is kept in the file until Sign (one undo step); Cancel puts it back.
 */
import { useEffect, useMemo, useRef } from 'react';
import { t } from '../i18n';
import { colourOf, editableText, isBold, isItalic, setBold, setColour, setItalic, withEditedText } from '../lib/markup';
import { creditsStart } from '../lib/credits';
import { filledSignatures, sign, type Signature } from '../lib/sign';
import { isUpperCase, toggleCase } from '../lib/textCase';
import { goToCue } from '../actions';
import { usePlayback } from '../store/playback';
import { useApp } from '../store/store';
import { useThumbs } from '../store/thumbs';
import { Alert } from './Alert';
import { FormatButtons } from './FormatButtons';
import { Trash } from './Icons';
import { NumberInput } from './NumberInput';
import { SidePanel } from './SidePanel';

const EMPTY: Signature = { text: '', top: false, from: 'start', afterMs: 2000 };
/** Nothing kept yet: one empty block to fill (a constant, so the preview isn't redone each render). */
const FIRST = [EMPTY];

export function SignPanel() {
  const doc = useApp((s) => s.doc)!;
  const settings = useApp((s) => s.settings);
  const translating = useApp((s) => !!s.translation);
  const base = useRef(doc.cues).current;
  // The end credits, from the filmstrip's pictures once they're all read (their arrays are final then).
  const thumbs = useThumbs((s) => s.status);
  const duration = usePlayback((s) => s.duration);
  const creditsMs = useMemo(() => {
    const { times, colors } = useThumbs.getState();
    return thumbs === 'ready' && duration ? creditsStart(times, colors, duration) : null;
  }, [thumbs, duration]);
  const creditsLabel = creditsMs !== null ? t.sign.from.credits : thumbs === 'reading' ? t.sign.creditsReading : t.sign.creditsNone;
  const blocks = settings.signatures.length ? settings.signatures : FIRST;
  const save = (next: Signature[]) => useApp.getState().setSettings({ signatures: next });
  const change = (i: number, patch: Partial<Signature>) => save(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const result = useMemo(
    () =>
      sign(base, blocks, {
        minGapMs: settings.minGapMs,
        minDurationMs: settings.minDurationMs,
        cpsBased: settings.cpsBasedMinDuration,
        maxCps: settings.maxCps,
        format: doc.format,
        translating,
        creditsMs,
        filmEndMs: duration,
      }),
    [base, blocks, settings.minGapMs, settings.minDurationMs, settings.cpsBasedMinDuration, settings.maxCps, doc.format, translating, creditsMs, duration],
  );
  const filled = filledSignatures(blocks).length;
  useEffect(() => useApp.getState().previewLive(base, result.cues), [base, result]);

  const close = () => useApp.getState().openDialog(null);
  const cancel = () => {
    useApp.getState().replaceLive(base);
    close();
  };
  const apply = () => {
    const st = useApp.getState();
    st.previewLive(base, result.cues);
    st.endGesture(base, t.tools.sign);
    close();
    // Going there selects the first one: the others are added after.
    if (result.added[0]) goToCue(result.added[0]);
    useApp.setState({ selection: result.added });
  };

  return (
    <SidePanel title={t.tools.sign} onClose={cancel} closeLabel={t.common.cancel}>
      <div className="side-body">
        {result.moved.length > 0 && <Alert>{t.sign.moved(result.moved.length)}</Alert>}
        <p className="note">{t.sign.intro}</p>
        <div className="sign-blocks">
          {blocks.map((b, i) => (
            <div key={i} className="sign-block">
              <textarea
                className={`input sign-text ${isItalic(b.text) ? 'italic' : ''} ${isBold(b.text) ? 'bold' : ''}`}
                rows={2}
                value={editableText(b.text)}
                placeholder={t.sign.placeholder}
                style={colourOf(b.text) ? { color: colourOf(b.text)! } : undefined}
                onChange={(e) => change(i, { text: withEditedText(b.text, e.target.value) })}
              />
              <div className="sign-row">
                <NumberInput value={b.afterMs / 1000} step={1} min={0} label={t.sign.after} onChange={(v) => change(i, { afterMs: Math.round(v * 1000) })} />
                <span className="dim">{t.sign.after}</span>
                <select className="select" value={b.from} onChange={(e) => change(i, { from: e.target.value as Signature['from'] })}>
                  <option value="start">{t.sign.from.start}</option>
                  <option value="end">{t.sign.from.end}</option>
                  <option value="credits" disabled={creditsMs === null}>
                    {creditsLabel}
                  </option>
                </select>
                <span className="spacer" />
                <FormatButtons
                  bold={isBold(b.text)}
                  italic={isItalic(b.text)}
                  upper={!!editableText(b.text).trim() && isUpperCase(b.text)}
                  colour={colourOf(b.text)}
                  top={b.top}
                  onBold={() => change(i, { text: setBold(b.text, !isBold(b.text)) })}
                  onItalic={() => change(i, { text: setItalic(b.text, !isItalic(b.text)) })}
                  onCase={() => change(i, { text: toggleCase(b.text, doc.lang) })}
                  onColour={(c) => change(i, { text: setColour(b.text, c) })}
                  onTop={() => change(i, { top: !b.top })}
                  ownColours
                />
                <button
                  className="icon-btn sm"
                  aria-label={t.sign.remove}
                  title={t.sign.remove}
                  disabled={blocks.length === 1 && !b.text}
                  onClick={() => save(blocks.filter((_, j) => j !== i))}
                >
                  <Trash />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button className="btn sign-add" onClick={() => save([...blocks, { ...EMPTY, from: blocks.at(-1)?.from ?? 'start' }])}>
          {t.sign.add}
        </button>
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={cancel}>
          {t.common.cancel}
        </button>
        <button className="btn primary" disabled={!filled} onClick={apply}>
          {t.sign.apply}
        </button>
      </div>
    </SidePanel>
  );
}
