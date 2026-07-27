export const getCssFunctionContents = (value: string): string | null => {
  const openingParenthesisIndex = value.indexOf("(");
  if (openingParenthesisIndex < 0 || !value.endsWith(")")) return null;
  let depth = 0;
  for (
    let characterIndex = openingParenthesisIndex;
    characterIndex < value.length;
    characterIndex += 1
  ) {
    const character = value[characterIndex];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0 || (depth === 0 && characterIndex !== value.length - 1)) return null;
  }
  return depth === 0 ? value.slice(openingParenthesisIndex + 1, -1) : null;
};
