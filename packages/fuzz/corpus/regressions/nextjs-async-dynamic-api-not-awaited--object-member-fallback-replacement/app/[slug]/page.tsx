// rule: nextjs-async-dynamic-api-not-awaited
// weakness: control-flow
// source: PR #1000 independent audit

export default async function Page(props) {
  try {
    props.params = await props.params;
  } catch {
    props.params = { slug: "fallback" };
  }
  return props.params.slug;
}
