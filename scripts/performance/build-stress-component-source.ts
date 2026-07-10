import {
  STRESS_BRANCH_MODULUS,
  STRESS_VALUE_MODULUS,
  STRESS_VALUES_PER_COMPONENT_COUNT,
} from "./constants.ts";

export const buildStressComponentSource = (
  fileIndexLabel: string,
  componentIndex: number,
): string => {
  const componentName = `StressComponent${fileIndexLabel}_${componentIndex}`;
  return `export const ${componentName} = ({ seed }: StressProps) => {
  const [selectedValue, setSelectedValue] = useState(seed);
  const values = useMemo(
    () =>
      Array.from(
        { length: ${STRESS_VALUES_PER_COMPONENT_COUNT} },
        (_, valueIndex) => normalizeStressValue(seed + valueIndex),
      ),
    [seed],
  );
  const total = useMemo(() => {
    let calculatedTotal = 0;
    for (const value of values) {
      if (value % ${STRESS_BRANCH_MODULUS} === 0) {
        calculatedTotal += value * ${STRESS_VALUE_MODULUS};
      } else {
        calculatedTotal += value;
      }
    }
    return calculatedTotal;
  }, [values]);

  useEffect(() => {
    const controller = new AbortController();
    const selectNextValue = () => {
      setSelectedValue((currentValue) => normalizeStressValue(currentValue + 1));
    };
    window.addEventListener("stress-update", selectNextValue, { signal: controller.signal });
    return () => controller.abort();
  }, []);

  return (
    <section aria-label="${componentName}" data-total={total}>
      <button type="button" onClick={() => setSelectedValue(total)}>
        Select calculated value
      </button>
      <output>{selectedValue}</output>
      {values.map((value, index) => (
        <div key={index}>{value}</div>
      ))}
    </section>
  );
};`;
};
