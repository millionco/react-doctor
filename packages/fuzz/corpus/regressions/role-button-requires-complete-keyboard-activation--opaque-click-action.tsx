// rule: role-button-requires-complete-keyboard-activation
// weakness: control-flow
// source: PR #1337 deep review

export const TrackedControl = ({ activate, track }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={() => {
      activate();
      track("click");
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter") track("keyboard");
    }}
  />
);
