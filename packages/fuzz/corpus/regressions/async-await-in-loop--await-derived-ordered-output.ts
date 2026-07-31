// rule: async-await-in-loop
// weakness: cross-function-data-flow
// source: React Bench fix-react-same-recursive-file-drop
// verdict: pass

interface Entry {
  children: Entry[];
  isFile: boolean;
}

const collectFiles = async (entry: Entry, files: File[]): Promise<void> => {
  if (entry.isFile) {
    const file = await readFile(entry);
    files.push(file);
    return;
  }
  for (const child of entry.children) {
    await collectFiles(child, files);
  }
};

export const readDroppedFiles = async (entries: Entry[]): Promise<File[]> => {
  const files: File[] = [];
  for (const entry of entries) {
    await collectFiles(entry, files);
  }
  return files;
};
