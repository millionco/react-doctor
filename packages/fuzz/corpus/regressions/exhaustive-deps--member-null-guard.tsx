// rule: exhaustive-deps
// verdict: pass
// weakness: alias-guard
// source: ReactBench semantic false positive
export const History = ({ versions, onlyShowMine, currentUser }) =>
  useMemo(() => {
    if (!onlyShowMine || !currentUser) return versions;
    return versions.filter((version) => version.editorId === currentUser.uid);
  }, [versions, onlyShowMine, currentUser?.uid]);
