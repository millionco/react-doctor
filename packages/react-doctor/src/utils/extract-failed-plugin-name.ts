import { getErrorChainMessages } from "./format-error-chain.js";

const PLUGIN_CONFIG_PATTERN = /(?:^|[/\\\s])([a-z][a-z0-9-]*)\.config\./i;
const RC_DOTFILE_PATTERN = /(?:^|[/\\])\.([a-z][a-z0-9-]*?)rc(?:\.[a-z]+)?(?:\b|$)/i;

export const extractFailedPluginName = (error: unknown): string | null => {
  for (const errorMessage of getErrorChainMessages(error)) {
    const pluginNameMatch = errorMessage.match(PLUGIN_CONFIG_PATTERN);
    if (pluginNameMatch?.[1]) return pluginNameMatch[1].toLowerCase();
    const rcMatch = errorMessage.match(RC_DOTFILE_PATTERN);
    if (rcMatch?.[1]) return rcMatch[1].toLowerCase();
  }
  return null;
};
