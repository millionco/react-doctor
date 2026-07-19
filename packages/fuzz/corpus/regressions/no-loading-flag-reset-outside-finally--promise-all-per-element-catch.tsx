// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (never-rejecting Promise.all: every element carries its own .catch fallback)
import { useState } from "react";
import { listImageGallery, listMediaCollections, listVideoHistory } from "./media-api";

export const MediaLibrary = () => {
  const [loading, setLoading] = useState(false);
  const [collections, setCollections] = useState<string[]>([]);
  const refresh = async () => {
    setLoading(true);
    const [cols] = await Promise.all([
      listMediaCollections().catch(() => []),
      listImageGallery().catch(() => []),
      listVideoHistory().catch(() => []),
    ]);
    setCollections(cols);
    setLoading(false);
  };
  return (
    <button type="button" disabled={loading} onClick={refresh}>
      Refresh ({collections.length})
    </button>
  );
};
