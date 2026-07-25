// rule: no-derived-state-effect
// weakness: alias-guard
// source: AppFlowy DocumentHistoryModal React Bench uonQqwc

import { useEffect, useMemo, useState } from "react";

interface Version {
  versionId: string;
  visible: boolean;
}

export const DocumentHistoryModal = ({ initialVersions }: { initialVersions: Version[] }) => {
  const [versions] = useState(initialVersions);
  const visibleVersions = useMemo(() => versions.filter((version) => version.visible), [versions]);
  const [selectedVersionId, setSelectedVersionId] = useState("");

  useEffect(() => {
    if (visibleVersions.length === 0) {
      if (selectedVersionId) setSelectedVersionId("");
      return;
    }
    if (visibleVersions.some((version) => version.versionId === selectedVersionId)) return;
    setSelectedVersionId(visibleVersions[0].versionId);
  }, [visibleVersions, selectedVersionId]);

  return (
    <button onClick={() => setSelectedVersionId(visibleVersions[0]?.versionId ?? "")}>
      {selectedVersionId}
    </button>
  );
};
