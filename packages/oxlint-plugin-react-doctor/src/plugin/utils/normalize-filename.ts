// Already-normalized paths (the common case — helpers re-normalize each
// other's output) skip the replaceAll allocation.
export const normalizeFilename = (filename: string): string =>
  filename.includes("\\") ? filename.replaceAll("\\", "/") : filename;
