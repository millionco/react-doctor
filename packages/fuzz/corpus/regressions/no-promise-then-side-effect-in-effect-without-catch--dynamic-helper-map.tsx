// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: dynamic-computed
// source: PR #1000 deep audit 2026-07
const helpers = {
  safe: () => Promise.resolve(null),
  unsafe: async () => fetch("/value"),
};

export const DynamicLoader = ({ helperName }: { helperName: keyof typeof helpers }) => {
  const [, setValue] = useState<unknown>();
  const load = helpers[helperName];
  useEffect(() => {
    load().then(setValue);
  }, [load]);
  return null;
};
