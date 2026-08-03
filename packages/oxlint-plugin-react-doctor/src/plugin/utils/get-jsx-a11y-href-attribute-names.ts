const DEFAULT_HREF_ATTRIBUTE_NAMES: ReadonlyArray<string> = ["href"];

export const getJsxA11yHrefAttributeNames = (
  settings: Readonly<Record<string, unknown>> | undefined,
): ReadonlyArray<string> => {
  const jsxA11y = settings?.["jsx-a11y"];
  if (typeof jsxA11y !== "object" || jsxA11y === null) return DEFAULT_HREF_ATTRIBUTE_NAMES;
  const attributes = Reflect.get(jsxA11y, "attributes");
  if (typeof attributes !== "object" || attributes === null) return DEFAULT_HREF_ATTRIBUTE_NAMES;
  const hrefAttributeNames = Reflect.get(attributes, "href");
  if (
    !Array.isArray(hrefAttributeNames) ||
    !hrefAttributeNames.every((attributeName: unknown) => typeof attributeName === "string")
  ) {
    return DEFAULT_HREF_ATTRIBUTE_NAMES;
  }
  return hrefAttributeNames;
};
