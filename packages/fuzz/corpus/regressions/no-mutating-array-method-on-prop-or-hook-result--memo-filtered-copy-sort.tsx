// rule: no-mutating-array-method-on-prop-or-hook-result
// weakness: copy-tracking
// source: react-bench corpus audit 2026-07 (file viewer: the sorted useMemo result is a fresh .filter() copy, never the store array)
import { useMemo } from "react";
import { useAppSelector } from "./store";

export function FileViewer() {
  const currentItemsFolder = useAppSelector(
    (state) => state.storage.levels[state.storage.currentFolderId],
  );
  const folderFiles = useMemo(
    () => currentItemsFolder?.filter((item) => !item.isFolder),
    [currentItemsFolder],
  );
  const sortedFolderFiles = useMemo(() => {
    if (folderFiles) {
      return folderFiles.sort((a, b) => (a.name > b.name ? 1 : -1));
    }
    return [];
  }, [folderFiles]);
  return (
    <ul>
      {sortedFolderFiles.map((file) => (
        <li key={file.name}>{file.name}</li>
      ))}
    </ul>
  );
}
