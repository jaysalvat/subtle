import { describe, expect, it } from 'vitest';
import { VoiceBandFilter } from './audio/filter';
import { addAudio, createPeaks, toWaveform, touchRecent } from './audio/peaks';
import { DEFAULT_SPANS, downsample, speechMask, speechSpans, speechWaveform } from './audio/speech';
import { byTime, defaultLabel, nextMark, nextSlot } from './bookmarks';
import { decodeSubtitleBytes } from './encoding';
import { engineLangCandidates, fitLines, mtInput, mtOutput } from './mt';
import { aiBatches, aiItems, aiSystemPrompt, aiUserPrompt, parseAiReply, translationModels, isCloudModel } from './mtAi';
import { countOverlaps, looksForced, mergeCues, prepareIncoming } from './merge';
import { isLangCode, langFromFileName, langFromTrack, languageName } from './languages';
import { adoptTranslation, matchTranslation, untranslatedCount } from './translation';
import { audit, CONVENTIONS, fixAll, fixDurations, fixGaps, fixLines, framesToMs, profileFor, PROFILES } from './audit';
import { isUpperCase, toggleCase, toSentenceCase } from './textCase';
import { boxesFromMap, ctcDecode, ocrText } from './ocr';
import { sttWindows, wordsToCues } from './stt';
import { DEFAULT_REPLACE, findReplace, type ReplaceOptions } from './replace';
import { DEFAULT_PUNCT, fixPunctuation, fixPunctuationText, NBSP, NNBSP, netflixPunct, punctStyleFor, type PunctOptions } from './punctuation';
import { editableText, isItalic, setItalic, withEditedText } from './markup';
import { isTop, setPosition } from './position';
import { cleanFileName, defaultExportName } from './filename';
import { freeSpot, sign, signatureDuration } from './sign';
import { CREDITS_OPTIONS, creditsStart, luma } from './credits';
import { loopAround, loopAt, loopRange, loopStep } from './loop';
import { applySync, formatOffset, pickLine, solveSync } from './sync';
import { conversionsFor, convertFps, fpsLabel, FPS_CONVERSIONS, NO_CONVERSION, rankConversions, speechActivity, syncScore, videoFrameRate } from './fps';
import { thumbAt, thumbGapMs } from './thumbs';
import { keyParts } from './keys';
import { offsetsOf, rangeAt, rowInView, scrollFor } from './windowing';
import { menuColumns } from './menu';
import { isMkvFile, isSubtitleFile, isVideoFile } from './files';
import { mkvCues, readMkvInfo, readMkvSubs, trackLabel } from './mkv';
import { parseSrt, parseVtt, serializeSrt, serializeVtt } from './formats';
import { formatSrtTime, parseTimestamp, parseUserTime } from './time';
import {
  applyLinear,
  cleanHiText,
  cleanHi,
  collectIssues,
  followSelection,
  cueAt,
  DEFAULT_HI_RULES,
  extendToMinDuration,
  fpsScale,
  insertCueAt,
  linearFromAnchors,
  mergeWithNext,
  nudgeEnds,
  prevCueTarget,
  retime,
  shiftCues,
  splitCue,
} from './tools';
import { DEFAULT_SETTINGS, type Cue } from './types';

const S = DEFAULT_SETTINGS;
const cue = (start: number, end: number, text = 'x', id = `${start}`): Cue => ({ id, start, end, text });

describe('time', () => {
  it('parses SRT and VTT timestamps', () => {
    expect(parseTimestamp('00:01:02,345')).toBe(62345);
    expect(parseTimestamp('01:02.5')).toBe(62500);
    expect(parseTimestamp('1:00:00.000')).toBe(3600000);
    expect(parseTimestamp('nope')).toBeNaN();
    expect(formatSrtTime(3723004)).toBe('01:02:03,004');
  });
});

describe('SRT', () => {
  it('parses messy files and round-trips', () => {
    const src =
      '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n<i>world</i>\r\n\r\n\r\n7\r\n00:00:03,000 --> 00:00:04,000\r\n{\\an8}Top\r\n3\r\n00:00:05.000 --> 00:00:06.000\r\nNo blank line before';
    const doc = parseSrt(src);
    expect(doc.cues).toHaveLength(3);
    expect(doc.cues[0].text).toBe('Hello\n<i>world</i>');
    expect(doc.cues[1].text).toBe('{\\an8}Top');
    expect(doc.cues[2].start).toBe(5000);
    const out = serializeSrt(doc.cues);
    expect(out).toContain('2\n00:00:03,000 --> 00:00:04,000\n{\\an8}Top');
    expect(parseSrt(out).cues.map((c) => c.text)).toEqual(doc.cues.map((c) => c.text));
  });
});

describe('export', () => {
  it('skips cues without text', () => {
    const out = serializeSrt([cue(0, 1000, 'a', 'a'), { ...cue(2000, 3000, '', 'b') }, { ...cue(4000, 5000, 'c', 'c'), target: 'C' }], false);
    expect(out).toBe('1\n00:00:00,000 --> 00:00:01,000\na\n\n2\n00:00:04,000 --> 00:00:05,000\nc\n');
  });
});

describe('VTT', () => {
  it('keeps settings, ids and NOTE blocks', () => {
    const src = 'WEBVTT - test\n\nNOTE hello\n\nintro\n00:01.000 --> 00:02.000 line:10% align:start\nHi\n\n00:00:03.000 --> 00:00:04.000\nThere';
    const doc = parseVtt(src);
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0].vttSettings).toBe('line:10% align:start');
    expect(doc.cues[0].vttId).toBe('intro');
    const out = serializeVtt(doc);
    expect(out.startsWith('WEBVTT - test\n\nNOTE hello\n\nintro\n00:00:01.000 --> 00:00:02.000 line:10% align:start\nHi')).toBe(true);
  });
});

describe('encoding', () => {
  it('falls back to Windows-1252', () => {
    const bytes = new Uint8Array([0x45, 0x74, 0xe9]); // "Eté" in cp1252
    expect(decodeSubtitleBytes(bytes)).toEqual({ text: 'Eté', encoding: 'windows-1252' });
    expect(decodeSubtitleBytes(new TextEncoder().encode('Été')).encoding).toBe('utf-8');
  });
});

describe('navigation', () => {
  const cues = [cue(1000, 2000), cue(3000, 4000), cue(5000, 6000)];
  it('finds the active cue', () => {
    expect(cueAt(cues, 3500)).toBe(1);
    expect(cueAt(cues, 2500)).toBe(-1);
  });
  it('previous behaves like a music player', () => {
    expect(prevCueTarget(cues, 3800)).toBe(1); // > 500 ms in: restart
    expect(prevCueTarget(cues, 3200)).toBe(0); // early: previous
    expect(prevCueTarget(cues, 4500)).toBe(1); // in a gap: last one before
  });
});

describe('shift & sync', () => {
  it('shifts and clamps at zero', () => {
    const out = shiftCues([cue(500, 1000), cue(2000, 3000)], -1000);
    expect(out[0]).toMatchObject({ start: 0, end: 0 });
    expect(out[1]).toMatchObject({ start: 1000, end: 2000 });
  });
  it('shifts from the selected cue onwards', () => {
    const out = shiftCues([cue(1000, 2000, 'a', 'a'), cue(3000, 4000, 'b', 'b'), cue(5000, 6000, 'c', 'c')], 500, 'fromSelected', ['b']);
    expect(out.map((c) => c.start)).toEqual([1000, 3500, 5500]);
  });
  it('two-point sync computes scale and offset', () => {
    const { scale, offset } = linearFromAnchors({ from: 1000, to: 2000 }, { from: 11000, to: 22000 });
    expect(scale).toBeCloseTo(2);
    expect(offset).toBeCloseTo(0);
    expect(applyLinear([cue(1000, 2000)], scale, offset)[0]).toMatchObject({ start: 2000, end: 4000 });
    expect(fpsScale(25, 23.976)).toBeCloseTo(1.0427, 3);
  });
});

describe('durations', () => {
  it('extends to the minimum without touching the start, capped by the next cue', () => {
    const cues = [cue(0, 500, 'a', 'a'), cue(1000, 1200, 'b', 'b'), cue(5000, 7000, 'c', 'c')];
    const r = extendToMinDuration(cues, { minMs: 1500, gapMs: 80, cpsBased: false, maxCps: 17 });
    expect(r.cues.map((c) => [c.start, c.end])).toEqual([
      [0, 920],
      [1000, 2500],
      [5000, 7000],
    ]);
    expect(r.blocked).toEqual(['a']);
    expect(r.extended).toEqual(['a', 'b']);
  });
  it('nudges ends within limits', () => {
    const cues = [cue(0, 1000, 'a', 'a'), cue(1150, 2000, 'b', 'b')];
    expect(nudgeEnds(cues, ['a'], 100, S)[0].end).toBe(1070);
    expect(nudgeEnds([cue(0, 350, 'a', 'a')], ['a'], -100, S)[0].end).toBe(300);
  });
  it('retimes without overlapping', () => {
    const cues = [cue(0, 1000, 'a', 'a'), cue(2000, 3000, 'b', 'b'), cue(4000, 5000, 'c', 'c')];
    expect(retime(cues, 'b', 'start', 500, S)[1].start).toBe(1080);
    expect(retime(cues, 'b', 'end', 9000, S)[1].end).toBe(3920);
    expect(retime(cues, 'b', 'move', 3500, S)[1]).toMatchObject({ start: 2920, end: 3920 });
    // Manual drag pushes the neighbour (gap and its floor duration kept).
    const ps = retime(cues, 'b', 'start', 500, S, true);
    expect([ps[0].end, ps[1].start]).toEqual([500 - S.minGapMs, 500]);
    // Never past the neighbour's floor duration.
    const far = retime(cues, 'b', 'start', 100, S, true);
    expect([far[0].end, far[1].start]).toEqual([S.floorDurationMs, S.floorDurationMs + S.minGapMs]);
    const pe = retime(cues, 'b', 'end', 4500, S, true);
    expect(pe[2].start - pe[1].end).toBe(S.minGapMs);
    expect(pe[2].start).toBeGreaterThan(cues[2].start);
  });
});

describe('insert / split / merge', () => {
  it('inserts at the playhead, after the current cue when inside one', () => {
    const cues = [cue(0, 1000, 'a', 'a'), cue(2000, 3000, 'b', 'b')];
    const r = insertCueAt(cues, 500, S)!;
    const added = r.cues.find((c) => c.id === r.id)!;
    expect(added).toMatchObject({ start: 1080, end: 1920 });
    expect(insertCueAt(cues, 1950, S)).toBeNull(); // no room
  });
  it('splits on the middle line break and merges back', () => {
    const r = splitCue([cue(0, 2000, 'Line one\nLine two', 'a')], 'a', 1000, S)!;
    expect(r.cues.map((c) => c.text)).toEqual(['Line one', 'Line two']);
    expect(r.cues[0].end).toBe(960);
    expect(r.cues[1].start).toBe(1040);
    const merged = mergeWithNext(r.cues, 'a');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ start: 0, end: 2000, text: 'Line one Line two' });
    // A dialogue line keeps its own line.
    const dlg = mergeWithNext(
      [
        { id: 'x', start: 0, end: 1000, text: '- Hi.' },
        { id: 'y', start: 1000, end: 2000, text: '- Hello.' },
      ],
      'x',
    );
    expect(dlg[0].text).toBe('- Hi.\n- Hello.');
  });
});

describe('HI cleanup', () => {
  const R = DEFAULT_HI_RULES;
  it('removes brackets, parentheses, music and speakers', () => {
    expect(cleanHiText('[door slams]', R)).toBe('');
    expect(cleanHiText('(laughs) Okay.', R)).toBe('Okay.');
    expect(cleanHiText('♪ la la la ♪', R)).toBe('');
    expect(cleanHiText('JOHN: Where were you?', R)).toBe('Where were you?');
    expect(cleanHiText('- MAN 1: Run!\n- Why?', R)).toBe('- Run!\n- Why?');
  });
  it('removes orphan dialogue dashes and keeps tags', () => {
    expect(cleanHiText('- [gasps]\n- What?', R)).toBe('What?');
    expect(cleanHiText('{\\an8}<i>[thunder]</i>\nHello', R)).toBe('{\\an8}<i></i>Hello');
    expect(cleanHiText('<i>Hello (sighs)</i>', R)).toBe('<i>Hello</i>');
  });
  it('drops cues that become empty', () => {
    const r = cleanHi([cue(0, 1000, '[door slams]', 'a'), cue(2000, 3000, 'Hi', 'b')], R);
    expect(r.removed).toEqual(['a']);
    expect(r.cues).toHaveLength(1);
  });
  it('leaves normal text alone, all-caps rule is opt-in', () => {
    expect(cleanHiText('Time: 10 a.m.', R)).toBe('Time: 10 a.m.');
    expect(cleanHiText('OK', R)).toBe('OK');
    expect(cleanHiText('GUNSHOTS', { ...R, allCapsLines: true })).toBe('');
  });
});

describe('issues', () => {
  const cues = [cue(0, 500, 'Hi', 'a'), cue(400, 3000, '[door slams]', 'b'), cue(4000, 6000, 'Fine', 'c')];
  it('lists issues per cue and leaves clean cues out', () => {
    const m = collectIssues(cues, S);
    expect(m.get('a')).toEqual(['overlap', 'tooShort']);
    expect(m.get('b')).toEqual(['hi']);
    expect(m.has('c')).toBe(false);
  });
  it('ignores the kinds the user turned off', () => {
    const m = collectIssues(cues, { ...S, hiddenIssueKinds: ['tooShort', 'hi'] });
    expect(m.get('a')).toEqual(['overlap']);
    expect(m.has('b')).toBe(false);
  });
});

describe('files', () => {
  it('opens MP4, MOV, MKV and WebM', () => {
    expect(isVideoFile({ name: 'film.mp4', type: 'video/mp4' })).toBe(true);
    expect(isVideoFile({ name: 'film.MOV', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'film.webm', type: 'video/webm' })).toBe(true);
    expect(isVideoFile({ name: 'film.mkv', type: 'video/x-matroska' })).toBe(true);
    expect(isVideoFile({ name: 'film', type: 'video/x-matroska' })).toBe(true);
    expect(isMkvFile({ name: 'Film.MKV', type: '' })).toBe(true);
    expect(isMkvFile({ name: 'film.mp4', type: 'video/mp4' })).toBe(false);
    expect(isVideoFile({ name: 'film.avi', type: 'video/x-msvideo' })).toBe(false);
  });
  it('recognises subtitle files', () => {
    expect(isSubtitleFile({ name: 'a.en.srt' })).toBe(true);
    expect(isSubtitleFile({ name: 'a.VTT' })).toBe(true);
    expect(isSubtitleFile({ name: 'a.ass' })).toBe(true);
    expect(isSubtitleFile({ name: 'a.txt' })).toBe(false);
  });
});

describe('audio peaks', () => {
  it('keeps one min/max pair per 10 ms bucket, mono mix', () => {
    const p = createPeaks(30); // 3 buckets
    const left = new Float32Array(30);
    const right = new Float32Array(30);
    left[3] = 1; // bucket 0: mono 0.5
    right[15] = -1; // bucket 1: mono -0.5
    addAudio(p, [left, right], 1000, 0); // 10 frames per bucket
    expect([p.min[0], p.max[0]]).toEqual([0, 0.5]);
    expect([p.min[1], p.max[1]]).toEqual([-0.5, 0]);
    expect([p.min[2], p.max[2]]).toEqual([0, 0]);
  });
  it('places chunks by their start frame and merges a bucket split across chunks', () => {
    const p = createPeaks(30);
    addAudio(p, [new Float32Array(5).fill(0.25)], 1000, 10); // frames 10-14 -> bucket 1
    addAudio(p, [new Float32Array(5).fill(-0.5)], 1000, 15); // frames 15-19 -> bucket 1
    expect([p.min[1], p.max[1]]).toEqual([-0.5, 0.25]);
    expect(p.max[0]).toBe(0);
  });
  it('ignores audio past the end', () => {
    const p = createPeaks(10);
    addAudio(p, [new Float32Array(50).fill(1)], 1000, 0);
    expect(p.max.length).toBe(1);
    expect(p.max[0]).toBe(1);
  });
});

describe('waveform normalisation', () => {
  it('scales a quiet film up so its loud parts reach 90 % of the height', () => {
    const p = createPeaks(10_000); // 1000 buckets
    p.max.fill(0.1);
    p.min.fill(-0.1);
    const w = toWaveform(p);
    expect(w.max[0]).toBe(114); // 0.9 * 127
    expect(w.min[0]).toBe(-114);
  });
  it('is not flattened by one very loud moment', () => {
    const p = createPeaks(10_000);
    p.max.fill(0.1);
    p.max[500] = 1; // one explosion
    const w = toWaveform(p);
    expect(w.max[0]).toBe(114);
    expect(w.max[500]).toBe(127); // clipped
  });
  it('keeps silence flat', () => {
    const w = toWaveform(createPeaks(1000));
    expect(Math.max(...w.max)).toBe(0);
  });
});

describe('waveform cache list', () => {
  it('puts the latest film first and evicts the oldest past the cap', () => {
    expect(touchRecent(['b', 'a'], 'c', 2)).toEqual({ list: ['c', 'b'], evicted: ['a'] });
    expect(touchRecent(['b', 'a'], 'a', 2)).toEqual({ list: ['a', 'b'], evicted: [] });
  });
});

describe('voice band filter', () => {
  const sr = 48000;
  const sine = (hz: number, n = sr) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / sr));
  const peakAfter = (x: Float32Array) => Math.max(...Array.from(x.subarray(x.length / 2)).map(Math.abs)); // skip the settling part
  it('lets speech frequencies through', () => {
    expect(peakAfter(new VoiceBandFilter(sr).process(sine(1000)))).toBeGreaterThan(0.85);
  });
  it('attenuates rumble and high frequencies', () => {
    expect(peakAfter(new VoiceBandFilter(sr).process(sine(50)))).toBeLessThan(0.1);
    expect(peakAfter(new VoiceBandFilter(sr).process(sine(12000)))).toBeLessThan(0.1);
  });
  it('gives the same result when fed in chunks', () => {
    const x = sine(440, 4800);
    const whole = new VoiceBandFilter(sr).process(x);
    const f = new VoiceBandFilter(sr);
    const parts = [f.process(x.subarray(0, 1000)), f.process(x.subarray(1000))];
    expect(Array.from(parts[1].subarray(0, 5))).toEqual(Array.from(whole.subarray(1000, 1005)));
  });
});

describe('filmstrip', () => {
  it('spaces thumbnails 2 s apart, or more for long films', () => {
    expect(thumbGapMs(60_000)).toBe(2000);
    expect(thumbGapMs(7_200_000)).toBe(12_000); // 2 h -> 600 thumbnails
  });
  it('shows the last thumbnail at or before a time', () => {
    const times = [0, 2000, 4000];
    expect(thumbAt(times, 3999)).toBe(1);
    expect(thumbAt(times, 4000)).toBe(2);
    expect(thumbAt(times, -10)).toBe(0);
  });
});

