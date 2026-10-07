// rule: no-passive-request-owner-ref
// verdict: fail
// weakness: control-flow
// source: pull request review regression
export const History = ({ viewId }) => {
  const ownerRef = useRef(viewId);
  const [, setItems] = useState([]);
  useEffect(() => {
    ownerRef.current = viewId;
  }, [viewId]);
  const refresh = async () => {
    const items = await load(viewId);
    if (ownerRef.current !== viewId) {
      return;
    } else {
      setItems(items);
    }
  };
  return <button onClick={refresh}>Refresh</button>;
};
