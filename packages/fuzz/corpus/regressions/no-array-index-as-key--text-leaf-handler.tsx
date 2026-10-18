// rule: no-array-index-as-key
// verdict: fail
// weakness: library-idiom
// source: independently synthetic closed primitive text leaf profile
import React from "react";
import styled from "styled-components";
interface TextRunProps {
  source: string;
}
const TextGlyph = styled.span``;
function readChunks(input: string): string[] {
  return input.match(/.{1,8}/g) ?? [];
}
function readPairs(input: string): string[] {
  return input.match(/.{1,2}/g) ?? [];
}
export const TextRun = ({ source }: TextRunProps) => {
  const groups = readChunks(source).map(readPairs);
  return (
    <section>
      {groups.map((group, _position) => (
        <div key={_position}>
          {group.map((token, index) => (
            <TextGlyph key={index} onClick={() => {}}>
              {token}
            </TextGlyph>
          ))}
        </div>
      ))}
    </section>
  );
};