describe('frame rate guess', () => {
  // 30 min of subtitles: 2 s on, 3 s off.
  const subs = Array.from({ length: 360 }, (_, i) => cue(i * 5000, i * 5000 + 2000, 'x', `c${i}`));
  /** Activity with speech exactly where `cues` are, in 100 ms bins. */
  const speechAt = (cues: Cue[]) => {
    const a = new Float32Array(Math.ceil(cues[cues.length - 1].end / 100) + 600);
    for (const c of cues) for (let i = Math.floor(c.start / 100); i < c.end / 100; i++) a[i] = 100;
    return a;
  };

  it('scores subtitles on speech higher than off speech', () => {
    const act = speechAt(subs);
    expect(syncScore(subs, act)).toBeGreaterThan(90);
    expect(
      syncScore(
        subs.map((c) => ({ ...c, start: c.start + 2500, end: c.end + 2500 })),
        act,
      ),
    ).toBeLessThan(0);
  });
  it('ranks the right conversion first', () => {
    const c = FPS_CONVERSIONS.find((x) => x.id === '23.976>25')!;
    const act = speechAt(convertFps(subs, c)); // the video is the 25 fps release
    expect(rankConversions(subs, act)[0].id).toBe('23.976>25');
  });
  it('ranks "no conversion" first when subtitles already match', () => {
    expect(rankConversions(subs, speechAt(subs))[0]).toBe(NO_CONVERSION);
  });
  it('keeps the usual order without audio', () => {
    expect(rankConversions(subs, null).map((c) => c.id)).toEqual(['none', ...FPS_CONVERSIONS.map((c) => c.id)]);
  });
  it('averages the waveform into 100 ms activity bins', () => {
    const w = { bucketsPerSecond: 100, min: new Int8Array(20).fill(-50), max: new Int8Array(20).fill(100) };
    expect(Array.from(speechActivity(w))).toEqual([100, 100]);
  });
});

describe('sync assistant', () => {
  it('one anchor gives a constant offset, even a large one', () => {
    const r = solveSync({ from: 10_000, to: 100_000 });
    expect(r).toEqual({ scale: 1, offset: 90_000 });
    expect(applySync([cue(10_000, 12_000)], r)[0]).toMatchObject({ start: 100_000, end: 102_000 });
  });
  it('two anchors give offset and speed', () => {
    const r = solveSync({ from: 0, to: 1000 }, { from: 100_000, to: 111_000 });
    expect(r.scale).toBeCloseTo(1.1);
    expect(r.offset).toBe(1000);
    expect(r.fps).toBeUndefined();
  });
  it('snaps a speed close to a frame rate conversion and says which', () => {
    // Made for 23.976, video at 25: x0.95904. Tapped a bit off: x0.9595.
    const r = solveSync({ from: 60_000, to: 62_000 }, { from: 3_600_000, to: 62_000 + 3_540_000 * 0.9595 });
    expect(r.fps?.id).toBe('23.976>25');
    expect(r.scale).toBeCloseTo(24000 / 1001 / 25, 10);
    expect(r.offset + r.scale * 60_000).toBeCloseTo(62_000); // first anchor stays exact
  });
  it('picks a clear line to listen for', () => {
    const cues = [cue(0, 500, 'Hi', 'a'), cue(1000, 3000, '[door slams]', 'b'), cue(4000, 6000, 'Where were you last night?', 'c')];
    expect(pickLine(cues, 0)).toBe(2);
  });
  it('formats offsets for people', () => {
    expect(formatOffset(2300)).toBe('+2.3 s');
    expect(formatOffset(-83_400)).toBe('−1:23.4');
  });
});

describe('video frame rate', () => {
  it('measures and snaps to the usual values', () => {
    expect(fpsLabel(videoFrameRate(134_865, 5_625_000)!)).toBe('23.976'); // 1 h 33 at 23.976
    expect(videoFrameRate(2500, 100_000)).toBe(25);
    expect(videoFrameRate(1, 1000)).toBeNull();
  });
  it('only offers conversions that end at the video frame rate', () => {
    expect(conversionsFor(25).map((c) => c.id)).toEqual(['23.976>25', '24>25']);
    expect(conversionsFor(null)).toHaveLength(6);
    expect(conversionsFor(30000 / 1001).map((c) => c.id)).toEqual(['25>23.976', '24>23.976']); // NTSC video of a 23.976 film
    expect(conversionsFor(30).map((c) => c.id)).toEqual(['25>24', '23.976>24']);
    expect(conversionsFor(50).map((c) => c.id)).toEqual(['23.976>25', '24>25']);
    expect(conversionsFor(12)).toHaveLength(6); // nothing ends there: offer them all
  });
});

describe('playback loop', () => {
  it('loops a subtitle with a margin, following its timing', () => {
    expect(loopRange({ cue: 'a' }, [cue(5000, 7000, 'x', 'a')])).toEqual({ from: 4000, to: 8000 });
    expect(loopRange({ cue: 'gone' }, [cue(5000, 7000, 'x', 'a')])).toBeNull();
  });
  it('loops 3 s around a moment, never before 0', () => {
    expect(loopAround(10_000)).toEqual({ from: 7000, to: 13_000 });
    expect(loopAround(1000)).toEqual({ from: 0, to: 4000 });
  });
  it('wraps at the end, moves when you jump elsewhere', () => {
    const r = { from: 4000, to: 8000 };
    expect(loopStep(r, 6000)).toBeNull();
    expect(loopStep(r, 8010)).toBe('wrap');
    expect(loopStep(r, 20_000)).toBe('move');
    expect(loopStep(r, 1000)).toBe('move');
  });
  it('follows you: subtitle to subtitle, else 3 s around where you land', () => {
    expect(loopAt({ cue: 'a' }, 20_000, 'b')).toEqual({ cue: 'b' });
    expect(loopAt({ cue: 'a' }, 20_000, null)).toEqual({ from: 17_000, to: 23_000 });
    expect(loopAt({ from: 0, to: 6000 }, 20_000, 'b')).toEqual({ from: 17_000, to: 23_000 });
  });
});

describe('bookmarks', () => {
  const bm = (slot: number, time: number) => ({ id: `b${slot}`, slot, time, label: '' });
  it('takes the lowest free number, so numbers never shift', () => {
    expect(nextSlot([])).toBe(1);
    expect(nextSlot([bm(1, 0), bm(3, 0)])).toBe(2);
    expect(nextSlot([bm(1, 0), bm(2, 0)])).toBe(3);
  });
  it('names a bookmark after the subtitle shown there', () => {
    const cues = [cue(1000, 3000, '<i>Where were you</i>\nlast night?', 'a')];
    expect(defaultLabel(cues, 2000, 4)).toBe('Where were you last night?');
    expect(defaultLabel(cues, 5000, 4)).toBe('Bookmark 4');
    expect(defaultLabel([cue(0, 1000, 'x'.repeat(60))], 500, 1)).toHaveLength(40);
  });
  it('lists bookmarks in film order', () => {
    expect(byTime([bm(1, 9000), bm(2, 1000)]).map((b) => b.slot)).toEqual([2, 1]);
  });
});

describe('typed times', () => {
  it('reads what people type', () => {
    expect(parseUserTime('1:23:45')).toBe(5_025_000);
    expect(parseUserTime('1:23:45.5')).toBe(5_025_500);
    expect(parseUserTime('01:23:45,500')).toBe(5_025_500);
    expect(parseUserTime('83:12')).toBe(4_992_000); // minutes past 59 are fine in min:s
    expect(parseUserTime(' 45 ')).toBe(45_000);
    expect(parseUserTime('45.2')).toBe(45_200);
  });
  it('refuses what it cannot read', () => {
    expect(parseUserTime('')).toBeNaN();
    expect(parseUserTime('1:75')).toBeNaN();
    expect(parseUserTime('1:75:00')).toBeNaN();
    expect(parseUserTime('abc')).toBeNaN();
  });
});

describe('export file name', () => {
  it('is named after the video by default', () => {
    expect(defaultExportName({ video: 'mon-film.mp4', subtitles: 'Movie.2019.1080p.WEB.en.srt' })).toBe('mon-film');
    expect(defaultExportName({ video: 'Clip.MOV' })).toBe('Clip');
  });
  it('falls back to the subtitle file name without a video', () => {
    expect(defaultExportName({ subtitles: 'Movie.en.srt' })).toBe('Movie.en');
    expect(defaultExportName({})).toBe('subtitles');
  });
  it('adds the language for a translation', () => {
    expect(defaultExportName({ video: 'mon-film.mp4', lang: 'fr' })).toBe('mon-film.fr');
    expect(defaultExportName({ subtitles: 'Movie.en.srt', lang: 'fr' })).toBe('Movie.fr');
  });
  it('cleans what people type', () => {
    expect(cleanFileName('mon-film', 'srt')).toBe('mon-film.srt');
    expect(cleanFileName(' mon-film.srt ', 'srt')).toBe('mon-film.srt');
    expect(cleanFileName('a/b:c?', 'vtt')).toBe('abc.vtt');
    expect(cleanFileName('   ', 'srt')).toBe('subtitles.srt');
  });
});

describe('subtitle position (top / bottom)', () => {
  it('reads SRT tags and VTT line settings', () => {
    expect(isTop({ text: '{\\an8}Hello' })).toBe(true);
    expect(isTop({ text: '{\\an2}Hello' })).toBe(false);
    expect(isTop({ text: 'Hello', vttSettings: 'line:0 align:center' })).toBe(true);
    expect(isTop({ text: 'Hello', vttSettings: 'line:10%' })).toBe(true);
    expect(isTop({ text: 'Hello', vttSettings: 'line:-1' })).toBe(false);
    expect(isTop({ text: 'Hello', vttSettings: 'line:90%' })).toBe(false);
    expect(isTop({ text: 'Hello' })).toBe(false);
  });
  it('sets the position the way each format expects', () => {
    const c = cue(0, 1000, 'Hello', 'a');
    expect(setPosition(c, true, 'srt').text).toBe('{\\an8}Hello');
    expect(setPosition(setPosition(c, true, 'srt'), false, 'srt').text).toBe('Hello');
    const v = setPosition({ ...c, vttSettings: 'align:start' }, true, 'vtt');
    expect(v.vttSettings).toBe('line:0 align:start');
    expect(setPosition(v, false, 'vtt').vttSettings).toBe('align:start');
  });
  it('keeps the position when exporting to the other format, and for a translation', () => {
    const top = { ...cue(1000, 2000, '{\\an8}Sign on the wall', 'a'), target: 'Panneau sur le mur' };
    expect(serializeVtt({ cues: [top] })).toContain('00:00:01.000 --> 00:00:02.000 line:0\nSign on the wall');
    expect(serializeSrt([top], true)).toContain('{\\an8}Panneau sur le mur');
    const vttTop = { ...cue(1000, 2000, 'Hi', 'b'), vttSettings: 'line:0' };
    expect(serializeSrt([vttTop])).toContain('{\\an8}Hi');
  });
});

describe('hidden markup in the editor', () => {
  it('hides the position tag and a whole-subtitle italic', () => {
    expect(editableText('{\\an8}Downloaded from\nexample.org')).toBe('Downloaded from\nexample.org');
    expect(editableText('{\\an8}<i>On the phone</i>')).toBe('On the phone');
    expect(editableText('Hello <i>world</i>')).toBe('Hello <i>world</i>'); // partial italic stays visible
  });
  it('puts them back after an edit', () => {
    expect(withEditedText('{\\an8}<i>On the phone</i>', 'On the radio')).toBe('{\\an8}<i>On the radio</i>');
    expect(withEditedText('Plain', 'Still plain')).toBe('Still plain');
  });
  it('turns italics on and off for the whole subtitle', () => {
    expect(setItalic('{\\an8}Hello\nthere', true)).toBe('{\\an8}<i>Hello\nthere</i>');
    expect(setItalic('Hello <i>world</i>', true)).toBe('<i>Hello world</i>');
    expect(setItalic('{\\an8}<i>Hello</i>', false)).toBe('{\\an8}Hello');
    expect(isItalic('<i>a</i>')).toBe(true);
    expect(isItalic('<i>a</i> b <i>c</i>')).toBe(false);
  });
});

describe('translation languages', () => {
  it('accepts language codes, with a region or script', () => {
    for (const c of ['fr', 'pt-BR', 'zh-Hans', 'nl', 'yue']) expect(isLangCode(c)).toBe(true);
    for (const c of ['', 'French', 'f', 'fr_FR', 'fr-']) expect(isLangCode(c)).toBe(false);
  });
  it('names known languages and falls back to the code', () => {
    expect(languageName('pt-BR')).toBe('Portuguese (Brazil)');
    expect(languageName('eu')).toBe('Basque'); // not in our list: the browser's name
    expect(languageName('not a code')).toBe('not a code');
  });
});

describe('using a translation', () => {
  it('replaces the text with the translation, keeps the original when untranslated', () => {
    expect(adoptTranslation({ ...cue(0, 1000, 'Hello', 'a'), target: 'Bonjour' })).toMatchObject({ text: 'Bonjour' });
    expect(adoptTranslation({ ...cue(0, 1000, 'Hello', 'a'), target: ' ' })).toMatchObject({ text: 'Hello' });
    expect(adoptTranslation({ ...cue(0, 1000, 'Hello', 'a'), target: 'Bonjour' }).target).toBeUndefined();
  });
  it('keeps the position, italics follow the translation', () => {
    expect(adoptTranslation({ ...cue(0, 1000, '{\\an8}<i>Sign</i>', 'a'), target: 'Panneau' }).text).toBe('{\\an8}Panneau');
    expect(adoptTranslation({ ...cue(0, 1000, '{\\an8}Sign', 'a'), target: '<i>Panneau</i>' }).text).toBe('{\\an8}<i>Panneau</i>');
  });
  it('counts what is left to translate', () => {
    expect(untranslatedCount([{ ...cue(0, 1, 'a'), target: 'x' }, { ...cue(2, 3, 'b'), target: '' }, cue(4, 5, 'c')])).toBe(2);
  });
  it('reads the language in a file name', () => {
    expect(langFromFileName('Movie.2019.1080p.WEB.fr.srt')).toBe('fr');
    expect(langFromFileName('film.pt-BR.vtt')).toBe('pt-BR');
    expect(langFromFileName('Movie.HDR.srt')).toBeNull();
    expect(langFromFileName('Movie.srt')).toBeNull();
  });
});

describe('adding subtitles from another file (forced)', () => {
  const base = [cue(1000, 4000, 'Where were you?', 'a'), cue(6000, 8000, 'At home.', 'b')];
  const forced = [cue(2000, 3000, 'POLICE', 'f1'), cue(9000, 10_000, 'Paris, 1969', 'f2')];
  const opts = { top: true, offsetMs: 0, format: 'srt' as const };
  it('adds them at the top, with new ids, in time order', () => {
    const added = prepareIncoming(forced, opts);
    expect(added.map((c) => c.text)).toEqual(['{\\an8}POLICE', '{\\an8}Paris, 1969']);
    expect(added.every((c) => c.id !== 'f1' && c.id !== 'f2')).toBe(true);
    expect(mergeCues(base, added).map((c) => c.start)).toEqual([1000, 2000, 6000, 9000]);
  });
  it('shifts them when asked', () => {
    expect(prepareIncoming(forced, { ...opts, offsetMs: -2500 }).map((c) => [c.start, c.end])).toEqual([
      [0, 500],
      [6500, 7500],
    ]);
  });
  it('counts the ones shown while a subtitle is already on screen', () => {
    expect(countOverlaps(base, prepareIncoming(forced, opts))).toBe(1);
  });
  it('does not flag a top subtitle over a bottom one as an overlap', () => {
    const merged = mergeCues(base, prepareIncoming(forced, opts));
    expect(collectIssues(merged, S).get('a') ?? []).not.toContain('overlap');
    const bothBottom = mergeCues(base, prepareIncoming(forced, { ...opts, top: false }));
    expect(collectIssues(bothBottom, S).get('a')).toContain('overlap');
  });
  it('recognises forced files by name', () => {
    expect(looksForced('Movie.fr.forced.srt')).toBe(true);
    expect(looksForced('Movie FORCED.srt')).toBe(true);
    expect(looksForced('Movie.fr.srt')).toBe(false);
    expect(looksForced('Enforcedly.srt')).toBe(false);
  });
});

describe('selection follows the playhead', () => {
  const cs = [cue(0, 2000, 'a', 'a'), cue(3000, 5000, 'b', 'b'), cue(6000, 8000, 'c', 'c')];
  it('keeps the selection while the playhead is in it', () => {
    expect(followSelection(cs, ['a'], 1500)).toBeNull();
  });
  it('moves to the subtitle the playhead is in, none in a gap', () => {
    expect(followSelection(cs, ['a'], 3500)).toEqual(['b']);
    expect(followSelection(cs, ['a'], 2600)).toEqual([]);
  });
  it('keeps a subtitle past the end of the film while the playhead waits at the end', () => {
    expect(followSelection(cs, ['c'], 5000, 5000)).toBeNull();
    expect(followSelection(cs, ['b'], 7000, 7000)).toEqual(['c']);
  });
  it('leaves several selected subtitles alone', () => {
    expect(followSelection(cs, ['a', 'c'], 3500)).toBeNull();
  });
});

describe('machine translation text', () => {
  it('sends plain sentences, lines joined, no tags', () => {
    expect(mtInput('{\\an8}<i>You said the last train\nleft at midnight.</i>')).toBe('You said the last train left at midnight.');
    expect(mtInput('- Hello <b>there</b>\n- Hi')).toBe('- Hello there\n- Hi');
    expect(mtOutput('- Hello there\n- Hi', '- Salut toi. - Bonjour.', 42)).toBe('- Salut toi.\n- Bonjour.');
    expect(mtOutput('- Hello there\n- Hi', '-Salut toi.\n– Bonjour.', 42)).toBe('- Salut toi.\n- Bonjour.');
    expect(mtOutput('<i>- A\n- B</i>', '- Un - Deux', 42)).toBe('<i>- Un\n- Deux</i>');
    expect(mtOutput('Well - you know', 'Eh bien - tu sais', 42)).toBe('Eh bien - tu sais');
    // Models that drop the dashes and/or the line break.
    expect(mtOutput('- Hello there\n- Hi', 'Salut toi.\nBonjour.', 42)).toBe('- Salut toi.\n- Bonjour.');
    expect(mtOutput('- Hello there\n- Hi', 'Salut toi. Bonjour.', 42)).toBe('- Salut toi.\n- Bonjour.');
    expect(mtOutput('- Where were you? Tell me.\n- Out.', 'Où étais-tu ? Dis-moi. Dehors.', 42)).toBe('- Où étais-tu ? Dis-moi.\n- Dehors.');
    expect(mtOutput('- Hi\n- Hello', 'Salut bonjour', 42)).toBe('- Salut bonjour');
  });
  it('splits a long result in two balanced lines', () => {
    expect(fitLines('Short line.', 42)).toBe('Short line.');
    expect(fitLines('Tu disais que le dernier train partait à minuit.', 42)).toBe('Tu disais que le dernier\ntrain partait à minuit.');
  });
  it('keeps the italics of the original', () => {
    expect(mtOutput('<i>On the phone</i>', 'Au téléphone', 42)).toBe('<i>Au téléphone</i>');
    expect(mtOutput('Plain', 'Simple', 42)).toBe('Simple');
  });
  it('offers the base language as a fallback code', () => {
    expect(engineLangCandidates('pt-BR')).toEqual(['pt-BR', 'pt']);
    expect(engineLangCandidates('fr')).toEqual(['fr']);
  });
});

