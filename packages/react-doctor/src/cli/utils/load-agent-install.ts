import { createLazyRequire } from "./create-lazy-require.js";

type AgentInstallModule = typeof import("agent-install");

// `agent-install` (and the yaml / toml / jsonc parsers it pulls in) only serve
// the install and handoff flows, yet a static import evaluated it on every
// scan's startup path.
export const loadAgentInstall = createLazyRequire<AgentInstallModule>(
  import.meta.url,
  "agent-install",
);
