import { $prose } from "@milkdown/utils";
import { Plugin, Selection } from "@milkdown/prose/state";
import { isInTable } from "@milkdown/prose/tables";
import type { EditorView } from "@milkdown/prose/view";

type ClipboardGrid = string[][];

function normalizeCellText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .trim();
}

function normalizeGrid(rows: ClipboardGrid): ClipboardGrid | null {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  if (rows.length === 0 || columnCount === 0) return null;

  return rows.map((row) => Array.from(
    { length: columnCount },
    (_, columnIndex) => normalizeCellText(row[columnIndex] ?? ""),
  ));
}

function gridFromHtml(html: string): ClipboardGrid | null {
  if (!html.includes("<table")) return null;

  const documentFragment = new DOMParser().parseFromString(html, "text/html");
  const table = documentFragment.querySelector("table");
  if (!table) return null;

  const grid: ClipboardGrid = [];
  let rowIndex = 0;

  for (const row of Array.from(table.querySelectorAll("tr"))) {
    grid[rowIndex] ??= [];
    let columnIndex = 0;
    const cells = Array.from(row.children).filter((cell): cell is HTMLTableCellElement => (
      cell instanceof HTMLTableCellElement
    ));

    for (const cell of cells) {
      while (grid[rowIndex]![columnIndex] !== undefined) columnIndex += 1;

      const rowSpan = Math.max(1, cell.rowSpan || 1);
      const columnSpan = Math.max(1, cell.colSpan || 1);
      const value = normalizeCellText(cell.innerText || cell.textContent || "");

      for (let spanRow = 0; spanRow < rowSpan; spanRow += 1) {
        const targetRow = rowIndex + spanRow;
        grid[targetRow] ??= [];
        for (let spanColumn = 0; spanColumn < columnSpan; spanColumn += 1) {
          grid[targetRow]![columnIndex + spanColumn] = spanRow === 0 && spanColumn === 0 ? value : "";
        }
      }
      columnIndex += columnSpan;
    }
    rowIndex += 1;
  }

  return normalizeGrid(grid);
}

function gridFromTabSeparatedText(text: string): ClipboardGrid | null {
  if (!text.includes("\t")) return null;

  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  while (rows[rows.length - 1] === "") rows.pop();
  return normalizeGrid(rows.map((row) => row.split("\t")));
}

function tableFromGrid(view: EditorView, grid: ClipboardGrid) {
  const { table, table_header_row: headerRow, table_header: header, table_row: bodyRow, table_cell: cell, paragraph } = view.state.schema.nodes;
  if (!table || !headerRow || !header || !bodyRow || !cell || !paragraph) return null;

  const columnCount = grid[0]?.length ?? 0;
  if (columnCount === 0) return null;

  const createCell = (type: typeof header | typeof cell, value: string) => {
    const content = value ? paragraph.create(null, view.state.schema.text(value)) : paragraph.createAndFill()!;
    return type.create(null, content);
  };
  const createRow = (type: typeof headerRow | typeof bodyRow, cellType: typeof header | typeof cell, values: string[]) => (
    type.create(null, values.map((value) => createCell(cellType, value)))
  );

  const headerValues = grid[0]!;
  const bodyValues = grid.length > 1 ? grid.slice(1) : [Array.from({ length: columnCount }, () => "")];
  return table.create(null, [
    createRow(headerRow, header, headerValues),
    ...bodyValues.map((values) => createRow(bodyRow, cell, values)),
  ]);
}

export const spreadsheetTablePastePlugin = $prose(() => new Plugin({
  props: {
    handlePaste(view, event) {
      if (isInTable(view.state)) return false;

      const clipboard = event.clipboardData;
      if (!clipboard) return false;

      const grid = gridFromHtml(clipboard.getData("text/html"))
        ?? gridFromTabSeparatedText(clipboard.getData("text/plain"));
      if (!grid) return false;

      const table = tableFromGrid(view, grid);
      if (!table) return false;

      const { from } = view.state.selection;
      const transaction = view.state.tr.replaceSelectionWith(table);
      const selection = Selection.findFrom(transaction.doc.resolve(from), 1, true);
      event.preventDefault();
      view.dispatch(selection ? transaction.setSelection(selection).scrollIntoView() : transaction.scrollIntoView());
      return true;
    },
  },
}));
