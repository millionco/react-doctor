// Shortens text by eliding the middle with a single ellipsis so the result is
// exactly `maxLength` characters. Odd leftover budget favors the front.
export const truncateMiddle = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return "…";

  const budget = maxLength - 1;
  const frontLength = Math.ceil(budget / 2);
  const backLength = Math.floor(budget / 2);
  const front = text.slice(0, frontLength);
  const back = backLength === 0 ? "" : text.slice(text.length - backLength);
  return `${front}…${back}`;
};
