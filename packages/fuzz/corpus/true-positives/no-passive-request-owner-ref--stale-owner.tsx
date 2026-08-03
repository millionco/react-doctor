// rule: no-passive-request-owner-ref
// verdict: fail
// source: stale request owner regression
export const History = ({ viewId }) => {
  const ownerRef = useRef(viewId);
  const [, setVersions] = useState([]);
  useEffect(() => {
    ownerRef.current = viewId;
  }, [viewId]);
  const refresh = async () => {
    const versions = await load(viewId);
    if (ownerRef.current !== viewId) return;
    setVersions(versions);
  };
  return <button onClick={refresh}>Refresh</button>;
};
