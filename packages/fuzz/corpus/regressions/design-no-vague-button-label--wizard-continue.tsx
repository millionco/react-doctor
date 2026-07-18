// rule: design-no-vague-button-label
// weakness: other
// source: react-bench-5 FP audit

export const WizardStep = () => (
  <form>
    <button type="button">Back</button>
    <button type="submit">Continue</button>
  </form>
);
