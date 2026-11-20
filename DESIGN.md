# Subtle — design notes

A dark, dense editing tool in the spirit of DaVinci Resolve / CapCut. Function first: nothing decorative.

## Principles

- **One accent**: subtitle yellow `#F5C542`. It marks what is _current_: selection, playhead, active subtitle, primary button. Nothing else is yellow.
- **Layered greys, never pure black** (except the video frame): app `#1B1D21` → panels `#23262B` → raised controls `#2C3036`.
- **Status colours only for problems**: orange `#F0A574` for QC warnings, blue `#8FB8F0` for hearing-impaired text. Messages stay neutral (panel background); their tone shows only in the icon and a thin left edge.
- **Dense**: 12–14 px text, 26–30 px controls, compact rows. Lots of information on screen.
- **Stable numbers**: every timecode uses `font-variant-numeric: tabular-nums` so it doesn't jitter while playing.
- **Motion only in response to an action** (scroll to the current subtitle, drag). No entrance animations.
- **Sentence case**, plain verbs, buttons say what they do ("Clean 4 subtitles", "Export SRT").

## Tokens

All values live as CSS variables in `src/styles/tokens.css`. Change them there, not in components. Colours over the video picture (`--on-picture`, `--picture-ring`…), hover and tick greys, and shadows (`--shadow-menu`, `--shadow-dialog`, `--shadow-panel`) have their own tokens too.

| Token                                    | Value                             | Use                                                                                               |
| ---------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `--bg-app`                               | `#1B1D21`                         | App background, inputs, timeline track                                                            |
| `--bg-panel`                             | `#23262B`                         | Top bar, list, dialogs                                                                            |
| `--bg-raised`                            | `#2C3036`                         | Small buttons, chips                                                                              |
| `--border`                               | `#353A41`                         | Panel borders                                                                                     |
| `--text` / `--text-muted` / `--text-dim` | `#E6E8EB` / `#B8BFC7` / `#9FA7B0` | Text levels. Dim is ≥ 5.5:1 even on raised panels (was 3.6:1 before 2026-11-08: too faint)        |
| `--accent`                               | `#F5C542`                         | Selection, playhead, primary action                                                               |
| `--warn`                                 | `#F0A574`                         | QC issues                                                                                         |
| `--danger`                               | `#F07B74`                         | Heavy storage (≥ 100 MB) in Settings › Storage                                                    |
| `--success`                              | `#8FB79A`                         | Desaturated green, only as a small accent (icon, thin edge) in success messages — never as a fill |
| `--hi`                                   | `#8FB8F0`                         | Hearing-impaired text                                                                             |
| `--cue-*`                                |                                   | Timeline blocks (normal / HI / selected)                                                          |
| `--fs-xs … --fs-l`                       | 12–15 px                          | Type scale (raised by 1 px on 2026-11-08 for readability)                                         |
| `--radius-s/m/l`                         | 4 / 5 / 8 px                      | Controls / buttons / panels & dialogs                                                             |

Typeface: **IBM Plex Sans** (400, 500, 600), system UI as fallback.

## Layout

```
┌──────────────────────────────┬───────────────┐
│ Player (2/3)                 │ List (1/3)    │
│ ⏮ « ▶ » ⏭  timecode          │               │
├──────────────────────────────┴───────────────┤
│ Timeline — one track, full width             │
└──────────────────────────────────────────────┘
```
