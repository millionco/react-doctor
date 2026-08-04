import { useStdout } from "ink";
import { TUI_DEFAULT_TERMINAL_COLUMNS, TUI_DEFAULT_TERMINAL_ROWS } from "../../utils/constants.js";
import { useEffect, useState } from "../react-runtime.js";

export interface StdoutDimensions {
  readonly columns: number;
  readonly rows: number;
}

const readDimensions = (stdout: NodeJS.WriteStream | undefined): StdoutDimensions => ({
  columns: stdout?.columns ?? TUI_DEFAULT_TERMINAL_COLUMNS,
  rows: stdout?.rows ?? TUI_DEFAULT_TERMINAL_ROWS,
});

export const useStdoutDimensions = (): StdoutDimensions => {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState(() => readDimensions(stdout));

  useEffect(() => {
    if (!stdout) return;
    const onResize = (): void => setDimensions(readDimensions(stdout));
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return dimensions;
};
