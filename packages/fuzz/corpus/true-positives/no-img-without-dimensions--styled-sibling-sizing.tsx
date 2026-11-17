// rule: no-img-without-dimensions
// weakness: library-idiom
// source: synthetic sibling selector overriding reserved image layout
// verdict: fail

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
const Other = styled.div`
  & + div {
    height: auto !important;
  }
`;
export const Picture = () => (
  <section>
    <Other />
    <Frame>
      <img src="/a.png" alt="" />
    </Frame>
  </section>
);