describe('space out subtitles (Tools › Space out subtitles, Check quality)', async () => {
  const { spaceOut } = await import('./tools');
  const cues = [cue(0, 1500, 'a', 'a'), cue(1450, 3000, 'b', 'b'), cue(3050, 3200, 'c', 'c'), cue(3250, 5000, 'd', 'd')];
  it('ends move back to keep the gap, starts never move', () => {
    const r = spaceOut(cues, 100);
    expect(r.cues.map((c) => [c.start, c.end])).toEqual([
      [0, 1350],
      [1450, 2950],
      [3050, 3200],
      [3250, 5000],
    ]);
    expect(r.spaced).toEqual(['a', 'b']);
  });
  it('a subtitle that would get too short stays, listed', () => {
    expect(spaceOut(cues, 100).blocked).toEqual(['c']);
  });
  it('only the selected ends', () => {
    expect(spaceOut(cues, 100, ['b']).spaced).toEqual(['b']);
  });
});

describe('the lines to pick from show the language edited', async () => {
  const { shownCues } = await import('./translation');
  const cues = [
    { id: 'a', start: 0, end: 1000, text: 'Hello', target: 'Bonjour' },
    { id: 'b', start: 1000, end: 2000, text: 'Not yet', target: '' },
  ];
  it('the translation while editing it, the original where it is empty or when editing the original', () => {
    expect(shownCues(cues, 'target').map((c) => c.text)).toEqual(['Bonjour', 'Not yet']);
    expect(shownCues(cues, 'source').map((c) => c.text)).toEqual(['Hello', 'Not yet']);
  });
});

describe('saved selections', async () => {
  const { liveIds, selectionRange } = await import('./selections');
  const cues = [cue(0, 1000, 'a', 'a'), cue(1000, 2000, 'b', 'b'), cue(2000, 3000, 'c', 'c'), cue(3000, 4000, 'd', 'd')];
  it('the ones still there, in film order', () => {
    expect(liveIds({ ids: ['c', 'gone', 'a'] }, cues)).toEqual(['a', 'c']);
  });
  it('their numbers', () => {
    expect(selectionRange(['b'], cues)).toBe('#2');
    expect(selectionRange(['b', 'c', 'd'], cues)).toBe('#2–#4');
    expect(selectionRange(['a', 'd'], cues)).toBe('#1 … #4');
    expect(selectionRange(['gone'], cues)).toBe('');
  });
});

describe('balance lines (Tools › Balance lines, Check quality, translation)', async () => {
  const { balanceText, balanceCueText, balanceLines } = await import('./lines');
  it('one line when it fits', () => {
    expect(balanceText('Where were\nyou?', 42, 'en')).toBe('Where were you?');
  });
  it('cuts before a conjunction rather than after an article', () => {
    expect(balanceText('Alright, sprites, let’s burn the bodies and have some peppermint tea.', 42, 'en')).toBe(
      'Alright, sprites, let’s burn the bodies\nand have some peppermint tea.',
    );
    expect(balanceText('Je ne sais pas pourquoi tu es venu ici ce soir, mon ami.', 42, 'fr')).not.toMatch(/tu es\n/);
  });
  it('keeps names together and prefers a punctuation', () => {
    expect(balanceText('We were going to meet John Smith at the station tonight.', 42, 'en')).not.toMatch(/John\nSmith/);
    expect(balanceText('I know. But we can’t stay here tonight, John.', 42, 'en')).toBe('I know.\nBut we can’t stay here tonight, John.');
  });
  it('keeps a cut that is already about as good', () => {
    expect(balanceText('JOHN: Then how did you get back\nto the station?', 42, 'en')).toBe('JOHN: Then how did you get back\nto the station?');
    expect(balanceText('Alright, sprites, let’s burn the\nbodies and have some peppermint tea.', 42, 'en')).toBe(
      'Alright, sprites, let’s burn the bodies\nand have some peppermint tea.',
    );
  });
  it('keeps tags on their words, hidden markup and dialogue lines', () => {
    expect(balanceText('The night <font color="#FFFF00">was dark</font> and full of terrors, my friend.', 42, 'en')).toBe(
      'The night <font color="#FFFF00">was dark</font> and full\nof terrors, my friend.',
    );
    expect(balanceCueText('{\\an8}<i>Alright, sprites, let’s burn the bodies and have some peppermint tea.</i>', 42, 'en')).toBe(
      '{\\an8}<i>Alright, sprites, let’s burn the bodies\nand have some peppermint tea.</i>',
    );
    expect(balanceText('- Did you see the last train leave the station?\n- No.', 42, 'en')).toBe('- Did you see the last train leave the station?\n- No.');
  });
  it('only the scope, only the field, changes listed', () => {
    const cues = [
      { id: 'a', start: 0, end: 1000, text: 'Short\none.', target: 'Court\nun.' },
      { id: 'b', start: 1000, end: 2000, text: 'Also\nshort.' },
    ];
    const r = balanceLines(cues, 42, 'fr', 'target', ['a']);
    expect(r.cues[0]).toMatchObject({ text: 'Short\none.', target: 'Court un.' });
    expect(r.cues[1]).toBe(cues[1]);
    expect(r.changed).toEqual([{ id: 'a', before: 'Court\nun.', after: 'Court un.' }]);
  });
});

describe('AI translation', () => {
  it('keeps the line breaks the model chose when they fit, re-splits otherwise', () => {
    expect(mtOutput('x', 'Où étais-tu\nhier soir ?', 42)).toBe('Où étais-tu\nhier soir ?');
    expect(mtOutput('x', 'a\nb\nc', 42)).toBe('a b c');
    expect(mtOutput('x', 'une ligne beaucoup trop longue pour tenir\nok', 20)).toBe(fitLines('une ligne beaucoup trop longue pour tenir ok', 20));
  });

  it('batches subtitles with text and numbers them with their duration', () => {
    const cues = [cue(0, 1500, 'Hello'), cue(2000, 3000, '   '), cue(3000, 5250, '<i>World</i>\nagain')];
    const b = aiBatches(cues, 1);
    expect(b.map((x) => x.map((c) => c.id))).toEqual([['0'], ['3000']]);
    expect(aiItems(b[1])).toEqual([{ n: 1, text: 'World again', seconds: 2.3 }]);
  });

  it('writes prompts with languages, limits and context', () => {
    const sys = aiSystemPrompt('en', 'fr', 42, 17);
    expect(sys).toContain('English (en)');
    expect(sys).toContain('French (fr)');
    expect(sys).toContain('42 characters');
    const user = aiUserPrompt([{ n: 1, text: 'Hi', seconds: 1 }], [{ text: 'Before', translation: 'Avant\nça' }]);
    expect(user).toContain('- Before  →  Avant ça');
    expect(user).toContain('{"subtitles":[{"n":1,"text":"Hi","seconds":1}]}');
  });

  it('reads the reply, fenced or bare, and drops unknown numbers', () => {
    const r = parseAiReply('```json\n{"subtitles":[{"n":1,"text":"Salut"},{"n":2,"text":"A\\nB"},{"n":9,"text":"x"},{"n":3,"text":" "}]}\n```', 3);
    expect([...r]).toEqual([
      [1, 'Salut'],
      [2, 'A\nB'],
    ]);
    expect([...parseAiReply('[{"n":1,"text":"Oui"}]', 1)]).toEqual([[1, 'Oui']]);
    expect(parseAiReply('Sorry, no.', 1).size).toBe(0);
  });
});

describe('AI models', () => {
  it('keeps chat models, newest first', () => {
    const m = (id: string, created: number) => ({ id, name: id, created });
    const list = [m('gpt-4o', 1), m('gpt-4o-audio-preview', 3), m('whisper-1', 5), m('o3', 2), m('gpt-image-1', 4), m('text-embedding-3', 6)];
    expect(translationModels('openai', list).map((x) => x.id)).toEqual(['o3', 'gpt-4o']);
    expect(translationModels('anthropic', [m('a', 1), m('b', 2)]).map((x) => x.id)).toEqual(['b', 'a']);
    expect(translationModels('local', [m('gemma3:12b', 1), m('nomic-embed-text', 2), m('glm-5.2:cloud', 3)]).map((x) => x.id)).toEqual([
      'glm-5.2:cloud',
      'gemma3:12b',
    ]);
    expect(
      translationModels('mistral', [
        m('mistral-large-latest', 1),
        m('mistral-embed', 2),
        m('codestral-latest', 3),
        m('voxtral-mini', 4),
        m('mistral-small-latest', 5),
      ]).map((x) => x.id),
    ).toEqual(['mistral-small-latest', 'mistral-large-latest']);
    expect(translationModels('deepseek', [m('deepseek-chat', 1), m('deepseek-reasoner', 1)]).map((x) => x.id)).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    expect(isCloudModel('glm-5.2:cloud')).toBe(true);
    expect(isCloudModel('gemma4:e4b')).toBe(false);
  });
});

describe('AI batches with skipped lines', () => {
  it('asks again for the subtitles the model skipped', async () => {
    const { translateCues } = await import('../mt');
    const calls: number[] = [];
    // Skips every 3rd item on the first try of a batch; answers everything on retries.
    const engine = {
      id: 'local' as const,
      status: async () => 'ready' as const,
      open: async () => ({
        async translateBatch(items: { n: number; text: string }[]) {
          calls.push(items.length);
          const first = calls.length === 1 || items.length === 40;
          return new Map(items.filter((it) => !first || it.n % 3 !== 0).map((it) => [it.n, `FR ${it.text}`]));
        },
        close() {},
      }),
    };
    const cues = Array.from({ length: 50 }, (_, i) => cue(i * 1000, i * 1000 + 800, `Line ${i}`, `c${i}`));
    const out = await translateCues(engine, cues, 'en', 'fr', S, {});
    expect(out.size).toBe(50);
    expect(out.get('c2')).toBe('FR Line 2');
    expect(calls).toEqual([40, 13, 10]);
  });
});

describe('fix punctuation', () => {
  const O = (o: Partial<PunctOptions>): PunctOptions => ({ ...DEFAULT_PUNCT, ...o });
  const fr = O({ style: 'fr' });
  const en = O({ style: 'none' });
  it('French (France): narrow no-break space before ! ? ;, no-break space before :', () => {
    expect(fixPunctuationText('Ok! Quoi?! Oui; non: si.', fr)).toBe(`Ok${NNBSP}! Quoi${NNBSP}?! Oui${NNBSP}; non${NBSP}: si.`);
    expect(fixPunctuationText('Ok !', fr)).toBe(`Ok${NNBSP}!`);
    expect(fixPunctuationText('À 10:30, http://a.fr', fr)).toBe('À 10:30, http://a.fr');
    expect(fixPunctuationText('« Salut »', fr)).toBe(`«${NBSP}Salut${NBSP}»`);
  });
  it('other languages: no space before ! ? ; :', () => {
    expect(fixPunctuationText('Hey ! What ? Note : yes ; no', en)).toBe('Hey! What? Note: yes; no');
    expect(fixPunctuationText(`Ok${NNBSP}! Note${NBSP}: « oui »`, en)).toBe('Ok! Note: « oui »');
  });
  it('quotes: guillemets, curly, straight; unpaired left alone', () => {
    expect(fixPunctuationText('Il a dit "ok".', O({ style: 'fr', quotes: 'guillemets' }))).toBe(`Il a dit «${NBSP}ok${NBSP}».`);
    expect(fixPunctuationText('He said "ok".', O({ quotes: 'curly' }))).toBe('He said “ok”.');
    expect(fixPunctuationText('He said « ok ».', O({ quotes: 'straight' }))).toBe('He said "ok".');
    expect(fixPunctuationText('He said "ok', O({ quotes: 'curly' }))).toBe('He said "ok');
    expect(fixPunctuationText('"Two\nlines"', O({ quotes: 'guillemets' }))).toBe('«\u00a0Two\nlines\u00a0»');
  });
  it('cleanups: ellipsis, spaces, dialogue dashes', () => {
    expect(fixPunctuationText('Well...', O({ ellipsis: 'char' }))).toBe('Well…');
    expect(fixPunctuationText('Well…', O({ ellipsis: 'dots' }))).toBe('Well...');
    expect(fixPunctuationText('Wait....', O({ ellipsis: 'char' }))).toBe('Wait....');
    expect(fixPunctuationText(' Hello  you , ok .  ', O({}))).toBe('Hello you, ok.');
    expect(fixPunctuationText('It costs .5', O({}))).toBe('It costs .5');
    expect(fixPunctuationText('-Hi\n-Hello', O({}))).toBe('- Hi\n- Hello');
    expect(fixPunctuationText('-5 degrees', O({}))).toBe('-5 degrees');
  });
  it('Netflix: straight quotes without spaces, no semicolons, -Hi, ellipsis character', () => {
    const nf = netflixPunct('en');
    expect(fixPunctuationText('He said « ok »; then...', nf)).toBe('He said "ok", then…');
    expect(fixPunctuationText('He said “ ok ” ;', nf)).toBe('He said "ok",');
    expect(fixPunctuationText('- Hi\n- Hello', nf)).toBe('-Hi\n-Hello');
    expect(fixPunctuationText('-Hi\n-5 degrees', nf)).toBe('-Hi\n-5 degrees');
    expect(fixPunctuationText('Tom &amp; Jerry', nf)).toBe('Tom &amp; Jerry');
    expect(netflixPunct('fr-FR').quotes).toBe('guillemets');
    const once = fixPunctuationText('- Hi; "a" ...', nf);
    expect(fixPunctuationText(once, nf)).toBe(once);
  });
  it('keeps tags in place', () => {
    expect(fixPunctuationText('{\\an8}<i>-Ok!</i>', fr)).toBe(`{\\an8}<i>- Ok${NNBSP}!</i>`);
    expect(fixPunctuationText('<i>Ok</i>!', fr)).toBe(`<i>Ok</i>${NNBSP}!`);
    expect(fixPunctuationText('<font color="#fff">Hey !</font>', en)).toBe('<font color="#fff">Hey!</font>');
    expect(fixPunctuationText('{\\an8}?', fr)).toBe('{\\an8}?');
  });
  it('is idempotent', () => {
    const texts = ['Ok! "Quoi"?  Oui...', '-Hi\n-« Salut » !', '<i>Note : ok ?</i>'];
    for (const o of [fr, en].map((x) => ({ ...x, quotes: 'guillemets' as const, ellipsis: 'char' as const }))) {
      for (const s of texts) {
        const once = fixPunctuationText(s, o);
        expect(fixPunctuationText(once, o)).toBe(once);
      }
    }
  });
  it('works on the translation only, keeps times and VTT settings', () => {
    const c: Cue = { id: 'a', start: 100, end: 900, text: 'Hey !', target: 'Ok!', vttSettings: 'line:10%' };
    const b = cue(1000, 2000, 'Fine.', 'b');
    const r = fixPunctuation([c, b], fr, 'target');
    expect(r.cues[0]).toEqual({ ...c, target: `Ok${NNBSP}!` });
    expect(r.changed).toHaveLength(1);
    expect(r.cues[1]).toBe(b);
    expect(fixPunctuation([c], fr, 'text', ['zz']).changed).toHaveLength(0);
  });
  it('guesses the convention from the language', () => {
    expect(punctStyleFor('fr')).toBe('fr');
    expect(punctStyleFor('fr-BE')).toBe('fr');
    expect(punctStyleFor('fr-CA')).toBe('none');
    expect(punctStyleFor('en-US')).toBe('none');
    expect(punctStyleFor('de')).toBe('none');
    expect(punctStyleFor(undefined)).toBe('keep');
  });
});

