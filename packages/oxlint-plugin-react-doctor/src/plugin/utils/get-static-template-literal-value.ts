interface TemplateElementValueLike {
  readonly cooked?: string | null;
  readonly raw?: string | null;
}

interface TemplateElementLike {
  readonly value?: TemplateElementValueLike;
}

interface StaticTemplateLiteralLike {
  readonly expressions?: ReadonlyArray<unknown>;
  readonly quasis?: ReadonlyArray<TemplateElementLike>;
}

export const getStaticTemplateLiteralValue = (
  templateLiteral: StaticTemplateLiteralLike,
): string | null => {
  const expressions = templateLiteral.expressions ?? [];
  const quasis = templateLiteral.quasis ?? [];
  if (expressions.length !== 0 || quasis.length !== 1) return null;
  const value = quasis[0]?.value;
  return value?.cooked ?? value?.raw ?? null;
};
