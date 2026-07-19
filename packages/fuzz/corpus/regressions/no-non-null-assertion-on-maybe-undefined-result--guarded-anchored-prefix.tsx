// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: control-flow
// source: React Bench audit of millionco/react-doctor#1000

export const readBacktickRun = (text: string, index: number) => {
  if (text[index] !== "`") return null;
  return text.slice(index).match(/^`+/)![0];
};