describe('dialogue waveform (speech)', () => {
  const F = 32;
  it('turns VAD probabilities into padded, merged speech spans', () => {
    const probs = [0, 0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    expect(speechSpans(probs, F, { ...DEFAULT_SPANS, padMs: 0 })).toEqual([[64, 288]]);
    // padding on both sides, never before 0
    expect(speechSpans([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9], F, { ...DEFAULT_SPANS, padMs: 50 })).toEqual([[0, 7 * F + 50]]);
  });
  it('keeps speech through short dips (hysteresis) and drops blips', () => {
    const o = { ...DEFAULT_SPANS, padMs: 0, minSilenceMs: 100, minSpeechMs: 100 };
    expect(speechSpans([0.9, 0.9, 0.9, 0.4, 0.2, 0.9, 0.9, 0.9], F, o)).toEqual([[0, 8 * F]]);
    expect(speechSpans([0, 0.9, 0, 0, 0, 0, 0], F, o)).toEqual([]);
  });
  it('merges spans that touch once padded', () => {
    const o = { ...DEFAULT_SPANS, padMs: 100, minSilenceMs: 64, minSpeechMs: 0 };
    expect(speechSpans([0.9, 0.9, 0, 0, 0, 0.9, 0.9], F, o)).toEqual([[0, 7 * F + 100]]);
  });
  it('marks buckets touched by speech', () => {
    expect([...speechMask([[15, 32]], 100, 5)]).toEqual([0, 1, 1, 1, 0]);
  });
  it('scales on speech peaks only, so loud music does not flatten dialogue', () => {
    const p = createPeaks(1000);
    p.max.fill(0.1, 0, 50);
    p.min.fill(-0.1, 0, 50);
    p.max.fill(0.8, 50); // music
    const mask = new Uint8Array(100).fill(1, 0, 50);
    const w = speechWaveform(p, mask);
    expect(w.max[0]).toBe(Math.round(0.9 * 127));
    expect(w.max[60]).toBe(127); // clipped
    expect(toWaveform(p).max[0]).toBeLessThan(20);
    expect(speechWaveform(p, new Uint8Array(100)).max[60]).toBe(Math.round(0.9 * 127)); // no speech: whole-film max
  });
  it('downsamples in chunks without gaps or repeats', () => {
    const got: number[] = [];
    const sig = Float32Array.from({ length: 300 }, (_, i) => i);
    downsample(sig.subarray(0, 100), 48000, 0, 16000, (i, v) => got.push(i, v));
    downsample(sig.subarray(100), 48000, 100, 16000, (i, v) => got.push(i, v));
    const idx = got.filter((_, k) => k % 2 === 0);
    expect(idx).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(got[2 * 10 + 1]).toBe(30); // centred box average
  });
});

describe('find and replace', () => {
  const R = (o: Partial<ReplaceOptions>): ReplaceOptions => ({ ...DEFAULT_REPLACE, ...o });
  const cue = (id: string, text: string, target?: string) => ({ id, start: 0, end: 1000, text, target });
  const cues = [cue('a', 'Tom and tomatoes.\nTOM!'), cue('b', '<i>Tom</i> is here'), cue('c', 'Nobody')];

  it('replaces plain text, case-insensitive by default', () => {
    const r = findReplace(cues, R({ find: 'tom', replace: 'Tim' }));
    expect(r.cues[0].text).toBe('Tim and Timatoes.\nTim!');
    expect(r.count).toBe(4);
    expect(r.changed.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('whole words, match case, tags untouched', () => {
    expect(findReplace(cues, R({ find: 'Tom', replace: 'Tim', wholeWord: true, matchCase: true })).cues.map((c) => c.text)).toEqual([
      'Tim and tomatoes.\nTOM!',
      '<i>Tim</i> is here',
      'Nobody',
    ]);
    expect(findReplace([cue('x', '<i>Hi</i>')], R({ find: 'i', replace: 'b' })).cues[0].text).toBe('<i>Hb</i>');
    expect(findReplace([cue('x', 'Élise est là, élisez-la')], R({ find: 'élise', replace: 'Lise', wholeWord: true })).cues[0].text).toBe(
      'Lise est là, élisez-la',
    );
  });

  it('regular expressions with groups, and errors', () => {
    expect(findReplace([cue('x', 'Mr Smith, Mrs Jones')], R({ find: '(Mrs?) (\\w+)', replace: '$2 ($1)', regex: true })).cues[0].text).toBe(
      'Smith (Mr), Jones (Mrs)',
    );
    expect(findReplace([cue('x', 'a  b')], R({ find: ' {2,}', replace: ' ', regex: true })).cues[0].text).toBe('a b');
    expect(findReplace(cues, R({ find: '(', regex: true })).error).toMatch(/^[A-Z]/);
    expect(findReplace(cues, R({ find: 'x*', replace: 'y', regex: true })).changed).toHaveLength(0);
    expect(findReplace(cues, R({ find: '' })).changed).toHaveLength(0);
  });

  it('works on the translation, and on the selection only', () => {
    const tr = [cue('a', 'Tom', 'Tom ici'), cue('b', 'Tom', 'Tom là')];
    const r = findReplace(tr, R({ find: 'Tom', replace: 'Tim' }), 'target', ['b']);
    expect(r.cues.map((c) => [c.text, c.target])).toEqual([
      ['Tom', 'Tom ici'],
      ['Tom', 'Tim là'],
    ]);
  });
});

describe('speech to text', () => {
  it('joins close speech spans into windows of at most 28 s', () => {
    expect(
      sttWindows(
        [
          [0, 2000],
          [2500, 4000],
          [10000, 11000],
        ],
        60000,
      ),
    ).toEqual([
      [0, 4000],
      [10000, 11000],
    ]);
    expect(sttWindows([[0, 60000]], 60000)).toEqual([
      [0, 20000],
      [20000, 40000],
      [40000, 60000],
    ]);
    expect(
      sttWindows(
        [
          [0, 20000],
          [20500, 30000],
        ],
        60000,
      ),
    ).toEqual([
      [0, 20000],
      [20500, 30000],
    ]);
    expect(sttWindows(null, 30000)).toEqual([
      [0, 15000],
      [15000, 30000],
    ]);
  });

  it('groups words into subtitles at pauses and sentence ends', () => {
    const w = (text: string, start: number, end: number) => ({ text, start, end });
    const rules = { maxLineLength: 42, minDurationMs: 1000, minGapMs: 80 };
    const cues = wordsToCues(
      [
        w(' Where', 1000, 1300),
        w(' were', 1300, 1500),
        w(' you', 1500, 1700),
        w(' last', 1700, 1900),
        w(' night?', 1900, 2300),
        w(' Out.', 2350, 2600),
        w(' Later', 4000, 4300),
      ],
      rules,
    );
    expect(cues.map((c) => [c.text, c.start, c.end])).toEqual([
      ['Where were you last night?', 1000, 2270],
      ['Out.', 2350, 3350],
      ['Later', 4000, 5000],
    ]);
    const long = wordsToCues(
      Array.from({ length: 20 }, (_, i) => w(' word' + i, i * 200, i * 200 + 150)),
      rules,
    );
    expect(long.every((c) => c.text.split('\n').every((l) => l.length <= 42) && c.text.split('\n').length <= 2)).toBe(true);
  });
});

describe('OCR', () => {
  it('finds text boxes in the detection map', () => {
    const w = 40,
      h = 20;
    const map = new Float32Array(w * h);
    const fill = (x0: number, y0: number, x1: number, y1: number, v: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) map[y * w + x] = v;
    };
    fill(2, 2, 18, 6, 0.9); // a word
    fill(22, 12, 38, 16, 0.9); // another, lower
    fill(30, 2, 31, 3, 0.9); // a speck: too small
    fill(5, 12, 15, 16, 0.35); // faint: below the box threshold
    const boxes = boxesFromMap(map, w, h);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].x).toBeLessThan(2);
    expect(boxes[0].x + boxes[0].w).toBeGreaterThan(18);
    expect(boxes[1].y).toBeGreaterThan(8);
  });

  it('decodes CTC output and joins picked lines', () => {
    const dict = ['a', 'b', 'é'];
    const C = 5; // blank, a, b, é, space
    const steps = [1, 1, 0, 1, 4, 3, 3, 2];
    const logits = new Float32Array(steps.length * C);
    steps.forEach((c, t) => (logits[t * C + c] = 1));
    expect(ctcDecode(logits, steps.length, C, dict).text).toBe('aa éb');
    const line = (text: string, y: number) => ({ text, y, x: 0, w: 10, h: 5, angle: 0, score: 1 });
    expect(ocrText([line('second', 20), line('first', 5)])).toBe('second\nfirst');
  });
});

describe('bookmark near', () => {
  it('finds a bookmark already at this moment', async () => {
    const { bookmarkNear } = await import('./bookmarks');
    const list = [{ id: 'a', slot: 1, time: 10000, label: 'x' }];
    expect(bookmarkNear(list, 10100)?.id).toBe('a');
    expect(bookmarkNear(list, 10400)).toBeUndefined();
  });
});

describe('text case', () => {
  it('turns capitals into sentence case, and back', () => {
    expect(toSentenceCase('DAD AND BABY ONLY.\nCOME IN.')).toBe('Dad and baby only.\nCome in.');
    expect(toSentenceCase("WHERE ARE YOU\nGOING? I DON'T KNOW.")).toBe("Where are you\ngoing? I don't know.");
    expect(toSentenceCase("- WHERE MY MONEY??\n- I'M BROKE...")).toBe("- Where my money??\n- I'm broke...");
    expect(toSentenceCase('<i>ÇA VA ? OUI.</i>', 'fr')).toBe('<i>Ça va ? Oui.</i>');
    expect(toSentenceCase('{\\an8}TODAY 5:51 PM')).toBe('{\\an8}Today 5:51 pm');
    expect(toggleCase('<i>Come in.</i>')).toBe('<i>COME IN.</i>');
    expect(toggleCase('COME IN.')).toBe('Come in.');
    expect(isUpperCase('OK')).toBe(true);
    expect(isUpperCase('I')).toBe(false);
  });
});

describe('quality check', () => {
  const p = PROFILES.netflixOther;
  const c = (id: string, start: number, end: number, text: string) => ({ id, start, end, text });

  it('finds problems and things to check', () => {
    const cues = [
      c('a', 0, 1500, 'Hello there.'),
      c('b', 1450, 2000, 'Overlap and short.'),
      c('c', 2040, 3000, 'This line is definitely much too long to fit on a single line of text.'),
      c('d', 5000, 13000, '[door slams]'),
      c('e', 14000, 15000, '  '),
    ];
    const r = audit(cues, p, [
      [0, 3000],
      [20000, 23000],
    ]);
    expect(r.ids.overlap).toEqual(['a']);
    expect(r.ids.gap).toEqual(['b']);
    expect(r.ids.tooShort).toEqual(['b']);
    expect(r.ids.tooFast).toEqual(expect.arrayContaining(['b', 'c']));
    expect(r.ids.lines).toEqual(['c']);
    expect(r.ids.tooLong).toEqual(['d']);
    expect(r.ids.hi).toEqual(['d']);
    expect(r.ids.empty).toEqual(['e']);
    expect(r.speechOnly).toEqual([[20000, 23000]]);
  });

  it('fixes without moving starts', () => {
    const cues = [
      c('a', 0, 1500, 'Hello there.'),
      c('b', 1450, 2000, 'Short.'),
      c('c', 5000, 6000, 'This line is definitely much too long to fit on one line.'),
    ];
    const g = fixGaps(cues, p);
    expect(g[0].end).toBe(1450 - p.minGapMs);
    const d = fixDurations(g, p);
    expect(d[1].start).toBe(1450);
    expect(d[1].end).toBeGreaterThanOrEqual(1450 + 833);
    const l = fixLines(d, p);
    expect(l[2].text.split('\n')).toHaveLength(2);
    const all = fixAll([...cues, c('e', 9000, 9500, '')], p);
    expect(all).toHaveLength(3);
    expect(all.map((x) => x.start)).toEqual([0, 1450, 5000]);
    expect(audit(all, p, null).ids.overlap).toBeUndefined();
  });
});

describe('quality conventions', () => {
  it('turns a convention into rules at the video frame rate', () => {
    const s = { minDurationMs: 1000, minGapMs: 80 } as Parameters<typeof profileFor>[3];
    expect(framesToMs(2, 25)).toBe(80);
    expect(framesToMs(2, 23.976)).toBe(84);
    expect(profileFor(CONVENTIONS.netflix, false, 25, s)).toMatchObject({ maxCps: 17, minDurationMs: 833, minGapMs: 80 });
    expect(profileFor(CONVENTIONS.netflix, true, 25, s).maxCps).toBe(13);
    // TED says nothing about durations or gaps: the user's settings stay.
    expect(profileFor(CONVENTIONS.ted, true, 25, s)).toMatchObject({ maxCps: 21, minDurationMs: 1000, minGapMs: 80 });
  });
});

describe('spotting', () => {
  it('places a held subtitle between its neighbours', async () => {
    const { placeSpotted } = await import('./tools');
    const S = { minDurationMs: 1000, minGapMs: 80, floorDurationMs: 300 };
    const cues = [
      { id: 'a', start: 0, end: 2000, text: 'A' },
      { id: 'b', start: 5000, end: 6000, text: 'B' },
    ];
    const r = placeSpotted(cues, 2500, 4200, S)!;
    expect(r.cues.find((c) => c.id === r.id)).toMatchObject({ start: 2500, end: 4200, text: '' });
    // Starts inside A, runs into B: fitted with the gap.
    const f = placeSpotted(cues, 1800, 5600, S)!;
    expect(f.cues.find((c) => c.id === f.id)).toMatchObject({ start: 2080, end: 4920 });
    // A tap gets the minimum duration.
    const tap = placeSpotted(cues, 3000, 3100, S)!;
    expect(tap.cues.find((c) => c.id === tap.id)).toMatchObject({ start: 3000, end: 4000 });
    // No room.
    expect(placeSpotted(cues, 4900, 5500, S)).toBeNull();
  });
});

describe('token estimate', () => {
  it('counts the real prompts, one request per batch', async () => {
    const { estimateTokens } = await import('./mtAi');
    const cues = Array.from({ length: 90 }, (_, i) => ({ id: 'c' + i, start: i * 3000, end: i * 3000 + 2000, text: 'Where were you last night, my friend?' }));
    const e = estimateTokens(cues, 'en', 'fr', 42, 17);
    expect(e.requests).toBe(3);
    // Rules + 90 subtitles in, the translations out: in the thousands, input above output.
    expect(e.output).toBeGreaterThan(900);
    expect(e.input).toBeGreaterThan(e.output);
    expect(estimateTokens([], 'en', 'fr', 42, 17)).toEqual({ input: 0, output: 0, requests: 0 });
  });
});

describe('speech to text, continuing', () => {
  it('skips what already has subtitles', async () => {
    const { uncoveredWindows, keepClear } = await import('./stt');
    const cue = (id: string, start: number, end: number) => ({ id, start, end, text: id });
    const done = [cue('a', 0, 9000), cue('b', 10000, 19000)];
    expect(
      uncoveredWindows(
        [
          [0, 10000],
          [10000, 20000],
          [20000, 30000],
        ],
        done,
      ),
    ).toEqual([[20000, 30000]]);
    expect(keepClear([cue('x', 18000, 20000), cue('y', 21000, 23000)], done, 80).map((c) => c.id)).toEqual(['y']);
  });
});

describe('move by keyboard', () => {
  it('moves selected subtitles together, up to the neighbours', async () => {
    const { moveCuesBy } = await import('./tools');
    const S = { minGapMs: 80 };
    const c = (id: string, start: number, end: number) => ({ id, start, end, text: id });
    const cues = [c('a', 0, 1000), c('b', 2000, 3000), c('c', 3100, 4000), c('d', 4500, 5000)];
    expect(moveCuesBy(cues, ['b'], 100, S)[1]).toMatchObject({ start: 2020, end: 3020 });
    expect(moveCuesBy(cues, ['b'], -500, S)[1]).toMatchObject({ start: 1500, end: 2500 });
    expect(moveCuesBy(cues, ['b'], -2000, S)[1].start).toBe(1080);
    // b and c together: c's room to d limits both.
    const g = moveCuesBy(cues, ['b', 'c'], 1000, S);
    expect([g[1].start, g[2].start, g[2].end]).toEqual([2420, 3520, 4420]);
    expect(moveCuesBy(cues, ['a'], -100, S)).toBe(cues);
  });
});

describe('split at the text cursor', () => {
  it('cuts the text where the cursor was, tags kept', async () => {
    const { splitCue } = await import('./tools');
    const S = { minGapMs: 80, floorDurationMs: 300 };
    const cues = [{ id: 'a', start: 0, end: 4000, text: '{\\an8}<i>Where were you? I was out.</i>' }];
    const r = splitCue(cues, 'a', 2000, S, { field: 'text', index: 'Where were you?'.length })!;
    expect(r.cues.map((c) => c.text)).toEqual(['{\\an8}<i>Where were you?</i>', '{\\an8}<i>I was out.</i>']);
    // No cursor: the usual middle cut.
    const m = splitCue([{ id: 'b', start: 0, end: 4000, text: 'one two\nthree four' }], 'b', 2000, S)!;
    expect(m.cues.map((c) => c.text)).toEqual(['one two', 'three four']);
  });
});

describe('more formats', () => {
  it('reads and writes SBV', async () => {
    const { parseSubtitles, serialize } = await import('./formats');
    const doc = parseSubtitles('a.sbv', '0:00:01.000,0:00:03.500\nHello there\nfriend\n\n0:00:04.000,0:00:05.000\nBye\n');
    expect(doc.format).toBe('sbv');
    expect(doc.cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [1000, 3500, 'Hello there\nfriend'],
      [4000, 5000, 'Bye'],
    ]);
    expect(serialize({ ...doc, cues: [{ ...doc.cues[0], text: '{\\an8}<i>Hi</i>' }] }, 'sbv')).toBe('0:00:01.000,0:00:03.500\nHi\n');
  });

  it('reads ASS simply (italics, top, line breaks; styles dropped) and writes it back', async () => {
    const { parseSubtitles, serialize } = await import('./formats');
    const ass = [
      '[Script Info]',
      'ScriptType: v4.00+',
      '',
      '[V4+ Styles]',
      'Style: Default,Arial,20',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\an8\\c&H00FFFF&}Top line, with a comma\\Nsecond',
      'Dialogue: 0,0:00:04.00,0:00:05.20,Default,,0,0,0,,{\\i1}Whispered{\\i0} out loud',
      'Comment: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,not shown',
    ].join('\n');
    const doc = parseSubtitles('a.ass', ass);
    expect(doc.format).toBe('ass');
    expect(doc.cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [1500, 3000, '{\\an8}<font color="#FFFF00">Top line, with a comma\nsecond</font>'],
      [4000, 5200, '<i>Whispered</i> out loud'],
    ]);
    const out = serialize(doc, 'ass');
    expect(out).toContain('Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\an8}{\\c&H00FFFF&}Top line, with a comma\\Nsecond{\\c}');
    expect(out).toContain('{\\i1}Whispered{\\i0} out loud');
    expect(parseSubtitles('b.ass', out).cues.map((c) => c.text)).toEqual(doc.cues.map((c) => c.text));
  });

  it('reads TTML (times, italics, top region) and writes IMSC', async () => {
    const { parseSubtitles, serialize } = await import('./formats');
    const ttml = `<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25">
      <head><layout><region xml:id="r1" tts:displayAlign="after"/><region xml:id="r2" tts:displayAlign="before"/></layout></head>
      <body><div>
        <p begin="00:00:01.000" end="00:00:02.500" region="r1">Tom &amp; Jerry<br/>are <span tts:fontStyle="italic">here</span></p>
        <p begin="00:00:03:12" dur="1s" region="r2">On top</p>
        <p begin="5s" end="6500ms">Offsets</p>
      </div></body></tt>`;
    const doc = parseSubtitles('a.ttml', ttml);
    expect(doc.format).toBe('ttml');
    expect(doc.cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [1000, 2500, 'Tom & Jerry\nare <i>here</i>'],
      [3480, 4480, '{\\an8}On top'],
      [5000, 6500, 'Offsets'],
    ]);
    const out = serialize(doc, 'ttml', false, 'fr');
    expect(out).toContain('imsc1.1/text');
    expect(out).toContain('xml:lang="fr"');
    expect(out).toContain('<p begin="00:00:01.000" end="00:00:02.500" region="bottom">Tom &amp; Jerry<br/>are <span tts:fontStyle="italic">here</span></p>');
    expect(out).toContain('region="top">On top</p>');
    expect(parseSubtitles('b.ttml', out).cues.map((c) => c.text)).toEqual(doc.cues.map((c) => c.text));
  });
});

describe('shorten with AI', () => {
  it('builds items with their room, reads proposals, applies the accepted ones', async () => {
    const { condenseItems, proposals, applyProposals, condenseUserPrompt } = await import('./condense');
    const cues = [
      { id: 'a', start: 0, end: 1000, text: 'Before.' },
      { id: 'b', start: 1000, end: 2000, text: '<i>Well, you know, I really think that we should go now.</i>' },
      { id: 'c', start: 2000, end: 3000, text: 'After.' },
    ];
    const { items, ids } = condenseItems(cues, ['b'], 17);
    expect(items).toEqual([{ n: 1, text: 'Well, you know, I really think that we should go now.', maxChars: 17, before: 'Before.', after: 'After.' }]);
    expect(condenseUserPrompt(items)).toContain('"maxChars":17');
    const got = new Map([[1, 'We should go.']]);
    const ps = proposals(cues, ids, items, got);
    expect(ps).toMatchObject([{ id: 'b', after: '<i>We should go.</i>', stillLong: false }]);
    expect(applyProposals(cues, ps)[1].text).toBe('<i>We should go.</i>');
    // Unchanged answers are not proposals; still-too-long ones are flagged.
    expect(proposals(cues, ids, items, new Map([[1, 'Well, you know, I really think that we should go now.']]))).toEqual([]);
    expect(proposals(cues, ids, items, new Map([[1, 'I really think we should go now.']]))[0].stillLong).toBe(true);
  });
});

