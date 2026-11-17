// rule: no-img-without-dimensions
// weakness: library-idiom
// source: synthetic styled parent reservation contract
// verdict: pass

import styled from "styled-components";

const Frame = styled.div`
  display: block;
  width: 88px;
  height: 88px;
  flex-shrink: 0;
  & img {
    max-width: 100%;
    max-height: 100%;
  }
`;

export const Picture = () => (
  <Frame>
    <img src="/picture.png" alt="" />
  </Frame>
);
