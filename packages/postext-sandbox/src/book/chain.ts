// The whole book as its chapters' own documents, in order, each laid out
// after the pages the chapters before it actually came to — how the PDF
// tab renders the book scope. The plan says what every chapter inherits;
// the chain supplies the pages.

import type { LayoutContinuation, NumeralStyle, StoryJump, VDTDocument } from 'postext';
import { resolveJumpMarks } from 'postext';
import { routeJumps } from './jumps';
import type { ChapterPlan } from './types';

/** Lays out `plans` in order with `build`, chaining the page offset and the
 *  numbering on the documents built, not on the layout records (a record
 *  may be missing or behind). `build` returns null for a chapter to leave
 *  out.
 *
 *  The plan's `bookPageCount` is taken from the records too. When the
 *  configuration prints it (`usesBookTotal`) and a chapter printed another
 *  count than the book came to, the book is laid out once more with the
 *  count it has: the count moves no page, so one more pass settles it. */
export async function layOutBookChain(
  plans: readonly ChapterPlan[],
  build: (plan: ChapterPlan, continuation: LayoutContinuation | undefined, pagesBefore: number) => Promise<VDTDocument | null>,
  usesBookTotal: boolean,
): Promise<VDTDocument[]> {
  const pass = async (bookPageCount: number | undefined): Promise<{ docs: VDTDocument[]; byChapter: VDTDocument[]; pages: number }> => {
    const docs: VDTDocument[] = [];
    /** The documents by the position of their chapter in the book (holes
     *  where a chapter was left out). */
    const byChapter: VDTDocument[] = [];
    // The pages before the book, when it says where it starts (#695).
    let offset = plans[0]?.index === 0 ? plans[0].continuation?.pageIndexOffset ?? 0 : 0;
    let nextNumbering: { format: NumeralStyle; startAt: number } | null = null;
    // The stories the documents built so far send to a page of a later
    // chapter (#943).
    const jumpsIn = new Map<number, StoryJump[]>();
    const total = bookPageCount !== undefined ? { bookPageCount } : {};
    for (const plan of plans) {
      // The first chapter inherits the book's start, if it has one, and
      // the book's page count. The page fields of a plan not yet paginated
      // are provisional: the chain has the real ones.
      const { pageNumbering: planNumbering, jumps: _planJumps, ...inherited } = plan.continuation ?? {};
      void _planJumps;
      const numbering = nextNumbering ?? (plan.paginated ? planNumbering : undefined);
      const incoming = jumpsIn.get(plan.index);
      const continuation: LayoutContinuation | undefined = plan.index === 0
        ? (bookPageCount !== undefined ? { ...plan.continuation, ...total } : plan.continuation)
        : { ...inherited, pageIndexOffset: offset, ...(numbering ? { pageNumbering: numbering } : {}), ...(incoming ? { jumps: incoming } : {}), ...total };
      const doc = await build(plan, continuation, offset);
      if (!doc) continue;
      routeJumps(plan.index, doc.pendingJumps, plan.laterPageIds, jumpsIn);
      docs.push(doc);
      byChapter[plan.index] = doc;
      offset += doc.pages.length;
      const last = doc.pages[doc.pages.length - 1];
      if (last) nextNumbering = { format: last.pageNumberFormat, startAt: last.pageNumberValue + 1 };
    }
    return { docs, byChapter, pages: offset };
  };
  const first = await pass(undefined);
  const settled = !usesBookTotal || first.docs.every((d) => d.bookPageCount === first.pages) ? first : await pass(first.pages);
  // The marks of the stories that jump from one chapter to another name
  // the page it printed (#943).
  if (settled.docs.some((d) => d.pendingJumps)) resolveJumpMarks(settled.byChapter);
  return settled.docs;
}
