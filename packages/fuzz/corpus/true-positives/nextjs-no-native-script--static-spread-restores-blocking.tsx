// rule: nextjs-no-native-script
// verdict: fail
// weakness: spread-order

export const WidgetScript = () => (
  <script async src="https://widget.example.com/embed.js" {...{ async: false }} />
);
