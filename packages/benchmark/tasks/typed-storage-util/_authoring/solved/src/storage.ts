export const readJson = <Value>(key: string, fallback: Value): Value => {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    // Annotate rather than cast: `JSON.parse` returns `any`, which assigns to
    // `Value` without a `as` assertion.
    const parsed: Value = JSON.parse(raw);
    return parsed;
  } catch {
    return fallback;
  }
};

export const writeJson = <Value>(key: string, value: Value): void => {
  localStorage.setItem(key, JSON.stringify(value));
};
