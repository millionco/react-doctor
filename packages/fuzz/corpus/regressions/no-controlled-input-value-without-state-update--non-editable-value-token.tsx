// rule: no-controlled-input-value-without-state-update
// weakness: library-idiom
// source: PR #1000 deep adversarial audit

export const Actions = () => (
  <>
    <input type="submit" value="Save" onChange={trackSubmission} />
    <input type="button" value="Open" onChange={trackButton} />
  </>
);
