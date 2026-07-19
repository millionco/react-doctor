// rule: no-deprecated-keyboard-event-keycode-which
// weakness: control-flow
// source: PR #1000 deep adversarial audit

export const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape") closeDialog();
  if (event.keyCode === 65) selectAll();
};
