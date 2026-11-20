/**
 * The Projects page (instead of the editor, which stays loaded behind it): a card per project kept
 * in this browser with its picture, New, Import, and per project Open, Rename, Duplicate, Export,
 * picture, Delete.
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { filterProjects, safePicture, type ProjectCard } from '../lib/projects';
import { formatLength, formatTimecode } from '../lib/time';
import { middleEllipsis } from '../lib/filename';
import { choosePictureAt, frameAsPicture } from '../store/picture';
import { frameKey, getFrame, useFrames, wantFrames } from '../store/frames';
import {
  deleteProject,
  duplicateProject,
  exportProject,
  importProjectFile,
  newProject,
  openFromPage,
  renameProject,
  showProjects,
  useProjects,
} from '../store/projects';
import { formatBytes } from '../lib/bytes';
import { BitmapCanvas } from './BitmapCanvas';
import { useThumbs } from '../store/thumbs';
import { useApp } from '../store/store';
import { ask } from './Confirm';
import { EditableText } from './EditableText';
import { ImportIcon, Plus, VideoIcon, MoreIcon, CloseX } from './Icons';
import { Pill } from './Pill';
import { Menu } from './Menu';
import { Dialog } from './dialogs/Dialog';
import { SearchField } from './SearchField';

export function ProjectsPage() {
  const list = useProjects((s) => s.list);
  const currentId = useProjects((s) => s.currentId);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const shown = filterProjects(list, query);

  // Escape: back to the editor (menus and fields handle their own Escape first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || picking) return;
      e.preventDefault();
      showProjects(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);

  const startNew = async () => {
    await newProject();
    showProjects(false);
  };

  return (
    <section className="projects-page" aria-label={t.projects.page}>
      <div className="projects-head">
        <h1>{t.projects.page}</h1>
        <Pill>{list.length}</Pill>
        <span className="spacer" />
        <SearchField value={query} onChange={setQuery} label={t.projects.search} />
        <input
          ref={fileInput}
          type="file"
          accept=".subtle,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importProjectFile(f);
            e.target.value = '';
          }}
        />
        <button className="btn" title={t.projects.importHint} onClick={() => fileInput.current?.click()}>
          <ImportIcon /> {t.projects.import}
        </button>
        <button className="icon-btn" aria-label={t.projects.back} title={`${t.projects.back} (Esc)`} onClick={() => showProjects(false)}>
          <CloseX />
        </button>
      </div>
      <div className="projects-grid">
        {!query && (
          <button className="project-new" onClick={() => void startNew()}>
            <Plus />
            <strong>{t.projects.newTile}</strong>
            <span className="muted">{t.projects.newTileHint}</span>
          </button>
        )}
        {shown.map((p) => (
          <Card key={p.id} p={p} open={p.id === currentId} onPick={() => setPicking(true)} />
        ))}
      </div>
      {query && !shown.length && <p className="note">{t.projects.noMatch}</p>}
      {picking && <PicturePicker onClose={() => setPicking(false)} />}
    </section>
  );
}

function Card({ p, open, onPick }: { p: ProjectCard; open: boolean; onPick: () => void }) {
  const tp = t.projects;
  const [renaming, setRenaming] = useState(false);
  // The open project shows its picture as it is now (it may have just changed).
  const livePicture = useApp((s) => (open ? s.projectPicture : null));
  const hasFilm = useApp((s) => open && !!s.videoUrl);
  const picture = safePicture((open && livePicture) || p.picture);
  return (
    <article className={`project-card ${open ? 'open' : ''}`} onClick={() => void openFromPage(p.id)}>
      <div className="project-picture">
        {picture ? (
          <img src={picture} alt="" />
        ) : (
          <span className="project-nopic">
            <VideoIcon />
            {!p.video && <span>{tp.noVideo}</span>}
          </span>
        )}
        {p.durationMs ? <span className="project-duration tnum">{formatLength(p.durationMs)}</span> : null}
      </div>
      <div className="project-info">
        <div className="project-title">
          <EditableText
            value={p.title}
            display={middleEllipsis(p.title, 34)}
            label={tp.rename}
            onSave={(v) => void renameProject(p.id, v)}
            editing={renaming}
            onDone={() => setRenaming(false)}
          />
          <span className="spacer" />
          {/* The menu's clicks don't open the project. */}
          <span onClick={(e) => e.stopPropagation()}>
            <Menu
              label={tp.actions}
              icon={<MoreIcon />}
              iconOnly
              noChevron
              alignRight
              items={[
                { label: tp.openIt, onSelect: () => void openFromPage(p.id) },
                { label: tp.renameIt, onSelect: () => setRenaming(true) },
                { label: tp.duplicate, onSelect: () => void duplicateProject(p.id) },
                { label: tp.exportIt, hint: tp.exportHint, onSelect: () => void exportProject(p.id) },
                ...(open
                  ? [
                      {
                        divider: true,
                        label: tp.useFrame,
                        disabled: !hasFilm,
                        hint: hasFilm ? undefined : tp.pictureNeedsFilm,
                        onSelect: () => void frameAsPicture().then((ok) => ok && useApp.getState().notify(tp.pictureSet)),
                      },
                      { label: tp.choosePicture, disabled: !hasFilm, hint: hasFilm ? undefined : tp.pictureNeedsFilm, onSelect: onPick },
                    ]
                  : []),
                {
                  divider: true,
                  danger: true,
                  label: tp.delete,
                  onSelect: async () => {
                    if (await ask({ ...tp.deleteConfirm(p.title), danger: true })) await deleteProject(p.id);
                  },
                },
              ]}
            />
          </span>
        </div>
        <div className="project-langs">{tp.langs(p.lang, p.targetLang)}</div>
        <div className="project-meta note">
          <span className="tnum">
            {tp.cueCount(p.cues)}
            {p.bytes ? ` · ${formatBytes(p.bytes)}` : ''}
          </span>
          <span>{tp.date(new Date(p.updatedAt))}</span>
        </div>
      </div>
    </article>
  );
}

