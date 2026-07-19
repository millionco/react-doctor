// rule: nextjs-async-dynamic-api-not-awaited
// source: PR #1000 independent audit

export default function Page(props, condition) {
  props.params = condition ? props.params : { slug: "fallback" };
  return props.params.slug;
}
