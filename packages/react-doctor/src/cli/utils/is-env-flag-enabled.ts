export const isEnvFlagEnabled = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true";
