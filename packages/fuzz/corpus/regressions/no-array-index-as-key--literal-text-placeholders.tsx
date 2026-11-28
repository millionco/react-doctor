// rule: no-array-index-as-key
// verdict: pass
// weakness: control-flow
// source: synthetic interleaved text placeholders from a closed literal table

const messages = ["Badge: [[mark]].", "[[mark]], thank you for welcoming [[mark]]."];

function Badge({ children, tone }: { children: string; tone?: string }) {
  return <i style={{ color: tone ?? "gray" }}>{children}</i>;
}

export function Banner() {
  const text = messages[Math.floor(Math.random() * messages.length)];
  return text
    .split("[[mark]]")
    .flatMap((chunk, index) => [
      chunk,
      <Badge tone="tomato" key={index}>
        Ready
      </Badge>,
    ])
    .slice(0, -1);
}
