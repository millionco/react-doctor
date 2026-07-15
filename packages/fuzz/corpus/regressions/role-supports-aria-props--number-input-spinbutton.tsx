// rule: role-supports-aria-props
// weakness: library-idiom
// source: React Bench write-react-musama619-react-photo-editor-286
export const NumberInput = ({ minimum, maximum, value }) => (
  <input
    type="number"
    min={minimum}
    max={maximum}
    value={value}
    aria-valuemin={minimum}
    aria-valuemax={maximum}
    aria-valuenow={value}
  />
);
