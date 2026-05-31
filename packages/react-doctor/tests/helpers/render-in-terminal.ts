import { Terminal } from "@xterm/headless";

export interface TerminalRenderOptions {
  readonly cols: number;
  readonly rows?: number;
}

export interface TerminalRenderResult {
  /** Every non-empty visible row, exactly as the emulator laid it out. */
  readonly rows: string[];
  /** Logical lines with soft-wrapped continuation rows stitched back together. */
  readonly logicalLines: string[];
  /** Rows that exist only because a logical line was too wide and wrapped. */
  readonly wrappedRowCount: number;
  /** True when any logical line exceeded the column width and wrapped. */
  readonly overflowed: boolean;
  /** The full visible buffer joined with newlines (trailing blanks trimmed). */
  readonly text: string;
}

const DEFAULT_ROWS = 200;
const SCROLLBACK_LINES = 5000;

/**
 * Feeds a raw terminal byte stream (ANSI escapes, cursor moves, box-drawing,
 * unicode, etc.) through a headless xterm emulator sized to `cols` × `rows`
 * and reports how it actually renders. This is the source of truth for visual
 * regressions — `string.length` can't see ANSI codes or double-width glyphs,
 * but the emulator lays the grid out exactly like a real terminal would.
 */
export const renderInTerminal = (
  data: string,
  options: TerminalRenderOptions,
): Promise<TerminalRenderResult> => {
  const terminal = new Terminal({
    cols: options.cols,
    rows: options.rows ?? DEFAULT_ROWS,
    scrollback: SCROLLBACK_LINES,
    allowProposedApi: true,
  });

  return new Promise<TerminalRenderResult>((resolve) => {
    terminal.write(data, () => {
      const buffer = terminal.buffer.active;
      const rows: string[] = [];
      const logicalLines: string[] = [];
      let wrappedRowCount = 0;

      for (let lineIndex = 0; lineIndex < buffer.length; lineIndex += 1) {
        const bufferLine = buffer.getLine(lineIndex);
        if (!bufferLine) continue;
        const rowText = bufferLine.translateToString(true);
        rows.push(rowText);

        if (bufferLine.isWrapped) {
          wrappedRowCount += 1;
          logicalLines[logicalLines.length - 1] += rowText;
        } else {
          logicalLines.push(rowText);
        }
      }

      while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
      while (logicalLines.length > 0 && logicalLines[logicalLines.length - 1] === "") {
        logicalLines.pop();
      }

      terminal.dispose();
      resolve({
        rows,
        logicalLines,
        wrappedRowCount,
        overflowed: wrappedRowCount > 0,
        text: rows.join("\n"),
      });
    });
  });
};
