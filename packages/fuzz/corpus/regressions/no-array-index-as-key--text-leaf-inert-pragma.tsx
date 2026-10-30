// rule: no-array-index-as-key
// verdict: pass
// weakness: name-heuristic
// source: independently synthetic inert JSX pragma string with closed primitive leaf
// file-path: src/primitive-text-leaf-inert-pragma.tsx
const label = "@jsx customElement";
void label;
import React from "react";
import styled from "styled-components";
interface TextChunksProps {
  source: string;
}
const _Glyph = styled.span``;
function readChunks(input: string): string[] {
  return input.match(/.{1,8}/g) ?? [];
}
function readPairs(input: string): string[] {
  return input.match(/.{1,2}/g) ?? [];
}
export const TextChunks = ({ source }: TextChunksProps) => {
  const groups = readChunks(source).map(readPairs);
  return (
    <section>
      {groups.map((group, _index) => (
        <div>
          {group.map((token, idx) => (
            <span key={idx}>{token}</span>
          ))}
        </div>
      ))}
    </section>
  );
};
