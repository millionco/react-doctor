// rule: no-array-index-as-key
// verdict: pass
// weakness: alias-guard
// source: synthetic selected-28 single-local-render-helper

interface TextProps {
  text: string;
  pattern?: RegExp | null;
}
export const HighlightedLabel = (props: TextProps) => {
  const renderText = () => {
    const { pattern } = props;
    if (pattern) {
      return props.text
        .split(pattern)
        .map((segment, index) => (segment.match(pattern) ? <b key={index}>{segment}</b> : segment));
    }
    return props.text;
  };
  return <div>{renderText()}</div>;
};
