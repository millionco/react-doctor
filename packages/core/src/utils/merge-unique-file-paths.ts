export const mergeUniqueFilePaths = (
  firstFilePaths: ReadonlyArray<string>,
  secondFilePaths: ReadonlyArray<string>,
): ReadonlyArray<string> => [...new Set([...firstFilePaths, ...secondFilePaths])];
