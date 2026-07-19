// rule: no-deprecated-keyboard-event-keycode-which
// weakness: control-flow
// source: deep audit of millionco/react-doctor#1000

export const onKeyDown = (event: KeyboardEvent) => {
  let enterCode = 65;
  enterCode = 13;
  if (event.keyCode === enterCode) submit();
};
