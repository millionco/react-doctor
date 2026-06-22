export const withNamespace = (
  namespace: string,
  attributes: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> => {
  const namespaced: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes)) {
    namespaced[`${namespace}.${key}`] = value;
  }
  return namespaced;
};
