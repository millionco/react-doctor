interface InternalConfig {
  apiKey: string;
  region: string;
}

export interface PublicResult {
  success: boolean;
}

export const initialize = (config: InternalConfig): PublicResult => {
  return { success: Boolean(config.apiKey) };
};

export const teardown = (config: InternalConfig): void => {
  void config;
};
