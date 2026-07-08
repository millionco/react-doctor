// Mirrors `oxc_linter::utils::react::MOUSE_EVENT_HANDLERS` and
// `KEYBOARD_EVENT_HANDLERS`. Used by jsx-a11y rules that look for
// pointer / keyboard interactions on a JSX element.

const MOUSE_EVENT_HANDLERS: ReadonlyArray<string> = [
  "onClick",
  "onContextMenu",
  "onDblClick",
  "onDoubleClick",
  "onDrag",
  "onDragEnd",
  "onDragEnter",
  "onDragExit",
  "onDragLeave",
  "onDragOver",
  "onDragStart",
  "onDrop",
  "onMouseDown",
  "onMouseEnter",
  "onMouseLeave",
  "onMouseMove",
  "onMouseOut",
  "onMouseOver",
  "onMouseUp",
];

const KEYBOARD_EVENT_HANDLERS: ReadonlyArray<string> = ["onKeyDown", "onKeyPress", "onKeyUp"];

export const ALL_EVENT_HANDLERS: ReadonlyArray<string> = [
  ...MOUSE_EVENT_HANDLERS,
  ...KEYBOARD_EVENT_HANDLERS,
];

// Lowercased Set for single-pass, case-insensitive presence checks over an
// element's attributes — one lookup per attribute instead of one full
// attribute scan per handler name.
export const ALL_EVENT_HANDLERS_LOWER: ReadonlySet<string> = new Set(
  ALL_EVENT_HANDLERS.map((handlerName) => handlerName.toLowerCase()),
);
