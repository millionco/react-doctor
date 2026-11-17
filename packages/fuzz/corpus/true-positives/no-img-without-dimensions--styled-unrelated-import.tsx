// rule: no-img-without-dimensions
// weakness: library-idiom
// source: synthetic styled template with external stylesheet import
// verdict: fail

import styled from "styled-components";
const Other = styled.div`
  @import url("/sizing.css");
`;
const Frame = styled.div`
  width: 88px;
  height: 88px;
  flex-shrink: 0;
  & img {
    max-width: 100%;
    max-height: 100%;
  }
`;
export const View = () => (
  <section>
    <Other />
    <Frame>
      <img src="/a.png" alt="" />
    </Frame>
  </section>
);
