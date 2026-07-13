// rule: no-sync-xhr
// weakness: name-heuristic
// source: ISSUES_TO_FIX_ASAP.md Web API receiver provenance matrix
interface Archive {
  open(mode: string, path: string, createIfMissing: boolean): void;
}

export const openExistingArchive = (archive: Archive) => {
  archive.open("read", "/documents.zip", false);
};