/**
 * The film's strip (its keyframes): a click makes that moment the open project's picture. −1 s / +1 s
 * shift every picture (a title between two keyframes); the shifted frames come from the exact-frames
 * worker for the tiles in view, the keyframe shown dimmed meanwhile.
 */
function PicturePicker({ onClose }: { onClose: () => void }) {
  const tp = t.projects;
  const count = useThumbs((s) => s.count);
  const durationMs = useApp((s) => s.video?.durationMs ?? 0);
  useFrames((s) => s.version);
  const { times, bitmaps } = useThumbs.getState();
  const [offset, setOffset] = useState(0);
  const at = (ms: number) => Math.max(0, Math.min(durationMs || Infinity, ms + offset));
  // Tiles in view (their index), asked from the worker together.
  const strip = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState<number[]>([]);
  useEffect(() => {
    const root = strip.current;
    if (!root) return;
    const seen = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.i);
          if (e.isIntersecting) seen.add(i);
          else seen.delete(i);
        }
        setInView([...seen].sort((a, b) => a - b));
      },
      { root, rootMargin: '150px' },
    );
    root.querySelectorAll('.picture-pick').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [count]);
  useEffect(() => {
    if (offset) wantFrames(inView.map((i) => ({ key: frameKey(at(times[i])), t: at(times[i]) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, inView]);
  const pick = (ms: number) => {
    onClose();
    void choosePictureAt(ms).then((ok) => ok && useApp.getState().notify(tp.pictureSet));
  };
  return (
    <Dialog
      title={tp.pictureTitle}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={() => setOffset((o) => o - 1000)} title={tp.shiftEarlier}>
            {tp.minusOne}
          </button>
          <button className="link-btn tnum picture-offset" onClick={() => setOffset(0)} disabled={!offset} title={tp.shiftReset}>
            {tp.shifted(offset / 1000)}
          </button>
          <button className="btn" onClick={() => setOffset((o) => o + 1000)} title={tp.shiftLater}>
            {tp.plusOne}
          </button>
        </>
      }
    >
      <div className="picture-strip" ref={strip}>
        {times.slice(0, count).map((ms, i) => {
          const exact = offset ? getFrame(frameKey(at(ms))) : undefined;
          return (
            <button
              key={ms}
              data-i={i}
              className={`picture-pick ${offset && !exact ? 'reading' : ''}`}
              title={formatTimecode(at(ms))}
              onClick={() => pick(at(ms))}
            >
              <BitmapCanvas bitmap={exact ?? bitmaps[i]} />
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
