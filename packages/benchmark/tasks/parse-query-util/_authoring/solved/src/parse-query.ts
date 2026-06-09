// Parses a URL query string into a plain object (last value wins per key).
export const parseQuery = (search: string): Record<string, string> => {
  const trimmed = search.startsWith("?") ? search.slice(1) : search;
  const result: Record<string, string> = {};
  if (trimmed === "") return result;

  for (const pair of trimmed.split("&")) {
    if (pair === "") continue;
    const equalsIndex = pair.indexOf("=");
    if (equalsIndex === -1) {
      result[decodeURIComponent(pair)] = "";
      continue;
    }
    const key = decodeURIComponent(pair.slice(0, equalsIndex));
    result[key] = decodeURIComponent(pair.slice(equalsIndex + 1));
  }
  return result;
};
