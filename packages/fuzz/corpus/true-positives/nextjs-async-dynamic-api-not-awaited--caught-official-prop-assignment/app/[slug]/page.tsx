// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 final audit

declare const getSafeOrThrow: () => { slug: string };

export default function Page(props: { params: Promise<{ slug: string }> }) {
  const read = () => {
    try {
      props.params = getSafeOrThrow();
    } catch {}
    return props.params.slug;
  };
  return read();
}
