import { URL_KEYS } from "./model";

/** Set on `<html>` while the gallery shows results instead of the book view.
 *  CSS keys off it (cookbook.css), so a deep link never flashes the book. */
export const FILTERED_ATTR = "data-cb-filtered";

/** A value as a JavaScript literal safe inside an inline `<script>`: the
 *  characters that could close the element or end a line in older parsers
 *  are written as `\u` escapes. */
function scriptLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Inline script emitted by the root layout (never rendered on the client, so
 *  React does not warn about it): on the gallery's path it marks `<html>`
 *  filtered when the URL carries any key of the grammar, before the first
 *  paint. The filters island keeps the attribute in sync and removes it on
 *  unmount (`<html>` survives client navigation). */
export const PREPAINT_SCRIPT = `(function(){try{if(!/^\\/[a-z]{2}\\/cookbook\\/?$/.test(location.pathname))return;var p=new URLSearchParams(location.search),k=${scriptLiteral(
  URL_KEYS,
)},d=document.documentElement;for(var i=0;i<k.length;i++){if(p.get(k[i])){d.setAttribute(${scriptLiteral(
  FILTERED_ATTR,
)},"");return}}d.removeAttribute(${scriptLiteral(FILTERED_ATTR)})}catch(e){}})();`;
