# web

The [postext.dev](https://postext.dev/) site: the landing page, the documentation, the hosted Sandbox and the Cookbook, in ten languages (`en`, `es`, `ca`, `de`, `fr`, `it`, `pt`, `zh`, `ja`, `ar`; `src/i18n/routing.ts`). It is a Next.js 16 app with Tailwind CSS 4 and next-intl, and it uses the workspace's `postext`, `postext-folio` and `postext-sandbox` packages.

## Getting started

From the repository root, `pnpm install` once, then:

```bash
pnpm dev            # builds the packages, then runs `next dev` on http://localhost:3000
```

Inside `apps/web`:

```bash
pnpm dev            # next dev (the packages must have been built)
pnpm build          # next build
pnpm test           # vitest
pnpm check-types    # tsc --noEmit
pnpm lint           # eslint
pnpm cookbook …     # the Cookbook tools (see cookbook/README.md); `pnpm cookbook` from the root too
pnpm wiki <dir>     # regenerates the doc pages of the GitHub wiki from docs/*-en.mdx into a clone at <dir>
```

## Where things are

- `src/app/[locale]/` — the routes of every locale: landing, `docs`, `sandbox`, `cookbook`, `glossary`, `accessibility` and the legal pages, with `llms.txt`. `src/app/md/` serves the Markdown version of each page for agents (`<page>.md`).
- `../../docs/` — the documentation, one MDX file per topic and locale (`<topic>-<locale>.mdx`), read at build time.
- `../../cookbook/` — the Cookbook recipes; their captures are written to `public/cookbook/`.
- `messages/<locale>.json` — the interface strings of the site and the Sandbox, one catalogue per locale.
- `public/presets/` — the showcase books the Sandbox opens; `public/icc/` the print output profiles; `public/folio/` the Folio desk textures.
- `src/lib/webmcp/` — the WebMCP tools the site gives an agent in the browser on every page.

Pushes to `develop` deploy nothing (`vercel.json`); the site is deployed from `main`.

## Private presets (local only)

The sandbox can load private "preset bundles" (publisher configuration, fonts, logos) from a directory that lives **outside this repository**. Point the `POSTEXT_PRIVATE_PRESETS_DIR` environment variable at that directory (see `.env.example`) and run `pnpm dev`; its files are then served at `/api/private-presets/<relative-path>` and the sandbox picks them up automatically.

- Only files with allow-listed extensions (`json`, `md`, `svg`, `png`, `jpg`, `jpeg`, `webp`, `gif`, `otf`, `ttf`, `woff2`) are served; path traversal, dotfiles and symlinks that escape the directory are refused.
- The variable is read at request time and is only declared for the `dev` task in `turbo.json`. In production it is never set, so the route answers `404` for every path and the sandbox is configured with an empty preset-source list.
- Nothing under that directory belongs in git. Keep it outside the repo and never commit `.env` files (only `.env.example` is tracked).
