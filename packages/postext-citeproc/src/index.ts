/**
 * postext-citeproc: citation formatting for Postext. Registers a CSL
 * engine (citeproc-js) with the bundled styles and locales:
 *
 * ```ts
 * import 'postext-citeproc/register';
 * ```
 *
 * or, to choose what is bundled, `registerCitationEngine(createCiteprocEngine({ styles, locales }))`.
 */
export { createCiteprocEngine, pickLocale, type CslSources } from './engine.js';
export { parseBibtex, latexToText, type BibtexIssue } from 'postext';
export { STYLE_CATALOG } from './catalog.js';
export { STYLES } from './generated/styles.js';
export { LOCALES } from './generated/locales.js';
