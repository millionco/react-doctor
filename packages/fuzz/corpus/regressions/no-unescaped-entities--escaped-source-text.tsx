// rule: no-unescaped-entities
// verdict: pass
// weakness: source-text-decoding
// source: synthetic JSX entity spellings
export const Label = () => (
  <span>It&apos;s &quot;safe&quot; &#39; &#x22; &gt; &#125; &amp;apos;</span>
);
