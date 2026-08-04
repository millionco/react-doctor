import { useState } from "react";

export const FileSelection = () => {
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set());

  const togglePath = (path: string) => {
    setOpenPaths((previousPaths) => {
      const nextPaths = new Set(previousPaths);
      if (nextPaths.has(path)) nextPaths.delete(path);
      else nextPaths.add(path);
      return nextPaths;
    });
  };

  return (
    <button type="button" onClick={() => togglePath("README.md")}>
      {openPaths.has("README.md") ? "Close" : "Open"}
    </button>
  );
};
