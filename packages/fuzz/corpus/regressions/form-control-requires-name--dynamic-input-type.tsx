// rule: form-control-requires-name
// weakness: dynamic input type can select a button-like control
// source: automated review on PR #1337

export const DynamicInputType = ({ inputType }: { inputType: string }) => (
  <form>
    <input type={inputType} />
  </form>
);
