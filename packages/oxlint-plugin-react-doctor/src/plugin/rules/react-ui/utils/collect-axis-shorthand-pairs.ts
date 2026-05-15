export const collectAxisShorthandPairs = (
  classNameValue: string,
  horizontalPattern: RegExp,
  verticalPattern: RegExp,
): Array<{ value: string }> => {
  const horizontalValues = new Set<string>();
  for (const horizontalMatch of classNameValue.matchAll(horizontalPattern)) {
    horizontalValues.add(`${horizontalMatch[1]}${horizontalMatch[2]}`);
  }
  const matchedPairs: Array<{ value: string }> = [];
  for (const verticalMatch of classNameValue.matchAll(verticalPattern)) {
    const verticalValue = `${verticalMatch[1]}${verticalMatch[2]}`;
    if (horizontalValues.has(verticalValue)) {
      matchedPairs.push({ value: verticalValue });
    }
  }
  return matchedPairs;
};
