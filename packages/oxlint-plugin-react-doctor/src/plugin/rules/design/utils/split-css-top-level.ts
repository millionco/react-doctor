export const splitCssTopLevel = (value: string, separator: string): string[] | null => {
  const parts: string[] = [];
  let depth = 0;
  let partStartIndex = 0;
  for (let characterIndex = 0; characterIndex < value.length; characterIndex += 1) {
    const character = value[characterIndex];
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (character === separator && depth === 0) {
      parts.push(value.slice(partStartIndex, characterIndex).trim());
      partStartIndex = characterIndex + 1;
    }
  }
  if (depth !== 0) return null;
  parts.push(value.slice(partStartIndex).trim());
  return parts;
};
