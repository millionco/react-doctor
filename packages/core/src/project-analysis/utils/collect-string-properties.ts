export const collectStringProperties = (value: unknown, propertyName: string): string[] => {
  const stringValues: string[] = [];
  const visitedValues = new WeakSet<object>();
  const visitValue = (nestedValue: unknown): void => {
    if (!nestedValue || typeof nestedValue !== "object" || visitedValues.has(nestedValue)) return;
    visitedValues.add(nestedValue);

    for (const [key, propertyValue] of Object.entries(nestedValue)) {
      if (key === propertyName && typeof propertyValue === "string") {
        stringValues.push(propertyValue);
      }
      visitValue(propertyValue);
    }
  };
  visitValue(value);
  return stringValues;
};
