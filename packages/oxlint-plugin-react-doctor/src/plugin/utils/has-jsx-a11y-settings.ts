// When no `jsx-a11y` settings block exists, `getElementType` resolves to the
// raw JSX name, so rules can bail on the raw name without the settings parse.
export const hasJsxA11ySettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  const block = settings?.["jsx-a11y"];
  return typeof block === "object" && block !== null;
};
