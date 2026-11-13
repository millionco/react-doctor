export const LITERAL_JSON_TEXT_TAG_NAMES: ReadonlySet<string> = new Set(["p", "span", "li"]);
export const LITERAL_JSON_TEXT_CALL_ARGUMENT_COUNT = 1;
export const LITERAL_JSON_TEXT_CALLBACK_PARAMETER_COUNT = 2;
export const LITERAL_JSON_TEXT_KEY_ATTRIBUTE_COUNT = 1;
export const LITERAL_JSON_TEXT_UNSAFE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
