// rule: no-mirror-prop-effect
// weakness: callback-return-shape
// source: strict verdict-preserving fuzz
// verdict: fail

export const Form = ({ value }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    return setDraft(value);
  }, [value]);
  return <span>{draft}</span>;
};
