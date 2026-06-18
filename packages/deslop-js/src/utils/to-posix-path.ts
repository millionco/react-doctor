// fast-glob returns and expects forward-slash (Unix-style) paths on every
// platform and recommends converting Windows-style paths to match, so collapse
// the backslashes that oxc-resolver and node:path emit on Windows.
// See fast-glob: "How to write patterns on Windows?"
export const toPosixPath = (filePath: string): string => filePath.replace(/\\/g, "/");
