// rule: no-passive-request-owner-ref
// verdict: pass
// weakness: control-flow
// source: pull request review regression
export const History = ({ viewId }) => {
  const ownerRef = useRef(viewId);
  const [, setWasSuperseded] = useState(false);
  useEffect(() => {
    ownerRef.current = viewId;
  }, [viewId]);
  const refresh = async () => {
    await load(viewId);
    if (ownerRef.current !== viewId) {
      setWasSuperseded(true);
      return;
    }
  };
  return <button onClick={refresh}>Refresh</button>;
};
