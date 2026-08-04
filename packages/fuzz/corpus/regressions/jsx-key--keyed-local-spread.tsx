// rule: jsx-key
// verdict: pass
// weakness: copy-tracking
// source: ReactBench semantic false positive
export const Options = ({ options }) =>
  options.map((option) => {
    const optionProps = { key: option.id, value: option.value };
    return <Option {...optionProps} />;
  });
