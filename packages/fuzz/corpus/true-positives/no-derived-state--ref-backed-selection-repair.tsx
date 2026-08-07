// rule: no-derived-state
// verdict: fail
// weakness: alias-guard
// source: React Bench DocumentHistoryModal ref-indirection cohort (310 duplicate trials)

import { useEffect, useMemo, useRef, useState } from "react";

interface Version {
  versionId: string;
  visible: boolean;
}

export const DocumentHistoryModal = ({
  initialVersions,
  viewId,
}: {
  initialVersions: Version[];
  viewId: string;
}) => {
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
  const selectedVersionIdRef = useRef(selectedVersionId);
  const activeViewIdRef = useRef(viewId);
  const versionsRef = useRef(versions);
  selectedVersionIdRef.current = selectedVersionId;
  activeViewIdRef.current = viewId;
  versionsRef.current = versions;

  useEffect(() => {
    if (visibleVersions.length === 0) {
      if (selectedVersionIdRef.current) {
        setSelectedVersionId("");
      }
      return;
    }

    if (!visibleVersions.some((version) => version.versionId === selectedVersionIdRef.current)) {
      setSelectedVersionId(visibleVersions[0].versionId);
    }
  }, [visibleVersions]);

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
