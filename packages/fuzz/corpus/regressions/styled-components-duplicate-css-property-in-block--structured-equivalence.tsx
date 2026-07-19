import styled from "styled-components";

const flags = { active: true };

const _ComputedMember = styled.div`
  height: ${() => (flags.active ? "100vh" : "auto")};
  height: ${() => (flags["active"] ? "100dvh" : "auto")};
`;

const _ArrayRest = styled.div`
  height: ${(properties) => (properties.items[1].active ? "100vh" : "auto")};
  height: ${({ items: [_first, ...rest] }) => (rest[0].active ? "100dvh" : "auto")};
`;

const _CookedTemplate = styled.div`
  height: ${(properties) => (`${properties.mode}\x61`.length > 0 ? "100vh" : "auto")};
  height: ${(state) => (`${state.mode}a`.length > 0 ? "100dvh" : "auto")};
`;