describe('no one-millisecond subtitles', () => {
  it('words at the same time join the next subtitle instead of lasting 1 ms', async () => {
    const { wordsToCues } = await import('./stt');
    const w = (text: string, start: number, end: number) => ({ text, start, end });
    const rules = { maxLineLength: 42, minDurationMs: 1000, minGapMs: 80 };
    // "No." then a pause-free burst stamped at the same moment.
    const cues = wordsToCues([w(' No.', 1000, 1000), w(' Are', 1050, 1200), w(' you', 1200, 1400), w(' kidding', 1400, 1800), w(' me?', 1800, 2100)], rules);
    expect(cues.every((c) => c.end - c.start >= 300)).toBe(true);
    expect(cues.map((c) => c.text).join(' ')).toContain('No.');
  });

  it('Shorten with AI leaves out subtitles with almost no time on screen', async () => {
    const { condenseItems } = await import('./condense');
    const cues = [
      { id: 'a', start: 0, end: 1, text: 'No. What, are you kidding me?' },
      { id: 'b', start: 1000, end: 2000, text: 'Well, you know, I think so.' },
    ];
    expect(condenseItems(cues, ['a', 'b'], 17).ids).toEqual(['b']);
  });
});

describe('time left', () => {
  it('estimates from the pace so far, and says it roughly', async () => {
    const { timeLeft, formatLeft } = await import('./time');
    expect(timeLeft(0, 10_000, 0, 100)).toBeNull();
    expect(timeLeft(0, 10_000, 25, 100)).toBe(30_000);
    expect(timeLeft(0, 10_000, 100, 100)).toBeNull();
    expect(formatLeft(30_000)).toBe('30 s');
    expect(formatLeft(180_000)).toBe('3 min');
    expect(formatLeft(80 * 60_000)).toBe('80 min');
    expect(formatLeft(125 * 60_000)).toBe('2 h 5 min');
  });
});

describe('Gemini models', () => {
  it('keeps Gemini text models, without the "models/" prefix', async () => {
    const { translationModels } = await import('./mtAi');
    const m = (id: string, created = 0) => ({ id, name: id, created });
    const got = translationModels('gemini', [
      m('models/gemini-2.5-flash'),
      m('models/gemini-embedding-001'),
      m('models/imagen-4.0'),
      m('models/gemini-2.5-flash-preview-tts'),
      m('models/gemini-flash-latest'),
    ]);
    expect(got.map((x) => x.id).sort()).toEqual(['gemini-2.5-flash', 'gemini-flash-latest']);
  });
});

describe('subtitles from the audio start on the speech', () => {
  it('moves a late start back to the speech onset, never onto the previous one', async () => {
    const { startOnSpeech } = await import('./stt');
    const cue = (id: string, start: number, end: number): Cue => ({ id, start, end, text: id });
    const spans: [number, number][] = [
      [1000, 3000],
      [3400, 6000],
      [9000, 9500],
    ];
    const out = startOnSpeech([cue('a', 1300, 2900), cue('b', 3500, 4500), cue('c', 4700, 5800), cue('d', 9100, 9400)], spans, 80);
    expect(out.map((c) => c.start)).toEqual([1000, 3400, 4700, 9000]);
    // The previous subtitle ends late: stop at the gap after it.
    expect(startOnSpeech([cue('a', 0, 3380), cue('b', 3600, 4000)], spans, 80)[1].start).toBe(3460);
    expect(startOnSpeech([cue('a', 1300, 2000)], null, 80)[0].start).toBe(1300);
  });
});

describe('misplaced words from Whisper', () => {
  const w = (text: string, start: number, end: number) => ({ text, start, end });
  it('keeps words inside their window', async () => {
    const { placeWords } = await import('./stt');
    const out = placeWords([w(' a', 900, 1200), w(' b', 29000, 31000)], [1000, 30000], null);
    expect(out.map((x) => [x.start, x.end])).toEqual([
      [1000, 1200],
      [29000, 30000],
    ]);
  });
  it('puts a sentence stamped too late back into the gap where it was said', async () => {
    const { placeWords } = await import('./stt');
    // Said at 3–5 s (speech there), stamped at 13–15 s, after the next sentence (8 s).
    const words = [w(' Hi.', 1000, 2000), w(' Where', 13000, 14000), w(' now?', 14000, 15000), w(' Here.', 8000, 9000)];
    const out = placeWords(
      words,
      [0, 28000],
      [
        [1000, 2000],
        [3000, 5000],
        [8000, 9000],
      ],
    );
    expect(out.map((x) => x.start)).toEqual([1000, 3000, 4000, 8000]);
    // Order kept, nothing over the next one.
    expect(out[2].end).toBeLessThanOrEqual(8000);
  });
  it('squeezes a run that is too long for its gap, and leaves good timings alone', async () => {
    const { placeWords } = await import('./stt');
    const out = placeWords([w(' a', 0, 500), w(' b', 10000, 14000), w(' c', 2000, 3000)], [0, 28000], null);
    expect(out[1].start).toBe(500);
    expect(out[1].end).toBe(2000);
    const fine = [w(' a', 0, 500), w(' b', 600, 900), w(' c', 950, 1200)];
    expect(placeWords(fine, [0, 28000], null)).toEqual(fine);
  });
});

describe('original unchanged while translating', () => {
  it('ignores translations, sees times and text', async () => {
    const { sameSource } = await import('./translation');
    const a: Cue[] = [{ id: 'x', start: 0, end: 1000, text: 'Hi' }];
    expect(sameSource(a, [{ ...a[0], target: 'Salut' }])).toBe(true);
    expect(sameSource(a, [{ ...a[0], end: 1200 }])).toBe(false);
    expect(sameSource(a, [{ ...a[0], text: 'Hey' }])).toBe(false);
    expect(sameSource(null, a)).toBe(false);
  });
});

describe('scene notes', () => {
  const cue = (id: string, start: number, end: number): Cue => ({ id, start, end, text: id });
  const notes = [
    { id: 'b', time: 20000, text: 'Thieves plan a heist' },
    { id: 'a', time: 5000, text: 'A priest scolds his pupil' },
    { id: 'c', time: 40000, text: '' },
  ];
  it('a scene runs from its note to the next one; an empty note ends it', async () => {
    const { noteAt, sceneEnd, cuesInScene } = await import('./sceneNotes');
    expect(noteAt(notes, 1000)).toBeNull();
    expect(noteAt(notes, 5000)?.id).toBe('a');
    expect(noteAt(notes, 25000)?.id).toBe('b');
    expect(noteAt(notes, 45000)).toBeNull();
    expect(sceneEnd(notes, notes[1])).toBe(20000);
    expect(sceneEnd(notes, notes[2])).toBeNull();
    // A subtitle starting just before the note belongs to it (its middle is after).
    const cues = [cue('x', 4800, 6000), cue('y', 19000, 21500), cue('z', 21000, 23000)];
    expect(cuesInScene(cues, notes, notes[1]).map((c) => c.id)).toEqual(['x']);
    expect(cuesInScene(cues, notes, notes[0]).map((c) => c.id)).toEqual(['y', 'z']);
  });
  it('numbers the notes a batch touches', async () => {
    const { batchScenes } = await import('./sceneNotes');
    const r = batchScenes([cue('w', 1000, 2000), cue('x', 6000, 7000), cue('y', 21000, 22000), cue('z', 8000, 9000)], notes);
    expect(r.scenes).toEqual(['A priest scolds his pupil', 'Thieves plan a heist']);
    expect(r.sceneOf).toEqual([undefined, 1, 2, 1]);
  });
});

describe('scene notes in the AI prompt', () => {
  it('lists the notes and numbers each subtitle with its scene', async () => {
    const { aiItems, aiUserPrompt } = await import('./mtAi');
    const cues: Cue[] = [
      { id: 'a', start: 0, end: 1000, text: 'Hi.' },
      { id: 'b', start: 2000, end: 3000, text: 'Sir.' },
    ];
    const p = aiUserPrompt(aiItems(cues, [undefined, 1]), [], ['A priest scolds his pupil']);
    expect(p).toContain('Scene notes:\n1. A priest scolds his pupil');
    expect(p).toContain('"n":2,"text":"Sir.","seconds":1,"scene":1');
    expect(p).not.toContain('"n":1,"text":"Hi.","seconds":1,"scene"');
    expect(aiUserPrompt(aiItems(cues), [])).not.toContain('Scene notes');
  });
});

describe('scene bands', () => {
  it('one band per note with text, to the next note or the end', async () => {
    const { sceneSpans } = await import('./sceneNotes');
    const spans = sceneSpans(
      [
        { id: 'a', time: 1000, text: 'Priest' },
        { id: 'b', time: 5000, text: '' },
        { id: 'c', time: 8000, text: 'Thieves' },
      ],
      20000,
    );
    expect(spans.map((s) => [s.note.id, s.from, s.to, s.alt])).toEqual([
      ['a', 1000, 5000, false],
      ['c', 8000, 20000, false],
    ]);
  });
});

describe('long file names', () => {
  it('cut in the middle, start and extension kept', async () => {
    const { middleEllipsis } = await import('./filename');
    const long = 'The.Grand.Budapest.Hotel.2014.1080p.BluRay.x264.mp4';
    const short = middleEllipsis(long, 32);
    expect(short.length).toBe(32);
    expect(short.startsWith('The.Grand.')).toBe(true);
    expect(short.endsWith('.x264.mp4')).toBe(true);
    expect(short).toContain('…');
    expect(middleEllipsis('film.mp4', 32)).toBe('film.mp4');
  });
});

describe('editing the original while translating', () => {
  it('tools see the original only, translations come back after', async () => {
    const { viewOf, restoreTargets } = await import('./translation');
    const cues: Cue[] = [{ id: 'a', start: 0, end: 1000, text: 'Hi', target: 'Salut' }];
    const seen = viewOf(cues, 'source');
    expect(seen[0].target).toBeUndefined();
    expect(viewOf(cues, 'target')).toBe(cues);
    const changed = seen.map((c) => ({ ...c, text: 'Hello', end: 1500 }));
    expect(restoreTargets(changed, cues)).toEqual([{ id: 'a', start: 0, end: 1500, text: 'Hello', target: 'Salut' }]);
  });
});

describe('projects', () => {
  const card = (id: string, updatedAt: number, video?: { name: string; size: number }) => ({
    id,
    title: id,
    video: video ?? null,
    subtitleName: null as string | null,
    cues: 0,
    updatedAt,
  });
  it('most recent first, the oldest leave beyond the limit', async () => {
    const { upsertCard } = await import('./projects');
    let list = [card('a', 1), card('b', 2)];
    const r = upsertCard(list, card('c', 3), 2);
    expect(r.list.map((c) => c.id)).toEqual(['c', 'b']);
    expect(r.evicted).toEqual(['a']);
    list = upsertCard(r.list, card('b', 4), 2).list;
    expect(list.map((c) => c.id)).toEqual(['b', 'c']);
  });
  it('finds the project of a video by name and size, and names projects', async () => {
    const { projectForVideo, projectTitle } = await import('./projects');
    const list = [card('a', 2, { name: 'film.mp4', size: 10 }), card('b', 1, { name: 'film.mp4', size: 11 })];
    expect(projectForVideo(list, { name: 'film.mp4', size: 11 }, null)?.id).toBe('b');
    expect(projectForVideo(list, { name: 'film.mp4', size: 10 }, 'a')).toBeUndefined();
    expect(projectTitle({ name: 'The.Film.2014.mp4' }, 'x.en.srt')).toBe('The.Film.2014');
    expect(projectTitle(null, 'The.Film.fr.srt')).toBe('The.Film');
    expect(projectTitle(null, null)).toBe('Untitled');
    expect(projectTitle({ name: 'The.Film.mp4' }, null, '  My test ')).toBe('My test');
  });
});

describe('video fingerprint', () => {
  it('ignores the name, sees the content, reads start / middle / end', async () => {
    const { videoFingerprint, sameVideo } = await import('./fingerprint');
    const big = new Uint8Array(5 * 1024 * 1024).map((_, i) => i % 251);
    const a = await videoFingerprint(new File([big], 'film.mp4'));
    const renamed = await videoFingerprint(new File([big], 'Another name.mp4'));
    expect(renamed).toBe(a);
    const changed = big.slice();
    changed[changed.length - 10] ^= 1; // a byte in the last MB
    expect(await videoFingerprint(new File([changed], 'film.mp4'))).not.toBe(a);
    expect(a.startsWith(`${big.length}-`)).toBe(true);
    expect(sameVideo({ name: 'x', size: 1, fp: 'A' }, { name: 'y', size: 1, fp: 'A' })).toBe(true);
    expect(sameVideo({ name: 'x', size: 1, fp: 'A' }, { name: 'x', size: 1, fp: 'B' })).toBe(false);
    expect(sameVideo({ name: 'x', size: 1 }, { name: 'x', size: 1, fp: 'B' })).toBe(true);
  });
});

describe('review with AI', () => {
  const cue = (id: string, text: string, target?: string): Cue => ({ id, start: 0, end: 1000, text, ...(target !== undefined ? { target } : {}) });
  it('items with their neighbours, empty ones left out', async () => {
    const { reviewItems } = await import('./review');
    const cues = [cue('a', 'Hi.'), cue('b', ''), cue('c', 'How many went on this movie filter?'), cue('d', 'Three.')];
    const r = reviewItems(cues, ['b', 'c']);
    expect(r.ids).toEqual(['c']);
    expect(r.items[0]).toMatchObject({ n: 1, text: 'How many went on this movie filter?', before: '', after: 'Three.' });
  });
  it('reads the answer and keeps the markup', async () => {
    const { reviewItems, parseReview, reviewProposals } = await import('./review');
    const cues = [cue('a', '<i>How many went on this movie filter?</i>'), cue('b', 'Its fine.')];
    const { items, ids } = reviewItems(cues, ['a', 'b']);
    const reply =
      'Sure: {"changes":[{"n":1,"text":"How many went on this field trip?","kind":"misheard","reason":"movie filter → field trip"},{"n":2,"text":"It\'s fine.","kind":"weird"},{"n":9,"text":"x"}]}';
    const got = parseReview(reply, items.length);
    expect(got.size).toBe(2);
    expect(got.get(2)?.kind).toBe('spelling');
    const p = reviewProposals(cues, ids, items, got);
    expect(p[0]).toMatchObject({ id: 'a', after: '<i>How many went on this field trip?</i>', kind: 'misheard' });
    expect(p[1]).toMatchObject({ id: 'b', after: "It's fine." });
  });
});

describe('review: corrections on the wrong number', () => {
  it('goes to the subtitle it looks like, or is dropped', async () => {
    const { alignChanges, similarity } = await import('./review');
    const items = [
      { n: 1, text: 'Vous me mettez dans la merde avec ça.' },
      { n: 2, text: "D'abors Opherson, maintenant vous ?" },
      { n: 3, text: 'Hi.' },
    ];
    expect(similarity("D'abors Opherson, maintenant vous ?", "D'abord Opherson, maintenant vous ?")).toBeGreaterThan(0.8);
    expect(similarity('Vous me mettez dans la merde avec ça.', "D'abord Opherson, maintenant vous ?")).toBeLessThan(0.45);
    const got = new Map([
      [1, { text: "D'abord Opherson, maintenant vous ?", kind: 'spelling' as const, reason: '' }], // put on n 1 by mistake
      [3, { text: 'Hey.', kind: 'misheard' as const, reason: '' }],
      [5, { text: 'Something else entirely.', kind: 'grammar' as const, reason: '' }],
    ]);
    const r = alignChanges(items, got);
    expect([...r.keys()].sort()).toEqual([2, 3]);
    // The last of a batch: the model corrected the "after" context (next batch) and put it here.
    const last = [{ n: 1, text: 'Je suis désolé.', before: 'Ok.', after: 'Tant pis. Allez laver.' }];
    const wrong = new Map([[1, { text: 'Tant pis. Allez, lave.', kind: 'misheard' as const, reason: '' }]]);
    expect(alignChanges(last, wrong).size).toBe(0);
    expect(r.get(2)?.text).toBe("D'abord Opherson, maintenant vous ?");
  });
});

describe('AI answers that change nothing', () => {
  it('are not proposed (spaces and line breaks aside)', async () => {
    const { sameWords } = await import('./markup');
    expect(sameWords('ANTICHRIST.', ' ANTICHRIST. ')).toBe(true);
    expect(sameWords('Two\nlines', 'Two lines')).toBe(true);
    expect(sameWords('Two lines', 'Two line')).toBe(false);
  });
});

// A tiny Matroska writer: every size on 8 bytes, numbers on 8 bytes (valid EBML, easy offsets).
const ebmlId = (id: number) => {
  const b: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) b.unshift(v % 256);
  return b;
};
const sz = (n: number) => [0x01, 0, 0, ...[4, 3, 2, 1, 0].map((i) => Math.floor(n / 256 ** i) % 256)];
const u8 = (n: number) => [0, 0, 0, ...[4, 3, 2, 1, 0].map((i) => Math.floor(n / 256 ** i) % 256)];
const el = (id: number, ...parts: (number[] | Uint8Array)[]) => {
  const body = parts.flatMap((x) => [...x]);
  return [...ebmlId(id), ...sz(body.length), ...body];
};
const txt = (s: string) => [...new TextEncoder().encode(s)];
const block = (track: number, rel: number, data: number[]) => [0x80 | track, (rel >> 8) & 0xff, rel & 0xff, 0x80, ...data];

function makeMkv(withCues: boolean, strip = false) {
  const tracks = el(
    0x1654ae6b,
    el(0xae, el(0xd7, [1]), el(0x83, [1]), el(0x86, txt('V_MPEG4/ISO/AVC'))),
    el(
      0xae,
      el(0xd7, [2]),
      el(0x83, [0x11]),
      el(0x86, txt('S_TEXT/UTF8')),
      el(0x22b59c, txt('fre')),
      el(0x536e, txt('French Forced')),
      el(0x55aa, [1]),
      ...(strip ? [el(0x6d80, el(0x6240, el(0x5034, el(0x4254, [3]), el(0x4255, txt('<i>')))))] : []),
    ),
    el(0xae, el(0xd7, [3]), el(0x83, [0x11]), el(0x86, txt('S_TEXT/ASS')), el(0x22b59c, txt('eng'))),
    el(0xae, el(0xd7, [4]), el(0x83, [0x11]), el(0x86, txt('S_HDMV/PGS'))),
  );
  const info = el(0x1549a966, el(0x2ad7b1, u8(1_000_000)), el(0x5741, txt(withCues ? 'mkvmerge v80.0' : 'Lavf60')));
  const fr = (s: string) => txt(strip ? s.replace(/^<i>/, '') : s);
  // Cluster 1 at 0 ms, cluster 2 at 5000 ms: video frames around the subtitles.
  const c1kids = [
    el(0xe7, u8(0)),
    el(0xa3, block(1, 0, [9, 9, 9])),
    el(0xa0, el(0xa1, block(2, 1000, fr('<i>Bonjour.</i>'))), el(0x9b, u8(1500))),
    el(0xa3, block(1, 40, [9, 9])),
    el(0xa0, el(0xa1, block(3, 2000, txt('0,0,Default,,0,0,0,,{\\i1}Hello{\\i0},\\Nyou'))), el(0x9b, u8(800))),
  ];
  const c2kids = [el(0xe7, u8(5000)), el(0xa3, block(1, 0, [9])), el(0xa0, el(0xa1, block(2, -200, fr('Au revoir.'))), el(0x9b, u8(1000)))];
  const rel = (kids: number[][], i: number) => kids.slice(0, i).reduce((a, k) => a + k.length, 0);
  const c1 = el(0x1f43b675, ...c1kids);
  const c2 = el(0x1f43b675, ...c2kids);
  const seekLen = el(0x114d9b74, el(0x4dbb, el(0x53ab, [0x1c, 0x53, 0xbb, 0x6b]), el(0x53ac, u8(0)))).length;
  const c1At = seekLen + info.length + tracks.length;
  const c2At = c1At + c1.length;
  const cuesAt = c2At + c2.length;
  const point = (time: number, track: number, cluster: number, relative: number) =>
    el(0xbb, el(0xb3, u8(time)), el(0xb7, el(0xf7, [track]), el(0xf1, u8(cluster)), el(0xf0, u8(relative))));
  const cues = el(0x1c53bb6b, point(1000, 2, c1At, rel(c1kids, 2)), point(2000, 3, c1At, rel(c1kids, 4)), point(4800, 2, c2At, rel(c2kids, 2)));
  const seek = el(0x114d9b74, el(0x4dbb, el(0x53ab, [0x1c, 0x53, 0xbb, 0x6b]), el(0x53ac, u8(withCues ? cuesAt : 0))));
  const body = [...seek, ...info, ...tracks, ...c1, ...c2, ...(withCues ? cues : [])];
  const file = new Uint8Array([...el(0x1a45dfa3, el(0x4282, txt('matroska'))), ...el(0x18538067, body)]);
  return { file, read: async (o: number, n: number) => file.slice(o, o + n) };
}

