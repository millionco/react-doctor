// rule: no-array-index-as-key
// weakness: library-idiom
// source: FP-FIX history (string fragments: position IS the identity)
export const MatchedName = ({ name }: { name: string }) => (
  <span>
    {[...name].map((char, index) => (
      <em key={index}>{char}</em>
    ))}
  </span>
);
export const Paragraphs = ({ body }: { body: string }) => (
  <div>
    {body.split("\n").map((line, index) => (
      <p key={index}>{line}</p>
    ))}
  </div>
);
