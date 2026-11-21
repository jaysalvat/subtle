/**
 * CHANGELOG.md helpers for the release scripts. The file keeps "## Unreleased" on top, then one
 * "## x.y.z" section per version, newest first.
 *
 * node scripts/changelog.mjs 2.1.0 → prints that version's notes (used by the Release workflow).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The text of a "## title" section, up to the next "## ", trimmed ('' when missing). */
export function section(changelog, title) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim();
}

export const unreleasedNotes = (changelog) => section(changelog, 'Unreleased');

/** "## Unreleased" becomes "## version", with a new empty "## Unreleased" above it. */
export const withRelease = (changelog, version) => changelog.replace(/^## Unreleased[ \t]*$/m, `## Unreleased\n\n## ${version}`);

/** 2.1.0 + minor → 2.2.0. */
export function nextVersion(version, bump) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  const notes = version && section(readFileSync('CHANGELOG.md', 'utf8'), version);
  if (!notes) {
    console.error(`No "## ${version}" section in CHANGELOG.md`);
    process.exit(1);
  }
  console.log(notes);
}
