// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: PR #1000 deep audit 2026-07
export const ConditionalLoader = ({ id, shouldLoad }: { id: string; shouldLoad: boolean }) => {
  const [, setValue] = useState<string>();
  useEffect(() => {
    const run = async () => (shouldLoad ? await load(id) : setValue(id));
    void run();
  }, [id, shouldLoad]);
  return null;
};
