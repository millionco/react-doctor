// rule: no-array-index-as-key
// weakness: library-idiom
// source: FP-FIX history (string-character slices: position IS the identity).
//         `.split()` output was later reclassified as data rows (bulwarkmail /
//         tracecat corpus misses), so only the character-slice shapes remain
//         ground-truth-valid here.
export const MatchedName = ({ name }: { name: string }) => (
  <span>
    {[...name].map((char, index) => (
      <em key={index}>{char}</em>
    ))}
  </span>
);
export const SpelledOut = ({ word }: { word: string }) => (
  <div>
    {Array.from(word).map((letter, index) => (
      <b key={index}>{letter}</b>
    ))}
  </div>
);
