export const FIRST_ARGUMENT_INDEX = 0;
export const SECOND_ARGUMENT_INDEX = 1;
export const NATIVE_MEDIA_CALL_ARGUMENT_COUNT = 1;
export const NATIVE_MEDIA_EFFECT_PARAMETER_COUNT = 0;
export const NATIVE_MEDIA_STATE_TUPLE_LENGTH = 2;
export const NATIVE_MEDIA_ELEMENT_NAMES: ReadonlySet<string> = new Set(["video", "audio"]);
export const NATIVE_MEDIA_SUPPORT_VALUES: ReadonlySet<string> = new Set(["", "maybe", "probably"]);
export const NATIVE_MEDIA_PROVIDER_NAMES: ReadonlySet<string> = new Set([
  "Document",
  "HTMLDocument",
  "XMLDocument",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLMediaElement",
  "HTMLVideoElement",
  "HTMLAudioElement",
]);
