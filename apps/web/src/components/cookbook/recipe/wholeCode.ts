import type { WholeCode, WholeFile } from "./sources";

/** `code.json` by URL, fetched once per page: the whole-recipe view, the
 *  band's actions and the `#L<n>` links share it. A failed fetch is not
 *  kept, so the next attempt tries again. */
const requests = new Map<string, Promise<WholeCode>>();
const loaded = new Map<string, WholeCode>();

export function loadWholeCode(url: string): Promise<WholeCode> {
  let request = requests.get(url);
  if (!request) {
    request = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const code = (await res.json()) as WholeCode;
      loaded.set(url, code);
      return code;
    });
    request.catch(() => requests.delete(url));
    requests.set(url, request);
  }
  return request;
}

/** `code.json` when it has arrived, for the actions that must run inside
 *  the click (a popup, the clipboard). */
export function loadedWholeCode(url: string): WholeCode | null {
  return loaded.get(url) ?? null;
}

/** Starts the fetch and ignores its outcome (a hover, a focus, the view
 *  coming near). */
export function prefetchWholeCode(url: string): void {
  loadWholeCode(url).catch(() => {});
}

/** A file's text, rebuilt from its highlighted lines (one `.cb-lc` per
 *  line, in order, folds included), or "" when the recipe has none. */
export function wholeFileText(file: WholeFile | undefined): string {
  if (!file) return "";
  const template = document.createElement("template");
  template.innerHTML = file.html;
  const lines = [...template.content.querySelectorAll(".cb-lc")].map((el) => el.textContent ?? "");
  return lines.join("\n") + (file.eol ? "\n" : "");
}
