// rule: no-array-index-as-key
// verdict: safe
export const Skeleton = ({ count, Wrapper }) => {
  const elements = [];
  for (let slot = 0; slot < count; slot++) {
    const placeholder = <span key={slot}>...</span>;
    elements.push(placeholder);
  }
  return elements.map((element, index) => <Wrapper key={index}>{element}</Wrapper>);
};
