// rule: no-array-index-as-key
// weakness: ast-shape
// source: cross-rule consistency audit (Irev-Dev/cadhub IdeConsole, ant-design ColorPresets)
export const ConsoleMessages = ({ messages }: { messages: { message: string; time: Date }[] }) => (
  <div>
    {messages.map(({ message, time }, index) => (
      <Entry key={`${message} ${index}`} time={time} />
    ))}
  </div>
);
export const ColorSwatches = ({ colors }: { colors: { toHexString: () => string }[] }) => (
  <div>
    {colors.map((presetColor, index) => (
      <Swatch key={`preset-${index}-${presetColor.toHexString()}`} />
    ))}
  </div>
);
export const SliderThumbs = ({ values }: { values: number[] }) => (
  <div>
    {Array.from({ length: values.length }, (_, index) => (
      <Swatch key={index} />
    ))}
  </div>
);
export const PlaygroundGrid = ({ count }: { count: number }) => {
  const cols = [];
  for (let i = 0; i < count; i++) {
    cols.push(<Swatch key={i} />);
  }
  return <div>{cols}</div>;
};
declare const Entry: (props: { key?: string; time: Date }) => null;
declare const Swatch: (props: { key?: string }) => null;