describe('mkv subtitles', () => {
  it('lists the subtitle tracks with language, name, forced and whether they are text', async () => {
    const { file, read } = makeMkv(true);
    const info = await readMkvInfo(read, file.length);
    expect(info.tracks.map((t) => [t.number, t.codec, t.language, t.name, t.forced, t.text])).toEqual([
      [2, 'S_TEXT/UTF8', 'fre', 'French Forced', true, true],
      [3, 'S_TEXT/ASS', 'eng', '', false, true],
      [4, 'S_HDMV/PGS', 'eng', '', false, false],
    ]);
    expect(info.cuesAt).not.toBeNull();
  });

  it('reads a track through the index, else by walking the clusters, with the same result', async () => {
    for (const withCues of [true, false]) {
      const { file, read } = makeMkv(withCues);
      const info = await readMkvInfo(read, file.length);
      const { blocks, via } = await readMkvSubs(read, info, [2]);
      expect(via).toBe(withCues ? 'index' : 'scan');
      const cues = await mkvCues(blocks, info.tracks[0]);
      expect(cues.map((c) => [c.start, c.end, c.text])).toEqual([
        [1000, 2500, '<i>Bonjour.</i>'],
        [4800, 5800, 'Au revoir.'],
      ]);
    }
  });

  it('walks the file when the index was not written by mkvmerge (it may miss subtitles)', async () => {
    const { file, read } = makeMkv(true);
    const info = { ...(await readMkvInfo(read, file.length)), writingApp: 'Lavf60' };
    const { blocks, via } = await readMkvSubs(read, info, [2]);
    expect(via).toBe('scan');
    expect(blocks).toHaveLength(2);
  });

  it('names the tracks and their language as we use them', () => {
    expect(langFromTrack('fre')).toBe('fr');
    expect(langFromTrack('fr-FR')).toBe('fr');
    expect(langFromTrack('pt-BR')).toBe('pt-BR');
    expect(langFromTrack('und')).toBeNull();
    const tr = (language: string, name: string, forced = false) => ({ number: 3, codec: 'S_TEXT/UTF8', language, name, isDefault: false, forced, text: true });
    expect(trackLabel(tr('fre', 'French Forced', true))).toBe('French · Forced');
    expect(trackLabel(tr('eng', 'SDH'))).toBe('English · SDH');
    expect(trackLabel(tr('eng', 'English (UK)'))).toBe('English (UK)');
    expect(trackLabel(tr('fre', '', true))).toBe('French · Forced');
    expect(trackLabel(tr('und', ''))).toBe('Track 3');
  });

  it('turns ASS frames into Subtle text and puts back stripped headers', async () => {
    const { file, read } = makeMkv(false, true);
    const info = await readMkvInfo(read, file.length);
    const ass = await mkvCues((await readMkvSubs(read, info, [3])).blocks, info.tracks[1]);
    expect(ass.map((c) => [c.start, c.end, c.text])).toEqual([[2000, 2800, '<i>Hello</i>,\nyou']]);
    const fr = await mkvCues((await readMkvSubs(read, info, [2])).blocks, info.tracks[0]);
    expect(fr[0].text).toBe('<i>Bonjour.</i>');
  });
});

describe('windowing (long lists drawn in part)', () => {
  const offsets = offsetsOf([50, 50, 100, 50, 50]); // 0 50 100 200 250 300
  it('adds up where rows start', () => {
    expect(offsets).toEqual([0, 50, 100, 200, 250, 300]);
  });
  it('draws the rows in view plus a margin', () => {
    expect(rangeAt(offsets, 0, 60, 0)).toEqual([0, 2]);
    expect(rangeAt(offsets, 120, 60, 0)).toEqual([2, 3]);
    expect(rangeAt(offsets, 120, 60, 60)).toEqual([1, 4]); // 60 → 240
    expect(rangeAt(offsetsOf([]), 0, 100, 0)).toEqual([0, 0]);
  });
  it('scrolls a row into view, or not when it shows', () => {
    expect(scrollFor(offsets, 1, 0, 120, 'nearest')).toBeNull();
    expect(scrollFor(offsets, 3, 0, 120, 'nearest')).toBe(138); // its bottom at the view's bottom, 8 px in
    expect(scrollFor(offsets, 0, 100, 120, 'nearest')).toBe(0);
    expect(scrollFor(offsets, 2, 0, 60, 'center')).toBe(120); // 100 tall in 60: centred
    expect(scrollFor(offsets, 4, 0, 120, 'center')).toBe(180); // never past the end
  });
  it('tells whether a row shows', () => {
    expect(rowInView(offsets, 1, 0, 120)).toBe(true);
    expect(rowInView(offsets, 4, 0, 120)).toBe(false);
  });
});

describe('wide menu', () => {
  const it_ = (section?: string) => ({ section });
  it('puts whole sections side by side, columns as even as can be', () => {
    // Quality 1, Timing 5, Text 5, File 3 (the Tools menu)
    const items = [it_('Q'), it_('T'), it_(), it_(), it_(), it_(), it_('X'), it_(), it_(), it_(), it_(), it_('F'), it_(), it_()];
    expect(menuColumns(items, 2).map((col) => col.map((s) => s.length))).toEqual([
      [1, 5],
      [5, 3],
    ]);
    expect(menuColumns(items, 1)).toHaveLength(1);
    expect(menuColumns([it_('A'), it_()], 2).map((c) => c.length)).toEqual([1]);
  });
});

describe('projects page', () => {
  it('names a copy after the original, never twice the same', async () => {
    const { copyName } = await import('./projects');
    expect(copyName('Film', [])).toBe('Film copy');
    expect(copyName('Film', ['Film copy'])).toBe('Film copy 2');
    expect(copyName('Film copy', ['Film copy', 'Film copy 2'])).toBe('Film copy 3');
  });
  it('finds projects by title, film or subtitle file', async () => {
    const { filterProjects } = await import('./projects');
    const c = (id: string, title: string, video: string | null, subs: string | null) => ({
      id,
      title,
      video: video ? { name: video, size: 1 } : null,
      subtitleName: subs,
      cues: 0,
      updatedAt: 0,
    });
    const list = [c('a', 'The Odyssey', 'Odyssey.2160p.mkv', null), c('b', 'Le prêtre', null, 'pretre.fr.srt')];
    expect(filterProjects(list, 'odyssey 2160').map((p) => p.id)).toEqual(['a']);
    expect(filterProjects(list, 'PRETRE').map((p) => p.id)).toEqual(['b']);
    expect(filterProjects(list, '  ')).toHaveLength(2);
  });
  it('writes a project file without file handles, and reads it back', async () => {
    const { projectFileText, readProjectFile } = await import('./projects');
    const text = projectFileText({ doc: { cues: [{ id: '1' }] }, name: 'X', fileHandle: {}, videoHandle: {} });
    const back = readProjectFile(text);
    expect(back?.name).toBe('X');
    expect(back && 'fileHandle' in back).toBe(false);
    expect(readProjectFile('{"format":"other"}')).toBeNull();
    expect(readProjectFile('not json')).toBeNull();
  });
});

describe('browser support', () => {
  const all = { videoDecoder: true, audioDecoder: true, saveFilePicker: true, gpu: true, launchQueue: true };
  it('finds nothing missing in Chrome, what Firefox / Safari lack elsewhere', async () => {
    const { missingFeatures, worthTelling } = await import('./support');
    expect(missingFeatures(all)).toEqual([]);
    const safari = missingFeatures({ ...all, audioDecoder: false, saveFilePicker: false, launchQueue: false });
    expect(safari).toEqual(['codecs', 'files', 'install']);
    expect(worthTelling(safari)).toBe(true);
    expect(worthTelling(missingFeatures({ ...all, gpu: false }))).toBe(false);
  });
  it('reads the capabilities from what the page has', async () => {
    const { capabilitiesHere } = await import('./support');
    expect(capabilitiesHere({ VideoDecoder: function () {}, navigator: {} })).toEqual({
      videoDecoder: true,
      audioDecoder: false,
      saveFilePicker: false,
      gpu: false,
      launchQueue: false,
    });
  });
});

