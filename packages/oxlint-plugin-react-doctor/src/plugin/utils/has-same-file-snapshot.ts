import type { Stats } from "node:fs";

export const hasSameFileSnapshot = (before: Stats, after: Stats): boolean =>
  before.dev === after.dev &&
  before.ino === after.ino &&
  before.mtimeMs === after.mtimeMs &&
  before.ctimeMs === after.ctimeMs &&
  before.size === after.size;
