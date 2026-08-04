// rule: no-self-updating-effect
// verdict: pass
// weakness: alias-guard
// source: ReactBench semantic false positive
export const CountryField = ({ value, defaultCountry }) => {
  const [previousProps, setPreviousProps] = useState({ value: null, defaultCountry: null });
  const valueChanged = previousProps.value !== value;
  const defaultCountryChanged = previousProps.defaultCountry !== defaultCountry;
  useEffect(() => {
    if (!valueChanged && !defaultCountryChanged) return;
    setPreviousProps({ value, defaultCountry });
  }, [value, defaultCountry, previousProps, valueChanged, defaultCountryChanged]);
  return null;
};