describe('project files from elsewhere', () => {
  it('keeps what makes sense, drops or mends the rest', async () => {
    const { cleanProject } = await import('./projects');
    const p = cleanProject({
      doc: {
        format: 'evil',
        cues: [{ id: 'a', start: 2000, end: 1000, text: 'Hi' }, { text: {} }, { id: 'a', start: 0, end: 500, text: 7 }, 'x'],
        lang: '<script>',
      },
      bookmarks: 'x',
      selections: [{ label: 'Scene 1', ids: ['a', 'nobody', 3] }, { ids: ['nobody'] }, 'x'],
      sceneNotes: [{ time: 'soon' }, { time: 5, text: 'Ok' }],
      translation: { targetLang: 'fr' },
      picture: 'https://tracker.example/p.gif',
      name: '  Mine  ',
      video: { name: 'film.mkv', size: 10 },
    })!;
    expect(p.doc.format).toBe('srt');
    expect(p.doc.lang).toBeUndefined();
    expect(p.doc.cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [0, 500, ''],
      [2000, 2000, 'Hi'],
    ]);
    expect(new Set(p.doc.cues.map((c) => c.id)).size).toBe(2); // the twin id was renewed
    expect(p.bookmarks).toEqual([]);
    // Only ids of subtitles in the file; a selection left empty goes.
    expect(p.selections.map((x) => [x.label, x.ids])).toEqual([['Scene 1', ['a']]]);
    expect(p.sceneNotes.map((n) => n.text)).toEqual(['Ok']);
    expect(p.translation).toEqual({ targetLang: 'fr' });
    expect(p.picture).toBeNull();
    expect(p.name).toBe('Mine');
    expect(p.video).toEqual({ name: 'film.mkv', size: 10, durationMs: 0 });
    expect(cleanProject({ doc: { cues: 'x' } })).toBeNull();
    expect(cleanProject(null)).toBeNull();
  });
  it('accepts only pictures held in the file', async () => {
    const { safePicture } = await import('./projects');
    expect(safePicture('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
    expect(safePicture('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(safePicture('javascript:alert(1)')).toBeNull();
  });
});

describe('crafted files', () => {
  it('leaves out a subtitle that inflates past 1 MB, keeps the others', async () => {
    const { mkvCues } = await import('./mkv');
    const pack = async (bytes: Uint8Array) =>
      new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const bomb = await pack(new Uint8Array(3 * 1024 * 1024));
    const ok = await pack(new TextEncoder().encode('Hello'));
    const track = { number: 2, codec: 'S_TEXT/UTF8', language: 'eng', name: '', isDefault: true, forced: false, text: true, compression: 0 };
    const cues = await mkvCues(
      [
        { track: 2, start: 0, end: 1000, data: bomb },
        { track: 2, start: 2000, end: 3000, data: ok },
      ],
      track,
    );
    expect(bomb.length).toBeLessThan(10_000);
    expect(cues.map((c) => c.text)).toEqual(['Hello']);
  });
  it('opens a TTML file with an impossible character reference', async () => {
    const { parseTtml } = await import('./formatsMore');
    const doc = parseTtml(
      '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:01.000" end="00:00:02.000">A &#99999999; B &#233;</p></div></body></tt>',
    );
    expect(doc.cues.map((c) => c.text)).toEqual(['A &#99999999; B é']);
  });
});

describe('shared helpers', () => {
  it('shows sizes, film lengths and safe file names', async () => {
    const { formatBytes } = await import('./bytes');
    const { formatLength } = await import('./time');
    const { safeFileName } = await import('./filename');
    expect([formatBytes(640 * 1024), formatBytes(4.2 * 1024 * 1024), formatBytes(1.5 * 1024 ** 3)]).toEqual(['640 KB', '4.2 MB', '1.5 GB']);
    expect([formatLength(58_000), formatLength(24 * 60_000 + 10_000), formatLength(2 * 3_600_000 + 52 * 60_000 + 35_000)]).toEqual([
      '0:58',
      '24:10',
      '2:52:35',
    ]);
    expect(safeFileName('My: film/cut?', 'x')).toBe('My filmcut');
    expect(safeFileName('...', 'Project')).toBe('Project');
  });
});

describe('timeline magnet', () => {
  it('catches the nearest point within reach, else nothing', async () => {
    const { snapNear } = await import('./snap');
    const pts = [
      { at: 1000, kind: 'subtitle' as const },
      { at: 2000, kind: 'speech' as const },
    ];
    expect(snapNear(1030, pts, 50)?.at).toBe(1000);
    expect(snapNear(1100, pts, 50)).toBeNull();
    expect(snapNear(1980, pts, 50)?.kind).toBe('speech');
  });
  it('aims at the playhead where the drag began, not where it follows the edge', async () => {
    const { snapPoints, snapNear } = await import('./snap');
    // Edge dragged from 5000; the playhead followed it to 5000, then the mouse moves to 5060.
    const points = snapPoints(3000, [{ start: 8000, end: 9000 }], 80);
    expect(points.map((p) => p.at)).toEqual([3000, 7920, 9080]);
    expect(snapNear(5060, points, 100)).toBeNull(); // moves freely (it used to stick at 5000)
    expect(snapNear(3040, points, 100)?.kind).toBe('playhead');
  });
  it('catches where speech starts and ends', async () => {
    const { snapPoints, snapNear } = await import('./snap');
    const points = snapPoints(0, [], 80, [[12_340, 14_900]]);
    expect(snapNear(12_400, points, 100)).toEqual({ at: 12_340, kind: 'speech' });
    expect(snapNear(14_850, points, 100)).toEqual({ at: 14_900, kind: 'speech' });
  });
});

describe('partial texts (UI languages)', async () => {
  const { fillFrom, missingKeys } = await import('./partial');
  const full = { a: 'A', b: { c: 'C', d: (n: number) => `${n}` }, keys: {} as Record<string, string>, list: ['x', 'y'] };

  it('fills missing phrases from the full version', () => {
    const t = fillFrom(full, { b: { c: 'cé' }, keys: { Space: 'Espace' } });
    expect(t.a).toBe('A');
    expect(t.b.c).toBe('cé');
    expect(t.b.d(2)).toBe('2');
    expect(t.keys).toEqual({ Space: 'Espace' });
    expect(t.list).toEqual(['x', 'y']);
    expect(fillFrom(full, { list: ['z'] }).list).toEqual(['z']);
  });

  it('lists what a language lacks', () => {
    expect(missingKeys(full, { b: { c: 'cé' } })).toEqual(['a', 'b.d', 'list']);
    expect(missingKeys(full, full)).toEqual([]);
  });

  it('French and Spanish: phrases still in English', async () => {
    const { en } = await import('../i18n/en');
    for (const [code, tr] of [
      ['fr', (await import('../i18n/fr')).fr],
      ['es', (await import('../i18n/es')).es],
    ] as const) {
      const missing = missingKeys(en, tr);
      // A list to work from, not a failure: a language may ship half translated.
      if (missing.length) console.info(`${code}: ${missing.length} phrases in English\n  ${missing.join('\n  ')}`);
      expect(Array.isArray(missing)).toBe(true);
    }
  });
});

describe('nextMark (bookmarks and scene notes)', () => {
  const marks = [5000, 1000, 9000];
  it('finds the mark before or after, skipping the one here', () => {
    expect(nextMark(marks, 0, 1)).toBe(1000);
    expect(nextMark(marks, 1000, 1)).toBe(5000);
    expect(nextMark(marks, 1100, -1)).toBeNull(); // 1000 is "here"
    expect(nextMark(marks, 6000, -1)).toBe(5000);
    expect(nextMark(marks, 5100, -1)).toBe(1000);
    expect(nextMark(marks, 9000, 1)).toBeNull();
    expect(nextMark([], 0, 1)).toBeNull();
  });
});

describe('detected language (speech to text)', async () => {
  const { whisperLang, mainLanguage } = await import('./stt');
  it('reads Whisper language tokens only', () => {
    expect(whisperLang('<|es|>')).toBe('es');
    expect(whisperLang('<|haw|>')).toBe('haw');
    expect(whisperLang('<|transcribe|>')).toBeNull();
    expect(whisperLang('<|0.00|>')).toBeNull();
    expect(whisperLang('es')).toBeNull();
  });
  it('keeps the language heard longest', () => {
    expect(
      mainLanguage(
        new Map([
          ['en', 3000],
          ['es', 20000],
          ['fr', 5000],
        ]),
      ),
    ).toBe('es');
    expect(mainLanguage(new Map())).toBeNull();
  });
});

describe('cuesInSpan (drag to select)', async () => {
  const { cuesInSpan } = await import('./tools');
  const cues = [
    { id: 'a', start: 0, end: 1000, text: '' },
    { id: 'b', start: 2000, end: 3000, text: '' },
    { id: 'c', start: 4000, end: 5000, text: '' },
  ];
  it('takes every subtitle the span touches, dragged either way', () => {
    expect(cuesInSpan(cues, 500, 2100)).toEqual(['a', 'b']);
    expect(cuesInSpan(cues, 4500, 2900)).toEqual(['b', 'c']);
    expect(cuesInSpan(cues, 1000, 2000)).toEqual([]);
  });
});

describe('instruction in the AI prompt (retranslate the selection)', async () => {
  const { aiUserPrompt } = await import('./mtAi');
  it('comes first when given, not at all otherwise', () => {
    const items = [{ n: 1, text: 'Hi', seconds: 1 }];
    expect(aiUserPrompt(items, [], [], '  vouvoyer ')).toMatch(/^Instruction from the person editing.*: vouvoyer\n/);
    expect(aiUserPrompt(items, [], [], '  ')).not.toMatch(/Instruction/);
    expect(aiUserPrompt(items, [])).not.toMatch(/Instruction/);
  });
});

describe('filmContext (part of a film translated again)', async () => {
  const { filmContext, aiUserPrompt } = await import('./mtAi');
  const film = Array.from({ length: 20 }, (_, i) => ({
    id: `c${i}`,
    start: i * 1000,
    end: i * 1000 + 900,
    text: `line ${i}`,
    ...(i === 3 ? { target: 'ligne 3' } : {}),
  }));
  it('takes the subtitles just before and after, with their translations', () => {
    const batch = film.slice(10, 13);
    const ctx = filmContext(film, batch, new Map([['c9', 'neuf']]));
    expect(ctx.before.map((c) => c.text)).toEqual(['line 2', 'line 3', 'line 4', 'line 5', 'line 6', 'line 7', 'line 8', 'line 9']);
    expect(ctx.before[1].translation).toBe('ligne 3');
    expect(ctx.before.at(-1)!.translation).toBe('neuf');
    expect(ctx.after.map((c) => c.text)).toEqual(['line 13', 'line 14', 'line 15', 'line 16']);
    expect(filmContext(film, film.slice(0, 2), new Map()).before).toEqual([]);
  });
  it('puts the context after at the end of the prompt', () => {
    const p = aiUserPrompt([{ n: 1, text: 'Hi', seconds: 1 }], [], [], '', [{ text: 'Next', translation: 'Suivant' }]);
    expect(p).toMatch(/Translate:\n.*\n\nContext \(just after, do not translate\):\n- Next  →  Suivant$/);
  });
});

describe('check the translation with AI', async () => {
  const { checkItems, checkUserPrompt, parseReview, CHECK_KINDS, reviewProposals } = await import('./review');
  const cues = [
    { id: 'a', start: 0, end: 1000, text: 'Hello.', target: 'Bonjour.' },
    { id: 'b', start: 2000, end: 3000, text: "I don't know.", target: 'Je sais.' },
    { id: 'c', start: 4000, end: 5000, text: 'Not yet.' },
    { id: 'd', start: 6000, end: 7000, text: '{\\an8}Come with me.', target: '{\\an8}Viens avec moi.' },
  ];
  const notes = [{ id: 'n', time: 1500, text: 'Two strangers' }];
  it('takes the translated subtitles with their original, neighbours and scene', () => {
    const { items, ids, scenes } = checkItems(cues, ['a', 'b', 'c', 'd'], notes);
    expect(ids).toEqual(['a', 'b', 'd']);
    expect(items[1]).toEqual({ n: 2, original: "I don't know.", text: 'Je sais.', before: 'Bonjour.', after: undefined, scene: 1 });
    expect(items[2].text).toBe('Viens avec moi.');
    expect(scenes).toEqual(['Two strangers']);
    expect(checkUserPrompt(items, scenes)).toMatch(/^Scene notes:\n1\. Two strangers\n\nCheck:\n\{"subtitles"/);
  });
  it('reads its kinds and keeps the markup', () => {
    const { items, ids } = checkItems(cues, ['a', 'b', 'd'], []);
    const got = parseReview(
      '{"changes":[{"n":2,"text":"Je ne sais pas.","kind":"meaning","reason":"negation lost"},{"n":3,"text":"Venez avec moi.","kind":"oops"}]}',
      3,
      CHECK_KINDS,
    );
    expect(got.get(2)!.kind).toBe('meaning');
    expect(got.get(3)!.kind).toBe('meaning');
    const props = reviewProposals(cues, ids, items, got);
    expect(props.map((p) => [p.id, p.field, p.after])).toEqual([
      ['b', 'target', 'Je ne sais pas.'],
      ['d', 'target', '{\\an8}Venez avec moi.'],
    ]);
  });
});

describe('AI prompts name languages in English, whatever the UI language', async () => {
  const { setLanguageNameLocale } = await import('./languages');
  const { aiSystemPrompt } = await import('./mtAi');
  const { checkSystemPrompt } = await import('./review');
  it('says French, not Français', () => {
    setLanguageNameLocale('fr');
    try {
      expect(aiSystemPrompt('en', 'fr', 42, 17)).toMatch(/from English \(en\) into French \(fr\)/);
      expect(checkSystemPrompt('en', 'fr')).toMatch(/in English \(en\).*into French \(fr\)/);
    } finally {
      setLanguageNameLocale('en');
    }
  });
});

describe('wordDiff (AI proposals)', async () => {
  const { wordDiff } = await import('./wordDiff');
  const show = (a: string, b: string) =>
    wordDiff(a, b)
      .map((p) => (p.kind === 'same' ? p.text : p.kind === 'del' ? `[-${p.text}]` : `[+${p.text}]`))
      .join('');
  it('marks the words removed and added, the rest kept', () => {
    expect(show('Tu as dit minuit.', 'Vous avez dit minuit.')).toBe('[-Tu as] [+Vous avez] dit minuit.');
    expect(show('Oui. On l’a pris.', 'Non. On ne l’a pas pris.')).toBe('[-Oui.] [+Non.] On [+ne] l’a [+pas] pris.');
    expect(show('Same.', 'Same.')).toBe('Same.');
    expect(show('', 'New')).toBe('[+New]');
  });
});

describe('Sync by ear: the lines proposed', async () => {
  const { pickLineAt, speechAt } = await import('./sync');
  const cue = (i: number, text = 'A clear line of dialogue here.') => ({ id: `c${i}`, start: i * 3000, end: i * 3000 + 2500, text });
  it('takes the 5th line from the end or the start, a clear one further in', () => {
    const cues = Array.from({ length: 20 }, (_, i) => cue(i));
    expect(pickLineAt(cues, 5, 'end')).toBe(15);
    expect(pickLineAt(cues, 5, 'start')).toBe(4);
    cues[15] = cue(15, '[music]');
    cues[4] = cue(4, '♪');
    expect(pickLineAt(cues, 5, 'end')).toBe(14);
    expect(pickLineAt(cues, 5, 'start')).toBe(5);
    expect(pickLineAt(cues.slice(0, 3), 5, 'end')).toBe(0);
    expect(pickLineAt(cues.slice(0, 3), 5, 'start')).toBe(2);
  });
  it('finds where the 5th line of dialogue from either side starts', () => {
    const spans: [number, number][] = Array.from({ length: 8 }, (_, i) => [i * 1000, i * 1000 + 500]);
    expect(speechAt(spans, 5, 'end')).toBe(3000);
    expect(speechAt(spans, 5, 'start')).toBe(4000);
    expect(speechAt(spans.slice(0, 2), 5, 'end')).toBe(0);
    expect(speechAt(null, 5, 'start')).toBeNull();
  });
});

describe('Shift times: typed offsets and guessing from the dialogue', async () => {
  const { parseOffset, guessOffset } = await import('./sync');
  it('reads seconds, milliseconds and minutes', () => {
    expect(parseOffset('1.5')).toBe(1500);
    expect(parseOffset('-0,4')).toBe(-400);
    expect(parseOffset('+2 s')).toBe(2000);
    expect(parseOffset('−3')).toBe(-3000);
    expect(parseOffset('1500 ms')).toBe(1500);
    expect(parseOffset('1:20.5')).toBe(80500);
    expect(parseOffset('-1:05')).toBe(-65000);
    expect(parseOffset('abc')).toBeNull();
    expect(parseOffset('')).toBeNull();
  });
  it('finds the shift that puts the subtitles on the voices', () => {
    const cues = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, start: i * 4000 + (i % 3) * 300, end: i * 4000 + 2000 + (i % 3) * 300, text: 'line' }));
    const spans: [number, number][] = cues.map((c) => [c.start + 4800, c.end + 4800]);
    const g = guessOffset(cues, spans)!;
    expect(g.offset).toBe(4800);
    expect(g.share).toBeCloseTo(1);
    expect(guessOffset(cues, null)).toBeNull();
    expect(guessOffset([], spans)).toBeNull();
  });
});

describe('scopeFilter (batch tools)', async () => {
  const { scopeFilter } = await import('./tools');
  const cues = [0, 1, 2, 3].map((i) => ({ id: `c${i}`, start: i * 1000, end: i * 1000 + 500, text: 'x' }));
  it('takes all, the selected ones, or from the first selected one on', () => {
    expect(cues.filter(scopeFilter(cues, 'all', [])).length).toBe(4);
    expect(cues.filter(scopeFilter(cues, 'selection', ['c1', 'c3'])).map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(cues.filter(scopeFilter(cues, 'fromSelected', ['c2'])).map((c) => c.id)).toEqual(['c2', 'c3']);
  });
});

describe('shortcuts in a text', () => {
  it('turns a bracketed key into a key, other brackets stay', () => {
    expect(keyParts('Add a bookmark (B)')).toEqual(['Add a bookmark ', { key: 'B' }]);
    expect(keyParts('Pulsa Aquí (Intro)')).toEqual(['Pulsa Aquí ', { key: 'Intro' }]);
    expect(keyParts('Save (⇧⌘S) now')).toEqual(['Save ', { key: '⇧⌘S' }, ' now']);
    expect(keyParts('Zoom in (⌘ wheel)')).toEqual(['Zoom in ', { key: '⌘' }, ' wheel']);
    expect(keyParts('Go to bookmark 1 (1–9)')).toEqual(['Go to bookmark 1 ', { key: '1–9' }]);
    expect(keyParts('Magnet (⌥ while dragging: off)')).toEqual(['Magnet (⌥ while dragging: off)']);
    expect(keyParts('Minimum (s)')).toEqual(['Minimum (s)']);
    expect(keyParts('Press Here (Enter) when')).toEqual(['Press Here ', { key: 'Enter' }, ' when']);
  });
});

describe('Align on the dialogue', async () => {
  const { alignToSpeech } = await import('./align');
  const cue = (id: string, start: number, end: number, text = 'Hi'): Cue => ({ id, start, end, text });
  const O = { maxMs: 1000, starts: true, ends: true, gapMs: 80, floorMs: 300 };

  it('moves start and end to the speech that touches the subtitle', () => {
    const r = alignToSpeech([cue('a', 10400, 12500)], [[10000, 12000]], O);
    expect(r.cues[0]).toMatchObject({ start: 10000, end: 12000 });
    expect(r.moved).toEqual(['a']);
  });

  it('leaves subtitles without speech near, and ignores sounds that touch no subtitle', () => {
    const r = alignToSpeech(
      [cue('title', 0, 3000), cue('b', 10400, 12000)],
      [
        [8000, 8300],
        [10200, 11900],
      ],
      O,
    );
    expect(r.cues[0]).toMatchObject({ start: 0, end: 3000 });
    expect(r.cues[1]).toMatchObject({ start: 10200, end: 11900 });
  });

  it('never moves further than maxMs', () => {
    const r = alignToSpeech([cue('a', 12000, 14000)], [[10000, 13000]], O);
    expect(r.cues[0].start).toBe(12000);
    expect(r.cues[0].end).toBe(13000);
  });

  it('two lines said without a pause keep their boundary', () => {
    const r = alignToSpeech([cue('a', 10300, 12000), cue('b', 12080, 14300)], [[10000, 14000]], O);
    expect(r.cues[0]).toMatchObject({ start: 10000, end: 12000 });
    expect(r.cues[1]).toMatchObject({ start: 12080, end: 14000 });
  });

  it('keeps the gap with a neighbour', () => {
    // b's speech starts right as a ends: b starts a gap later.
    const r = alignToSpeech([cue('a', 10000, 11000, ''), cue('b', 11500, 13000)], [[11000, 13000]], O);
    expect(r.cues[1]).toMatchObject({ start: 11080, end: 13000 });
    // a's speech ends too close to b: a ends a gap before b.
    const r2 = alignToSpeech([cue('a', 10000, 11000), cue('b', 11500, 13000, '')], [[10000, 11450]], O);
    expect(r2.cues[0].end).toBe(11420);
  });

  it('only the selection, only starts or only ends', () => {
    const cues = [cue('a', 10400, 12500), cue('b', 20400, 22500)];
    const spans: [number, number][] = [
      [10000, 12000],
      [20000, 22000],
    ];
    expect(alignToSpeech(cues, spans, O, ['b']).moved).toEqual(['b']);
    expect(alignToSpeech(cues, spans, { ...O, ends: false }).cues[0]).toMatchObject({ start: 10000, end: 12500 });
    expect(alignToSpeech(cues, spans, { ...O, starts: false }).cues[0]).toMatchObject({ start: 10400, end: 12000 });
  });

  it('never goes under the floor duration', () => {
    const r = alignToSpeech([cue('a', 10000, 11000)], [[10900, 11100]], O);
    expect(r.cues[0].end - r.cues[0].start).toBeGreaterThanOrEqual(300);
  });
});

describe('Sync from a reference file', async () => {
  const { syncToReference, fitWhole, refSpans } = await import('./syncRef');
  const cue = (id: string, start: number, end: number, text = 'Hi'): Cue => ({ id, start, end, text });
  // A reference: 200 lines over ~33 min, irregular.
  const ref: Cue[] = [];
  let t0 = 5000;
  for (let i = 0; i < 200; i++) {
    const len = 1200 + ((i * 7919) % 2300);
    ref.push(cue(`r${i}`, t0, t0 + len));
    t0 += len + 300 + ((i * 104729) % 4000);
  }
  const O = { maxMs: 1000, starts: true, ends: true, gapMs: 80, floorMs: 300, whole: true, each: true };

  it('finds an offset alone', () => {
    const fr = ref.map((c, i) => cue(`f${i}`, c.start + 3400, c.end + 3400));
    const f = fitWhole(fr, refSpans(ref))!;
    expect(f.scale).toBe(1);
    expect(f.offset).toBe(-3400);
  });

  it('finds a frame rate conversion and the offset, then each subtitle lands on the reference', () => {
    // Made for 25 fps, the film at 23.976 → the file runs 4 % too fast, plus 2 s late.
    const k = 25 / (24000 / 1001);
    const fr = ref.map((c, i) => cue(`f${i}`, Math.round((c.start - 2000) / k + 37 * ((i % 5) - 2)), Math.round((c.end - 2000) / k)));
    const r = syncToReference(fr, ref, O);
    expect(r.fit?.fps.id).toBe('25>23.976');
    const off = r.cues.filter((c, i) => Math.abs(c.start - ref[i].start) > 20 || Math.abs(c.end - ref[i].end) > 20);
    expect(off.length).toBeLessThan(5);
  });

  it('leaves a title card the reference does not have, and handles a line split in two', () => {
    const r = syncToReference(
      [cue('title', 1000, 3000, 'TITLE'), cue('a', 5300, 6000), cue('b', 6080, 6500), ...ref.slice(1).map((c, i) => cue(`f${i}`, c.start + 300, c.end + 300))],
      ref,
      O,
    );
    const by = new Map(r.cues.map((c) => [c.id, c]));
    expect(by.get('a')!.start).toBe(ref[0].start);
    expect(by.get('b')!.end).toBe(ref[0].end);
    expect(by.get('title')!.end - by.get('title')!.start).toBe(2000);
  });

  it('no clear match: nothing from step 1', () => {
    expect(fitWhole([cue('a', 0, 1000)], [])).toBeNull();
  });
});

describe('sortInSections (Tools menu)', async () => {
  const { sortInSections } = await import('./menu');
  it('sorts within each section, the section name on the new first item', () => {
    const r = sortInSections(
      [
        { section: 'Timing', label: 'Shift times' },
        { label: 'Convert frame rate' },
        { section: 'Text', label: 'Remove HI tags' },
        { label: 'Écrire' },
        { label: 'Fix punctuation' },
      ],
      'fr',
    );
    expect(r.map((i) => i.label)).toEqual(['Convert frame rate', 'Shift times', 'Écrire', 'Fix punctuation', 'Remove HI tags']);
    expect(r.map((i) => i.section)).toEqual(['Timing', undefined, 'Text', undefined, undefined]);
  });
});

describe('zip (subtitles from a .zip)', async () => {
  const { zipEntries, unzipEntry, isZipBytes, isJunkEntry, entryBaseName } = await import('./zip');
  // A minimal zip writer for the test: stored or deflated entries.
  async function makeZip(files: { name: string; text: string; deflate?: boolean }[]): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const f of files) {
      const raw = enc.encode(f.text);
      const data = f.deflate
        ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
        : raw;
      const name = enc.encode(f.name);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(6, 0x800, true);
      lv.setUint16(8, f.deflate ? 8 : 0, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, raw.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);
      const c = new Uint8Array(46 + name.length);
      const cv = new DataView(c.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(8, 0x800, true);
      cv.setUint16(10, f.deflate ? 8 : 0, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, raw.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      c.set(name, 46);
      central.push(c);
      parts.push(local, data);
      offset += local.length + data.length;
    }
    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    const all = [...parts, ...central, end];
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of all) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  it('lists the files and reads stored and deflated ones', async () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nBonjour à tous\n';
    const z = await makeZip([
      { name: 'Film/Film.fr.srt', text: srt, deflate: true },
      { name: 'Film/', text: '' },
      { name: 'read me.txt', text: 'hi' },
    ]);
    expect(isZipBytes(z)).toBe(true);
    const e = zipEntries(z);
    expect(e.map((x) => x.name)).toEqual(['Film/Film.fr.srt', 'read me.txt']);
    expect(new TextDecoder().decode(await unzipEntry(z, e[0]))).toBe(srt);
    expect(new TextDecoder().decode(await unzipEntry(z, e[1]))).toBe('hi');
  });

  it('leaves out macOS junk, keeps the base name', () => {
    expect(isJunkEntry('__MACOSX/Film/._Film.srt')).toBe(true);
    expect(isJunkEntry('Film/.DS_Store')).toBe(true);
    expect(isJunkEntry('Film/Film.srt')).toBe(false);
    expect(entryBaseName('a/b/Film.en.srt')).toBe('Film.en.srt');
  });

  it('refuses what is not a zip', () => {
    expect(() => zipEntries(new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\nHi'))).toThrow();
  });
});

describe('split: the text cut where the playhead is', async () => {
  const { splitCue, splitPoint } = await import('./tools');
  const S = { minGapMs: 80, floorDurationMs: 300 };
  const parts = (text: string, ratio: number) => {
    const i = splitPoint(text, ratio);
    return [text.slice(0, i).trimEnd(), text.slice(i).trimStart()];
  };

  it('follows the playhead, not the middle', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve';
    expect(parts(text, 0.3)[0]).toBe('one two three four');
    expect(parts(text, 0.7)[1]).toBe('ten eleven twelve');
  });

  it('prefers the end of a sentence, then a comma, near that point', () => {
    expect(parts('Where were you yesterday? I was out with friends.', 0.6)).toEqual(['Where were you yesterday?', 'I was out with friends.']);
    expect(parts('Well, if you ask me nicely, I might come along tonight', 0.55)).toEqual(['Well, if you ask me nicely,', 'I might come along tonight']);
    // Too far from the playhead: the nearest space instead.
    expect(parts('Yes. And then we walked all the way home in the pouring rain', 0.8)[1]).toBe('pouring rain');
  });

  it('never cuts before French spaced punctuation', () => {
    expect(parts('Bonjour ! Ça va ?', 0.4)).toEqual(['Bonjour !', 'Ça va ?']);
  });

  it('keeps a word on each side, near an edge too', () => {
    expect(parts('Hello there my friend', 0)).toEqual(['Hello', 'there my friend']);
    expect(parts('Hello there my friend', 1)).toEqual(['Hello there my', 'friend']);
    expect(splitPoint('Hello', 0.5)).toBe(-1);
  });

  it('several lines: the line break nearest the playhead', () => {
    const r = splitCue([{ id: 'a', start: 0, end: 3000, text: 'Line one\nLine two\nLine three' }], 'a', 800, S)!;
    expect(r.cues.map((c) => c.text)).toEqual(['Line one', 'Line two\nLine three']);
  });

  it('tags kept around both parts', () => {
    const r = splitCue([{ id: 'a', start: 0, end: 4000, text: '<i>Where were you? I was out.</i>' }], 'a', 2000, S)!;
    expect(r.cues.map((c) => c.text)).toEqual(['<i>Where were you?</i>', '<i>I was out.</i>']);
  });
});

describe('estimateCondense (Shorten with AI)', async () => {
  const { estimateCondense } = await import('./condense');
  it('grows with the subtitles and the batches', () => {
    const items = [{ n: 1, text: 'A rather long line that is far too fast to read', maxChars: 20 }];
    const one = estimateCondense(items, 'x'.repeat(400), 1);
    expect(one.input).toBeGreaterThan(100);
    expect(one.output).toBeGreaterThan(5);
    expect(estimateCondense([...items, ...items], 'x'.repeat(400), 2).input).toBeGreaterThan(one.input * 1.5);
  });
});

describe('ASS styles and what is lost', async () => {
  const { parseSubtitles } = await import('./formats');
  const { assLosses } = await import('./formatsMore');
  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1',
    'Style: Thoughts,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,-1,0,0,100,100,0,0,1,2,0,2,10,10,10,1',
    'Style: Signs,Arial,40,&H0000FFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Thoughts,,0,0,0,,Je me demande',
    'Dialogue: 0,0:00:03.00,0:00:04.00,Thoughts,,0,0,0,,Pas {\\i0}moi{\\r} toi',
    'Dialogue: 0,0:00:05.00,0:00:06.00,signs,,0,0,0,,{\\pos(100,200)\\c&H00FF00&}Boulangerie',
    'Dialogue: 0,0:00:07.00,0:00:08.00,Signs,,0,0,0,,{\\an2}En bas quand même',
    'Dialogue: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,{\\k20}La{\\k30}la{\\fad(200,200)}',
    'Comment: 0,0:00:11.00,0:00:12.00,Default,,0,0,0,,note',
    '',
    '[Fonts]',
    'fontname: x.ttf',
  ].join('\n');

  it('takes italic and top from the line’s style', () => {
    expect(parseSubtitles('a.ass', ass).cues.map((c) => c.text)).toEqual([
      '<i>Je me demande</i>',
      '<i>Pas </i>moi<i> toi</i>',
      '{\\an8}<b><font color="#00FF00">Boulangerie</font></b>',
      '<font color="#FFFF00"><b>En bas quand même</b></font>',
      'Lala',
    ]);
  });

  it('counts what Subtle does not keep', () => {
    expect(assLosses(ass)).toEqual({ styles: 2, colours: 0, karaoke: 1, positions: 1, effects: 1, drawings: 0, comments: 1, attachments: true });
  });
});

describe('colours', async () => {
  const { normColour, nearestVttClass, assColourToHex, hexToAss, fontToVtt, vttToFont } = await import('./colour');
  const { parseSubtitles, serialize } = await import('./formats');

  it('reads and converts colours', () => {
    expect(normColour('#ff0')).toBe('#FFFF00');
    expect(normColour('yellow')).toBe('#FFFF00');
    expect(normColour('nope')).toBeNull();
    expect(assColourToHex('&H00FFFF&')).toBe('#FFFF00');
    expect(assColourToHex('&H0000FF00')).toBe('#00FF00');
    expect(assColourToHex('65535')).toBe('#FFFF00'); // SSA's decimal BGR
    expect(hexToAss('#FF8000')).toBe('&H0080FF&');
    expect(nearestVttClass('#F0E000')).toBe('yellow');
    expect(nearestVttClass('#10D0E0')).toBe('cyan');
  });

  it('VTT colour classes ↔ <font color>, other <c> kept', () => {
    expect(vttToFont('<c.yellow.bg_black>Hi</c> <c.loud>there</c>')).toBe('<font color="#FFFF00">Hi</font> <c.loud>there</c>');
    expect(fontToVtt('<font color="#F0E000">Hi</font>')).toBe('<c.yellow>Hi</c>');
  });

  it('ASS colours: tags and styles in, \\c out, nested properly', () => {
    const ass = [
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic, Alignment',
      'Style: Default,Arial,48,&H00FFFFFF,0,0,2',
      'Style: Cyan,Arial,48,&H00FFFF00,0,-1,2',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\c&H0000FF&}Red{\\c} white',
      'Dialogue: 0,0:00:03.00,0:00:04.00,Cyan,,0,0,0,,Cyan {\\i0}upright',
    ].join('\n');
    const doc = parseSubtitles('a.ass', ass);
    expect(doc.cues.map((c) => c.text)).toEqual(['<font color="#FF0000">Red</font> white', '<font color="#00FFFF"><i>Cyan </i>upright</font>']);
    const out = serialize(doc, 'ass');
    expect(out).toContain('{\\c&H0000FF&}Red{\\c} white');
    expect(parseSubtitles('b.ass', out).cues.map((c) => c.text)).toEqual(doc.cues.map((c) => c.text));
  });

  it('an SRT colour goes to VTT, TTML and ASS, and comes back; SBV drops it', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\n<font color="#FFFF00">Yellow</font> plain\n';
    const doc = parseSubtitles('a.srt', srt);
    const vtt = serialize(doc, 'vtt');
    expect(vtt).toContain('<c.yellow>Yellow</c> plain');
    expect(parseSubtitles('a.vtt', vtt).cues[0].text).toBe('<font color="#FFFF00">Yellow</font> plain');
    const ttml = serialize(doc, 'ttml');
    expect(ttml).toContain('<span tts:color="#FFFF00">Yellow</span> plain');
    expect(parseSubtitles('a.ttml', ttml).cues[0].text).toBe('<font color="#FFFF00">Yellow</font> plain');
    expect(parseSubtitles('a.ass', serialize(doc, 'ass')).cues[0].text).toBe('<font color="#FFFF00">Yellow</font> plain');
    expect(serialize(doc, 'sbv')).toContain('Yellow plain');
  });
});

