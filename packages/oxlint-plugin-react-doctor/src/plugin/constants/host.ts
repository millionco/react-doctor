// Global registry key under which the plugin publishes `resetFilesystemCaches`
// for the host that keeps one oxlint process warm across lint jobs. Mirrored in
// `@react-doctor/core/src/constants.ts`.
export const REACT_DOCTOR_PLUGIN_RESET_HOOK_KEY = Symbol.for(
  "react-doctor.reset-filesystem-caches",
);
