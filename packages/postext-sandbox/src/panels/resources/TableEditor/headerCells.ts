import type { TableCell, TableModel } from 'postext';

// The header toggles of the table editor: the structural edits the engine's
// table functions do not cover. Pure: each returns a new model.

/** Clone a cell, returning a brand-new object (immutability). */
const cloneCell = (c: TableCell): TableCell => ({ ...c });

/**
 * Toggle whether the first `n` rows are header rows. Sets/clears `isHeader` on
 * the affected cells and updates `headerRowCount`. Pure: returns a new model.
 */
export function setHeaderRows(m: TableModel, headerRowCount: number): TableModel {
  const count = Math.max(0, Math.min(headerRowCount, m.rows.length));
  const rows = m.rows.map((row, r) =>
    row.map((cell) => {
      const next = cloneCell(cell);
      if (r < count) next.isHeader = true;
      else delete next.isHeader;
      return next;
    }),
  );
  return { ...m, rows, headerRowCount: count };
}

/**
 * Toggle whether column `col` is a header column by flipping `isHeader` on each
 * of its cells. Pure: returns a new model.
 */
export function toggleHeaderColumn(m: TableModel, col: number, on: boolean): TableModel {
  const headerRows = m.headerRowCount ?? 0;
  const rows = m.rows.map((row, r) =>
    row.map((cell, c) => {
      if (c !== col) return cell;
      const next = cloneCell(cell);
      // Header rows always stay header cells.
      if (on || r < headerRows) next.isHeader = true;
      else delete next.isHeader;
      return next;
    }),
  );
  return { ...m, rows };
}