describe('a whole-subtitle colour, hidden in the editor', async () => {
  const { editableText, withEditedText, isItalic, setItalic, colourOf, setColour } = await import('./markup');
  it('hides it, keeps it when the text is edited, and sets it', () => {
    const t = '{\\an8}<font color="#FFFF00"><i>Hello there</i></font>';
    expect(editableText(t)).toBe('Hello there');
    expect(colourOf(t)).toBe('#FFFF00');
    expect(isItalic(t)).toBe(true);
    expect(withEditedText(t, 'Hi')).toBe('{\\an8}<font color="#FFFF00"><i>Hi</i></font>');
    expect(setItalic(t, false)).toBe('{\\an8}<font color="#FFFF00">Hello there</font>');
    expect(setColour('One <font color="red">word</font>', '#00ffff')).toBe('<font color="#00FFFF">One word</font>');
    expect(setColour(t, null)).toBe('{\\an8}<i>Hello there</i>');
    // A colour on part of the text stays visible.
    expect(editableText('<font color="#FF0000">Red</font> and white')).toBe('<font color="#FF0000">Red</font> and white');
  });
});

describe('usedColours', async () => {
  const { usedColours } = await import('./colour');
  it('lists the colours a file uses, most used first, without the palette', () => {
    const texts = [
      '<font color="#FF8000">a</font>',
      'b <font color="#ff8000">c</font>',
      '<font color="#123456">d</font>',
      '<font color="#FFFF00">e</font>',
      'plain',
    ];
    expect(usedColours(texts, ['#FFFF00'])).toEqual(['#FF8000', '#123456']);
    expect(usedColours(texts, [], 1)).toEqual(['#FF8000']);
  });
});

describe('replaceColour (change a colour everywhere)', async () => {
  const { replaceColour } = await import('./colour');
  it('changes that colour only, in any spelling', () => {
    expect(replaceColour('<font color="#ff8000">a</font> <font color=#FF8000>b</font> <font color="#FFFF00">c</font>', '#FF8000', '#00aaff')).toBe(
      '<font color="#00AAFF">a</font> <font color="#00AAFF">b</font> <font color="#FFFF00">c</font>',
    );
    expect(replaceColour('plain', '#FF8000', '#000000')).toBe('plain');
  });
});

describe('remove colours (Tools and the Netflix / Prime Video check)', async () => {
  const { hasColour, removeColours, withoutColours } = await import('./colour');
  it('white is no colour; other tags stay', () => {
    expect(hasColour('<font color="#fff">a</font>')).toBe(false);
    expect(hasColour('a <font color=yellow>b</font>')).toBe(true);
    expect(removeColours('{\\an8}<i><font color="#FFFF00">a</font> b</i>')).toBe('{\\an8}<i>a b</i>');
  });
  it('both languages, untouched subtitles kept as they were', () => {
    const plain = { id: 'a', start: 0, end: 1000, text: 'a' };
    const out = withoutColours([plain, { id: 'b', start: 0, end: 1000, text: 'b', target: '<font color="#FF0000">c</font>' }]);
    expect(out[0]).toBe(plain);
    expect(out[1].target).toBe('c');
  });
  it('a problem for Netflix, fixed by Fix all; not for TED', () => {
    const cues = [cue(0, 2000, '<font color="#FF0000">Hello</font>')];
    const netflix = profileFor(CONVENTIONS.netflix, false, 24, DEFAULT_SETTINGS);
    const ted = profileFor(CONVENTIONS.ted, false, 24, DEFAULT_SETTINGS);
    expect(audit(cues, netflix, null).ids.colour).toEqual(['0']);
    expect(audit(cues, ted, null).ids.colour).toBeUndefined();
    expect(fixAll(cues, netflix)[0].text).toBe('Hello');
    expect(fixAll(cues, ted)[0].text).toContain('font');
  });
});

describe('a whole-subtitle bold, hidden in the editor', async () => {
  const { editableText, withEditedText, isBold, setBold, setItalic, setColour } = await import('./markup');
  it('hides it, keeps it with the other decorations, and sets it', () => {
    const t = '{\\an8}<font color="#FFFF00"><b><i>Loud</i></b></font>';
    expect(editableText(t)).toBe('Loud');
    expect(isBold(t)).toBe(true);
    expect(withEditedText(t, 'Louder')).toBe('{\\an8}<font color="#FFFF00"><b><i>Louder</i></b></font>');
    expect(setBold(t, false)).toBe('{\\an8}<font color="#FFFF00"><i>Loud</i></font>');
    expect(setBold('One <b>word</b>', true)).toBe('<b>One word</b>');
    expect(setColour(setItalic(setBold('Hi', true), true), '#00FFFF')).toBe('<font color="#00FFFF"><b><i>Hi</i></b></font>');
  });
});

describe('bold in every format', async () => {
  const { parseSubtitles, serialize } = await import('./formats');
  it('ASS \\b and styles in, \\b out; TTML fontWeight; SRT / VTT <b> as is; SBV drops it', () => {
    const ass = [
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic, Alignment',
      'Style: Default,Arial,48,&H00FFFFFF,0,0,2',
      'Style: Title,Arial,48,&H00FFFFFF,-1,0,2',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\b1}Loud{\\b0} quiet {\\b700}heavy',
      'Dialogue: 0,0:00:03.00,0:00:04.00,Title,,0,0,0,,Chapter one',
    ].join('\n');
    const doc = parseSubtitles('a.ass', ass);
    expect(doc.cues.map((c) => c.text)).toEqual(['<b>Loud</b> quiet <b>heavy</b>', '<b>Chapter one</b>']);
    expect(serialize(doc, 'ass')).toContain('{\\b1}Loud{\\b0} quiet {\\b1}heavy{\\b0}');
    const ttml = serialize(doc, 'ttml');
    expect(ttml).toContain('<span tts:fontWeight="bold">Loud</span> quiet');
    expect(parseSubtitles('a.ttml', ttml).cues[0].text).toBe('<b>Loud</b> quiet <b>heavy</b>');
    expect(serialize(doc, 'vtt')).toContain('<b>Loud</b> quiet');
    expect(serialize(doc, 'sbv')).toContain('Loud quiet heavy');
  });
});

describe('speechSlot (pick a line of dialogue)', async () => {
  const { speechSlot } = await import('./tools');
  const S = { minGapMs: 80, floorDurationMs: 300 };
  const spans: [number, number][] = [
    [1000, 3000],
    [5000, 9000],
  ];
  it('gives the speech span as times, a gap away from neighbours', () => {
    expect(speechSlot([], spans, 2000, S)).toEqual({ start: 1000, end: 3000 });
    const cues = [{ id: 'a', start: 4000, end: 5500, text: 'x' }];
    expect(speechSlot(cues, spans, 7000, S)).toEqual({ start: 5580, end: 9000 });
  });
  it('nothing off speech, on a subtitle, or without room', () => {
    expect(speechSlot([], spans, 4000, S)).toBeNull();
    expect(speechSlot([{ id: 'a', start: 1500, end: 2500, text: 'x' }], spans, 2000, S)).toBeNull();
    expect(speechSlot([{ id: 'a', start: 0, end: 2800, text: 'x' }], spans, 2900, S)).toBeNull();
  });
});

describe('zip bombs', async () => {
  const { unzipEntry } = await import('./zip');
  it('refuses an entry that unpacks past the limit, whatever it claims', async () => {
    const raw = new Uint8Array(200_000); // zeros: tiny once deflated
    const data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const local = new Uint8Array(30);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    const zip = new Uint8Array([...local, ...data]);
    const entry = { name: 'a.srt', method: 8, headerAt: 0, compressedSize: data.length, size: 10 };
    await expect(unzipEntry(zip, entry, 100_000)).rejects.toThrow('too big');
    expect((await unzipEntry(zip, entry, 300_000)).length).toBe(200_000);
  });
});

describe('sign', () => {
  const o = { minGapMs: 100, minDurationMs: 2000, cpsBased: false, maxCps: 17, format: 'srt' as const, translating: false };
  const cue = (id: string, start: number, end: number, text = 'x'): Cue => ({ id, start, end, text });

  it('places at the start of the film and after the last subtitle', () => {
    const r = sign(
      [cue('a', 10000, 12000)],
      [
        { text: 'Subtitles by me', top: false, from: 'start', afterMs: 2000 },
        { text: 'Translation by me', top: true, from: 'end', afterMs: 2000 },
      ],
      o,
    );
    expect(r.cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [2000, 4000, 'Subtitles by me'],
      [10000, 12000, 'x'],
      [14000, 16000, '{\\an8}Translation by me'],
    ]);
    expect(r.added).toHaveLength(2);
    expect(r.moved).toEqual([]);
  });

  it('moves to the next free spot, around other signatures too', () => {
    const r = sign(
      [cue('a', 2500, 5000)],
      [
        { text: 'One', top: false, from: 'start', afterMs: 1000 },
        { text: 'Two', top: false, from: 'start', afterMs: 1500 },
      ],
      o,
    );
    expect(r.cues.map((c) => [c.start, c.text])).toEqual([
      [2500, 'x'],
      [5100, 'One'],
      [7200, 'Two'],
    ]);
    expect(r.moved).toHaveLength(2);
  });

  it('replaces lines already signed, ignores empty ones, fills the translation', () => {
    const first = sign(
      [cue('a', 5000, 6000)],
      [
        { text: '<i>Team X</i>', top: false, from: 'start', afterMs: 0 },
        { text: ' ', top: false, from: 'end', afterMs: 0 },
      ],
      { ...o, translating: true },
    );
    expect(first.cues).toHaveLength(2);
    expect(first.cues[0].target).toBe('<i>Team X</i>');
    const again = sign(first.cues, [{ text: 'team  x', top: false, from: 'start', afterMs: 1000 }], o);
    expect(again.cues.map((c) => [c.start, c.text])).toEqual([
      [1000, 'team  x'],
      [5000, 'x'],
    ]);
  });

  it('lasts longer for a long text when the duration follows the reading speed', () => {
    expect(signatureDuration('a'.repeat(68), { minDurationMs: 1000, cpsBased: true, maxCps: 17 })).toBe(4000);
    expect(freeSpot([cue('a', 0, 1000)], 0, 500, 100)).toBe(1100);
  });
});

describe('creditsStart', () => {
  // A 100 s film, a keyframe every 5 s: `dark` lists the dark ones (by time in s).
  const film = (dark: number[]) => {
    const times = Array.from({ length: 21 }, (_, i) => i * 5000);
    return { times, colours: times.map((t) => (dark.includes(t / 1000) ? ([10, 10, 10] as const) : ([120, 110, 100] as const))) };
  };
  const o = { ...CREDITS_OPTIONS, minRunMs: 15000 };

  it('finds the first long dark stretch near the end, a title card inside allowed', () => {
    const { times, colours } = film([80, 85, 95, 100]);
    expect(creditsStart(times, colours, 100000, o)).toBe(80000);
  });

  it('ignores dark scenes too short or too early, and films without credits', () => {
    for (const dark of [[10, 15, 20, 25, 30], [80, 85], []]) {
      const f = film(dark);
      expect(creditsStart(f.times, f.colours, 100000, o)).toBeNull();
    }
    expect(luma([255, 255, 255])).toBeCloseTo(255);
  });
});

describe('sign at the credits', () => {
  it('places after the credits start, else after the last subtitle', () => {
    const base = { minGapMs: 100, minDurationMs: 2000, cpsBased: false, maxCps: 17, format: 'srt' as const, translating: false };
    const cues: Cue[] = [{ id: 'a', start: 1000, end: 2000, text: 'x' }];
    const sig = [{ text: 'By me', top: false, from: 'credits' as const, afterMs: 2000 }];
    expect(sign(cues, sig, { ...base, creditsMs: 60000 }).cues[1].start).toBe(62000);
    expect(sign(cues, sig, { ...base, creditsMs: null }).cues[1].start).toBe(4000);
    // Past the end of the film: as late as fits inside it.
    const end = [{ text: 'By me', top: false, from: 'end' as const, afterMs: 2000 }];
    expect(sign(cues, end, { ...base, filmEndMs: 5000 }).cues[1].start).toBe(3000);
    expect(sign(cues, end, { ...base, filmEndMs: 3000 }).cues[1].start).toBe(4000);
  });
});

describe('matchTranslation', () => {
  const c = (id: string, start: number, end: number, text: string): Cue => ({ id, start, end, text });
  it('lines each translation up on the original it overlaps most, joins, counts the lost ones', () => {
    const source = [c('a', 1000, 3000, 'Hello'), c('b', 3100, 5000, 'Bye'), c('c', 6000, 7000, 'Later')];
    const other = [
      c('x', 1100, 2900, '{\\an8}Bonjour'),
      c('y', 2900, 4000, 'Au revoir'),
      c('z', 4000, 5100, 'à plus'),
      c('w', 9000, 9500, 'Perdu'),
      c('v', 6000, 7000, ' '),
    ];
    const r = matchTranslation(source, other);
    expect(Object.fromEntries(r.targets)).toEqual({ a: 'Bonjour', b: 'Au revoir\nà plus' });
    expect(r.matched).toBe(2);
    expect(r.unmatched).toBe(1);
  });
});
