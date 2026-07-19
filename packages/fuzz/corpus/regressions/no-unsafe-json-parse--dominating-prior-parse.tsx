// rule: no-unsafe-json-parse
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (glific translations: an unconditional prior parse of the same string dominates the re-parse)
export function pickTranslation(translationsVal: string, language: { id: string }) {
  if (translationsVal) {
    const translationsCopy = JSON.parse(translationsVal);
    if (Object.keys(translationsCopy).length > 0) {
      return JSON.parse(translationsVal)[language.id];
    }
  }
  return null;
}
