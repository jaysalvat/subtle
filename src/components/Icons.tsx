/**
 * App icons. Iconoir (https://iconoir.com, MIT) behind our own names, so components don't
 * depend on the library directly. Default 16 px, stroke follows the text colour.
 */
import type { ComponentType, SVGProps } from 'react';
import {
  TextSize,
  TextMagnifyingGlass,
  KeyframeAlignCenter,
  Magnet,
  FastArrowLeft,
  FastArrowRight,
  HorizontalMerge,
  KeyCommand,
  MediaImageList,
  MediaVideo,
  Minus as IMinus,
  NavArrowDown,
  NavArrowUp,
  ChatLines,
  DataTransferBoth,
  EditPencil,
  Page,
  Pause as IPause,
  Play as IPlay,
  Plus as IPlus,
  Backward15Seconds,
  Bookmark as IBookmark,
  Forward15Seconds,
  Redo as IRedo,
  Repeat,
  Scissor,
  Search as ISearch,
  Settings,
  SkipNext,
  SkipPrev,
  Tools as ITools,
  Trash as ITrash,
  Undo as IUndo,
  Voice,
  Xmark,
  ZoomIn,
  ZoomOut,
  AlignTopBox,
  Italic,
  Bold,
  MoreHoriz,
  Movie,
  ViewGrid,
  Import as IImport,
} from 'iconoir-react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const icon = (C: ComponentType<SVGProps<SVGSVGElement>>, defaults: Partial<P> = {}) =>
  function Icon({ size = defaults.size ?? 16, ...rest }: P) {
    return <C width={size} height={size} strokeWidth={1.8} aria-hidden="true" {...defaults} {...rest} />;
  };

/** Subtle's mark (drawn with Claude Design): two subtitle lines and a spark on yellow. Same as public/icon.svg; its colours are the brand's, fixed on purpose (not the theme tokens). */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="#f2c14e" />
      <rect x="13" y="22" width="22" height="8" rx="4" fill="#1b1c1f" />
      <rect x="13" y="38" width="38" height="8" rx="4" fill="#1b1c1f" />
      <path d="M46 17Q47 25 55 26Q47 27 46 35Q45 27 37 26Q45 25 46 17Z" fill="#1b1c1f" />
    </svg>
  );
}
export const Undo = icon(IUndo);
export const Redo = icon(IRedo);
export const Film = icon(MediaImageList);
export const Waveform = icon(Voice);
export const Keyboard = icon(KeyCommand);
export const Gear = icon(Settings);
export const Tools = icon(ITools);
export const ChevronDown = icon(NavArrowDown, { size: 14 });
export const ChevronUp = icon(NavArrowUp, { size: 14 });
export const First = icon(SkipPrev);
export const Last = icon(SkipNext);
export const Prev = icon(FastArrowLeft);
export const Next = icon(FastArrowRight);
export const Loop = icon(Repeat);
export const BookmarkIcon = icon(IBookmark);
export const NoteIcon = icon(ChatLines);
export const MoreIcon = icon(MoreHoriz);
export const ProjectsIcon = icon(ViewGrid);
export const ImportIcon = icon(IImport);
export const PencilIcon = icon(EditPencil);
/** Two parallel arrows, left and right (the up / down one turned). */
export const SwapIcon = icon(DataTransferBoth, { style: { transform: 'rotate(90deg)' } });
export const Back15 = icon(Backward15Seconds, { size: 18 });
export const Forward15 = icon(Forward15Seconds, { size: 18 });
export const ZoomInIcon = icon(ZoomIn);
export const TopIcon = icon(AlignTopBox);
export const ItalicIcon = icon(Italic);
export const BoldIcon = icon(Bold);
export const ZoomOutIcon = icon(ZoomOut);
export const Play = icon(IPlay, { size: 18 });
export const Pause = icon(IPause, { size: 18 });
export const Search = icon(ISearch, { size: 14 });
export const Split = icon(Scissor);
export const Merge = icon(HorizontalMerge);
export const Trash = icon(ITrash);
export const Plus = icon(IPlus);
export const Minus = icon(IMinus);
export const VideoIcon = icon(MediaVideo, { size: 28 });
export const MovieIcon = icon(Movie, { size: 28 });
export const FileIcon = icon(Page, { size: 28 });
export const CloseX = icon(Xmark);
export const SnapIcon = icon(Magnet);
export const CaseIcon = icon(TextSize);
export const FindTextIcon = icon(TextMagnifyingGlass);
export const FollowIcon = icon(KeyframeAlignCenter);
