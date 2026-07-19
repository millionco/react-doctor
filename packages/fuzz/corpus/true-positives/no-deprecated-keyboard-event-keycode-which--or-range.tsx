// rule: no-deprecated-keyboard-event-keycode-which
// weakness: control-flow
// source: deep audit of millionco/react-doctor#1000

export const onKeyDown = (event: KeyboardEvent) => {
  if (event.keyCode >= 37 || event.keyCode <= 40) moveFocus();
};
