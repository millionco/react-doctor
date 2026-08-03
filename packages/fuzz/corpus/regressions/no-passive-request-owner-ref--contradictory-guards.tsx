// rule: no-passive-request-owner-ref
// verdict: pass
// weakness: control-flow
// source: pull request review regression
export const History = ({ viewId, shouldLoad }) => {
  const ownerRef = useRef(viewId);
  const [, setVersions] = useState([]);
  useEffect(() => {
    ownerRef.current = viewId;
  }, [viewId]);
  const refresh = async () => {
    if (shouldLoad) {
      await load(viewId);
      if (ownerRef.current !== viewId) return;
    }
    if (!shouldLoad) {
      setVersions([]);
    }
  };
  return <button onClick={refresh}>Refresh</button>;
};
