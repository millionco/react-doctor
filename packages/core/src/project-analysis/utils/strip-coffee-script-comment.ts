export const stripCoffeeScriptComment = (line: string): string => {
  let quote = "";
  let isEscaped = false;
  for (let characterIndex = 0; characterIndex < line.length; characterIndex++) {
    const character = line[characterIndex];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (character === "\\") {
      isEscaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") return line.slice(0, characterIndex);
  }
  return line;
};
