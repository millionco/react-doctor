// rule: no-deprecated-keyboard-event-keycode-which
// weakness: alias-guard
// source: deep audit of millionco/react-doctor#1000

export const onKeyDown = (event: KeyboardEvent) => {
  const { key: logicalKey } = event;
  if (logicalKey ? logicalKey === "a" : event.keyCode === 65) select();
};
