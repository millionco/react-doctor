// rule: no-unguarded-throwing-parse-call
// weakness: validation
// source: adversarial audit of PR parsing/string-safety group

export const readHost = (searchParams: URLSearchParams): string | null => {
  const target = searchParams.get("target");
  if (!target || !URL.canParse(target, "https://example.com")) return null;
  return new URL(target).host;
};
