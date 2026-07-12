// rule: client-localstorage-no-version
// weakness: control-flow
// source: react-bench-internal RASMUS_TASKS.md

const STORAGE_KEY = "keybindings";
const DEFAULT_KEY_BINDINGS = { next: "j", previous: "k" };

const isValidKeybindings = (value: unknown): value is typeof DEFAULT_KEY_BINDINGS => {
  if (typeof value !== "object" || value === null) return false;
  return (
    "next" in value &&
    typeof value.next === "string" &&
    "previous" in value &&
    typeof value.previous === "string"
  );
};

const getStoredKeybindings = (): typeof DEFAULT_KEY_BINDINGS => {
  try {
    const rawValue = localStorage.getItem(STORAGE_KEY);
    if (!rawValue) return DEFAULT_KEY_BINDINGS;
    const parsedValue: unknown = JSON.parse(rawValue);
    return isValidKeybindings(parsedValue) ? parsedValue : DEFAULT_KEY_BINDINGS;
  } catch {
    return DEFAULT_KEY_BINDINGS;
  }
};

export const saveKeybindings = (keybindings = getStoredKeybindings()): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keybindings));
};
