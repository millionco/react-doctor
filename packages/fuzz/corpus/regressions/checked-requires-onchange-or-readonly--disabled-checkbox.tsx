// rule: checked-requires-onchange-or-readonly
// weakness: control-flow
// source: corpus census triage (Irev-Dev/cadhub AdminProjects — disabled display-only checkbox)
export const DisplayOnlyCheckbox = ({ checked }: { checked: boolean }) => (
  <input type="checkbox" checked={checked} disabled />
);
export const ExplicitlyDisabledCheckbox = ({ checked }: { checked: boolean }) => (
  <input type="checkbox" checked={checked} disabled={true} />
);
