export interface ShouldEnableRuleByDefaultStatusOptions {
  readonly defaultEnabled?: boolean;
  readonly includeTagDefaults: boolean;
  readonly hasIncludedTags: boolean;
  readonly hasExplicitOverride?: boolean;
}

export const shouldEnableRuleByDefaultStatus = (
  options: ShouldEnableRuleByDefaultStatusOptions,
): boolean =>
  options.defaultEnabled !== false ||
  options.hasExplicitOverride === true ||
  (options.includeTagDefaults && options.hasIncludedTags);
