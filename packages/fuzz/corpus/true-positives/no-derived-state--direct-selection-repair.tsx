// rule: no-derived-state
// verdict: fail
// weakness: alias-guard
// source: React Bench DocumentHistoryModal false-NEW cohort (61 duplicate trials)

import { useEffect, useMemo, useState } from "react";

interface Version {
  versionId: string;
  visible: boolean;
}

export const DocumentHistoryModal = ({ initialVersions }: { initialVersions: Version[] }) => {
  const [versions, setVersions] = useState(initialVersions);
  const [onlyShowMine, setOnlyShowMine] = useState(false);
  const visibleVersions = useMemo(() => {
    let filtered = [...versions];
    if (onlyShowMine) {
      filtered = filtered.filter((version) => version.visible);
    }
    return filtered;
  }, [versions, onlyShowMine]);
  const [selectedVersionId, setSelectedVersionId] = useState("");

  useEffect(() => {
    if (visibleVersions.length === 0) {
      if (selectedVersionId) {
        setSelectedVersionId("");
      }
      return;
    }

    if (!visibleVersions.some((version) => version.versionId === selectedVersionId)) {
      setSelectedVersionId(visibleVersions[0].versionId);
    }
  }, [visibleVersions, selectedVersionId]);

  return (
    <VersionList
      versions={visibleVersions}
      selectedVersionId={selectedVersionId}
      onSelect={setSelectedVersionId}
      onVersionsChange={setVersions}
      onOnlyShowMineChange={setOnlyShowMine}
    />
  );
};

declare const VersionList: (props: {
  versions: Version[];
  selectedVersionId: string;
  onSelect: (versionId: string) => void;
  onVersionsChange: (versions: Version[]) => void;
  onOnlyShowMineChange: (onlyShowMine: boolean) => void;
}) => React.ReactNode;
