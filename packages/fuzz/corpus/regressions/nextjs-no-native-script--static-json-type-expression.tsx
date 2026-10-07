// rule: nextjs-no-native-script
// verdict: pass
// weakness: wrapper-transparency

export const StructuredData = () => (
  <script type={"application/ld+json"}>{JSON.stringify({ name: "React Doctor" })}</script>
);
