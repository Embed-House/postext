// Side effect: register the citeproc engine, with every bundled style and
// locale, as the engine Postext builds format citations with.
import { registerCitationEngine } from 'postext';
import { createCiteprocEngine } from './engine.js';
import { LOCALES } from './generated/locales.js';
import { STYLES } from './generated/styles.js';

registerCitationEngine(createCiteprocEngine({ styles: STYLES, locales: LOCALES }));
