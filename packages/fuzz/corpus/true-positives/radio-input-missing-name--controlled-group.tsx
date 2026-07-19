// rule: radio-input-missing-name
// weakness: library-idiom
// source: PR #1000 deep adversarial audit

export const Choices = ({ value }: { value: string }) => (
  <>
    <input type="radio" checked={value === "a"} onChange={chooseA} />
    <input type="radio" checked={value === "b"} onChange={chooseB} />
  </>
);
