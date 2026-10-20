import type { SandboxToolHost } from '../host';
import type { WebMcpTool } from '../modelContext';
import { bookTools } from './book';
import { checkTools } from './checks';
import { comicTools } from './comics';
import { configTools } from './config';
import { editionCheckTools } from './editionChecks';
import { historyTools } from './history';
import { frameStyleTools } from './frameStyles';
import { moduleTools } from './modules';
import { answerTools, libraryTools } from './library';
import { pageTools } from './pages';
import { resourceTools } from './resources';
import { viewTools } from './view';
import { viewerCommandTools } from './viewerCommands';
import { wordTools } from './word';

/** Every tool the Sandbox hands an agent, in the order an agent meets
 *  them: what is open, the pages, the text, the design, how it is shown,
 *  resources and fonts, comic pages, the books and their files, the checks. */
export function createSandboxTools(host: SandboxToolHost): WebMcpTool[] {
  const [getState, ...text] = bookTools(host);
  return [
    getState!,
    ...pageTools(host),
    ...text,
    ...configTools(host),
    ...historyTools(host),
    ...frameStyleTools(host),
    ...moduleTools(host),
    ...viewTools(host),
    ...viewerCommandTools(host),
    ...resourceTools(host),
    ...comicTools(host),
    ...libraryTools(host),
    ...wordTools(host),
    ...answerTools(host),
    ...checkTools(host),
    ...editionCheckTools(host),
  ];
}
