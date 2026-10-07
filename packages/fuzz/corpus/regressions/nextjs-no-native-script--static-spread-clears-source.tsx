// rule: nextjs-no-native-script
// verdict: pass
// weakness: spread-order

export const RemovedWidgetScript = () => (
  <script src="https://widget.example.com/embed.js" {...{ src: null }} />
);
