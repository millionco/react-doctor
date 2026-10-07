// rule: no-passive-request-owner-ref
// verdict: fail
// weakness: traversal-completeness
// source: pull request review regression
export const History = ({ documentId, viewId }) => {
  const documentRef = useRef(documentId);
  const viewRef = useRef(viewId);
  const [, setItems] = useState([]);
  useEffect(() => {
    documentRef.current = documentId;
    viewRef.current = viewId;
  }, [documentId, viewId]);
  const refresh = async () => {
    const items = await load(viewId);
    if (viewRef.current !== viewId) return;
    setItems(items);
  };
  return <button onClick={refresh}>Refresh</button>;
};
