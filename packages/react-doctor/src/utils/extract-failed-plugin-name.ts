import { getErrorChainMessages } from "./format-error-chain.js";

const PLUGIN_CONFIG_PATTERN = /(?:^|[/\\\s])([a-z][a-z0-9-]*)\.config\./i;

export const extractFailedPluginName = (error: unknown): string | null => {
  for (const errorMessage of getErrorChainMessages(error)) {
    const pluginNameMatch = errorMessage.match(PLUGIN_CONFIG_PATTERN);
    if (pluginNameMatch?.[1]) return pluginNameMatch[1].toLowerCase();
  }
  return null;
};
