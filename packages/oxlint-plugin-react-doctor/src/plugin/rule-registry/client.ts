// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { clientLocalstorageNoVersion } from "./../rules/client/client-localstorage-no-version.js";
import { clientPassiveEventListeners } from "./../rules/client/client-passive-event-listeners.js";

export const ClientRuleEntries = [
  {
    key: "react-doctor/client-localstorage-no-version",
    id: "client-localstorage-no-version",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...clientLocalstorageNoVersion,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/client-passive-event-listeners",
    id: "client-passive-event-listeners",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...clientPassiveEventListeners,
      framework: "global",
      category: "Performance",
    },
  },
] as const;
