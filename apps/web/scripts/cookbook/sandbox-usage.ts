/** The usage of `pnpm cookbook sandbox`, apart from the check itself (which
 *  loads the harness): `pnpm cookbook help sandbox` prints it. */
export const SANDBOX_USAGE = `pnpm cookbook sandbox [slug…] [options]

  Lays out each captured edition's <slug>.postext the way the Sandbox does
  (its font loader, its layout service, its worker) and compares it with what
  capture.json records: sandbox.chapters (pages and layout hash per chapter)
  and sandbox.warnings (the warnings of the pen's builds). With no slugs:
  every captured recipe.

  --lang <en,es>         Only these editions
  --site <url>           A deployed site (https://postext.dev, or a next start
                         of a build): the Sandbox route itself, one browser
                         context per edition. Fails too when the page fetched
                         another edition's bundle. --strict is the default here
  --strict               A chapter count, a page count or a layout hash other
                         than the recorded one fails (without it: a warning)
  --no-strict            With --site: differences in pages are warnings
  --concurrency <n>      Editions at once (default 3)
  --timeout <s>          How long one edition may take (default 60)
  --report <out.json>    The results as JSON

  Without --site the Sandbox is built from the working tree with bun
  (packages/postext-cli's own); build the packages first (pnpm turbo run
  build --filter=postext-sandbox...).`;
