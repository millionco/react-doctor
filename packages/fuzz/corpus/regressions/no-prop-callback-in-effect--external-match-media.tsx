// verdict: pass
// rule: no-prop-callback-in-effect
// weakness: library-idiom
// source: React Bench write-react-azouaoui-med-react-p__PobCEen

const Sidebar = ({ query, onBreakPoint }) => {
  const broken = useMediaQuery(query);
  const callbackRef = useRef(onBreakPoint);
  const reactId = useId();

  useEffect(() => {
    if (broken) callbackRef.current?.(true);
  }, [broken, reactId]);

  return null;
};
