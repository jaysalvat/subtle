#!/usr/bin/env node
/**
 * Release a new version: npm run release -- patch | minor | major
 *
 * 1. Checks: on main, nothing uncommitted, up to date with GitHub, something under "## Unreleased"
 *    in CHANGELOG.md.
 * 2. Shows the new version and its notes, asks before going on.
 * 3. Bumps package.json and package-lock.json, turns "## Unreleased" into "## x.y.z" (a new empty
 *    "## Unreleased" above it), runs npm run check and npm run build (everything put back if they fail).
 * 4. Commits "chore: release vx.y.z" and tags vx.y.z.
 * 5. Asks before pushing main and that tag (never --tags). On GitHub, the tag starts the Release
 *    workflow (.github/workflows/release.yml), which publishes the notes; main deploys the app.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { nextVersion, unreleasedNotes, withRelease } from './changelog.mjs';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const fail = (message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
};

const bump = process.argv[2];
if (!['patch', 'minor', 'major'].includes(bump)) fail('Usage: npm run release -- patch | minor | major');

if (sh('git branch --show-current') !== 'main') fail('Releases are made from main.');
if (sh('git status --porcelain')) fail('Commit or stash your changes first.');
sh('git fetch -q origin main');
if (sh('git rev-list --count main..origin/main') !== '0') fail('GitHub has commits you don’t: git pull first.');

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const notes = unreleasedNotes(changelog);
if (!notes) fail('Write what changed under "## Unreleased" in CHANGELOG.md first.');

const current = JSON.parse(readFileSync('package.json', 'utf8')).version;
const version = nextVersion(current, bump);
const tag = `v${version}`;
if (sh(`git tag -l ${tag}`)) fail(`${tag} already exists.`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const yes = async (question) => /^y(es)?$/i.test((await rl.question(`${question} (y/N) `)).trim());

console.log(`\nSubtle ${current} → ${version}\n\n${notes}\n`);
if (!(await yes(`Release ${tag}?`))) process.exit(0);

try {
  run(`npm version ${version} --no-git-tag-version`);
  writeFileSync('CHANGELOG.md', withRelease(changelog, version));
  run('npx prettier --write CHANGELOG.md');
  run('npm run check');
  run('npm run build');
} catch {
  sh('git checkout -- package.json package-lock.json CHANGELOG.md');
  fail('Stopped: nothing was committed, the files are back as they were.');
}

sh('git add package.json package-lock.json CHANGELOG.md');
sh(`git commit -m "chore: release ${tag}"`);
sh(`git tag -a ${tag} -m "Subtle ${version}"`);
console.log(`\n✓ ${tag} committed and tagged.`);

if (await yes(`Push main and ${tag} to GitHub?`)) {
  run('git push origin main');
  run(`git push origin ${tag}`);
  console.log(`\n✓ Pushed. The Release workflow publishes the notes: https://github.com/jaysalvat/subtle/releases/tag/${tag}\n`);
} else {
  console.log(`\nWhen you're ready:\n  git push origin main\n  git push origin ${tag}\n`);
}
rl.close();
