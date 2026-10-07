// rule: nextjs-no-native-script
// verdict: fail
// weakness: static-string-normalization

export const WidgetScript = () => (
  <script type=" TEXT/JAVASCRIPT " src="https://widget.example.com/embed.js" />
);
