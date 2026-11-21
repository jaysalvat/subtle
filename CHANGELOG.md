# Changelog

## Unreleased

- Settings › Credits shows the build's commit next to the version.

## 2.1.0

### New tools

- **Sign the subtitles**: your credit lines, after the start, after the last subtitle or over the end credits (found in the film when they roll on black). Several blocks, each with its own look, kept for the next files.
- **Remove colours**, and in Check quality, coloured text is now a problem for Netflix and Prime Video (white text only), fixed in one click.
- **Sync from a reference file**: well-timed subtitles of the same film give the offset, the frame rate, then each subtitle's edges.
- **Align on the dialogue**: each start and end moves to the speech it touches, within the distance you allow, previewed before you apply.
- **Check the translation with AI**: each translation next to its original and its scene note: meaning, left out, consistency.
- **Retranslate the selection with AI**, with an instruction of your own; the subtitles around it are sent as context.
- **Start a translation from a file**: a translation of the same film, lined up on the original by time.
- **Subtitles from a .zip**: one file opens directly, several are offered like an MKV's tracks.

### Better tools

- Shift times, Lengthen short subtitles, Sync from two times, Find and replace, Remove HI tags and Fix punctuation are side panels with a live preview: the film, the list and the selection stay usable.
- Sync by ear laid out the way it's used: the dialogue scrolling past the playhead, a big Here button, the loop, the end checked on the 5th line from the end.
- Convert frame rate: choices as cards you can preview; a 29.97, 30 or 50 fps video offers the conversions to the film inside it.
- Shorten with AI starts like Review with AI: what will be sent and roughly how many tokens, before anything is sent.
- Split cuts the text as far in as the playhead is, after a sentence end or a comma.

### Editing

- **Pro mode** (Settings › General › App): subtitle colours and bold, kept in every format (SRT, VTT, ASS, TTML).
- ⌘A selects every subtitle; ⇧-drag across the timeline selects a run of subtitles, and scrolls near the edges.
- ⌥ is dialogue everywhere: ⌥↑ ↓ go to lines of dialogue, ⇧ to bookmarks, ⌥⇧ to scene notes. ⌥-click on the dialogue waveform makes an empty subtitle on that line (a trial).
- Our own tooltips, larger and quicker, with shortcuts shown as key caps.
- Two sounds, when a long job is done and with each message (Settings › General › App › Play sounds).

### Also

- Settings › Credits: the open source projects Subtle uses, and a link to its source code.
- Phones get a clean "open Subtle on a computer" page.
- Fixes: seeking never goes past the end of the film; speech to text really detects the language; AI prompts name languages in English.
