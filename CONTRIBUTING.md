# Contributing

Thanks for helping. A few things keep Subtle simple to work on.

- **Run it**: `npm install`, `npm run dev`, then open http://localhost:3000 in Chrome.
- **Before a pull request**: `npm run check` must pass (types, Oxlint, Prettier, tests). `npm run format` fixes the formatting.
- **Where things are and how they're built**: `CLAUDE.md` (architecture, file map, product rules). Read it first: it says, for instance, that every tool is a pure function in `src/lib/` with a test, that every change goes through the store's `commit` so it can be undone, and that every string lives in `src/i18n/`.
- **Pure code comes with a test**: any change in `src/lib/` adds or updates one in `src/lib/lib.test.ts`.
- **Text**: English in `src/i18n/en.ts` (short, sentence case, buttons that say what they do); French in `fr.ts` follows (a missing phrase shows in English).
- **Small pull requests**, one topic each, with [Conventional Commits](https://www.conventionalcommits.org/) messages (`feat: …`, `fix: …`).

## Security

Please don't open a public issue for a security problem: use GitHub's private vulnerability reporting (Security › Report a vulnerability) on this repository.
