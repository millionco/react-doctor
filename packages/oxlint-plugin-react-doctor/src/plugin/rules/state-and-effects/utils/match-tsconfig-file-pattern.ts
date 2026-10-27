import { compileGlob } from "../../../utils/compile-glob.js";

export const matchTsconfigFilePattern = (filename: string, pattern: string): boolean => {
  const fileSegments = filename.split("/");
  const patternSegments = pattern.replace(/^\.\//u, "").split("/");
  const visited = new Map<string, boolean>();
  const matchSegments = (fileIndex: number, patternIndex: number): boolean => {
    const key = `${fileIndex}:${patternIndex}`;
    const cached = visited.get(key);
    if (cached !== undefined) return cached;
    const segment = patternSegments[patternIndex];
    let result: boolean;
    if (segment === undefined) {
      result = fileIndex === fileSegments.length;
    } else if (segment === "**") {
      result =
        matchSegments(fileIndex, patternIndex + 1) ||
        (fileIndex < fileSegments.length && matchSegments(fileIndex + 1, patternIndex));
    } else {
      result =
        fileIndex < fileSegments.length &&
        compileGlob(segment).test(fileSegments[fileIndex]) &&
        matchSegments(fileIndex + 1, patternIndex + 1);
    }
    visited.set(key, result);
    return result;
  };
  return matchSegments(0, 0);
};
