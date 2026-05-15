export const hasResponsivePrefix = (classNameValue: string, axisPrefix: string): boolean =>
  new RegExp(`(?:^|\\s)\\w+:${axisPrefix}-`).test(classNameValue);
