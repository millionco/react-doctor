// rule: no-adjust-state-on-prop-change
// weakness: alias-guard
// source: AppFlowy DocumentHistoryModal React Bench uonQqwc

import { useEffect, useMemo, useState } from "react";

interface Version {
  versionId: string;
  visible: boolean;
}

export const DocumentHistoryModal = ({ versions }: { versions: Version[] }) => {
  const visibleVersions = useMemo(() => versions.filter((version) => version.visible), [versions]);
  const [selectedVersionId, setSelectedVersionId] = useState("");

  useEffect(() => {
    if (visibleVersions.some((version) => version.versionId === selectedVersionId)) return;
    setSelectedVersionId(visibleVersions[0].versionId);
  }, [visibleVersions]);

  return (
    <VersionList
      versions={visibleVersions}
      selectedVersionId={selectedVersionId}
      onSelect={setSelectedVersionId}
    />
  );
};
