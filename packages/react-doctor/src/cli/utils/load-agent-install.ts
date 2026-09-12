import { createRequire } from "node:module";

type AgentInstallModule = typeof import("agent-install");

const requireAgentInstall = createRequire(import.meta.url);
let cachedAgentInstall: AgentInstallModule | null = null;

// `agent-install` (and the yaml / toml / jsonc parsers it pulls in) only serve
// the install and handoff flows, yet a static import evaluated it on every
// scan's startup path. It is loaded here on first use instead; `require` of
// the ESM package is synchronous on the supported Node versions, so the
// callers keep their signatures.
export const loadAgentInstall = (): AgentInstallModule =>
  (cachedAgentInstall ??= requireAgentInstall("agent-install") as AgentInstallModule);
