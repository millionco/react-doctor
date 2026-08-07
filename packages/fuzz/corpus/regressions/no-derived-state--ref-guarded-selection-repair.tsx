// rule: no-derived-state
// verdict: fail
// weakness: ref-provenance
// source: React Bench AppFlowy DocumentHistoryModal trial 2oin5YH

import { useEffect, useMemo, useRef, useState } from "react";

interface Version {
  versionId: string;
}

interface DocumentHistoryModalProps {
  initialVersions: Version[];
}

export const DocumentHistoryModal = ({ initialVersions }: DocumentHistoryModalProps) => {
  const [versions] = useState(initialVersions);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const selectedVersionIdRef = useRef(selectedVersionId);
  selectedVersionIdRef.current = selectedVersionId;
  const visibleVersions = useMemo(() => [...versions], [versions]);

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
    <select
      value={selectedVersionId}
      onChange={(event) => setSelectedVersionId(event.target.value)}
    >
      {visibleVersions.map((version) => (
        <option key={version.versionId}>{version.versionId}</option>
      ))}
    </select>
  );
};
