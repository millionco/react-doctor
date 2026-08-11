import { vi } from "vite-plus/test";

export interface CapturedStdout {
  readonly lines: string[];
  readonly restore: () => void;
}

export const captureStdout = (): CapturedStdout => {
  const lines: string[] = [];
  const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  return { lines, restore: () => writeSpy.mockRestore() };
};
