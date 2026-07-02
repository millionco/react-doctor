export interface EquivalentVariant {
  label: string;
  code: string;
}

// Semantics-preserving rewrites: a rule that reports differently on any of
// these variants is keying off incidental source shape (metamorphic oracle).
// Section-aware variants splice only BETWEEN top-level sections — inserting
// into arbitrary line positions could land inside a template literal or JSX
// text and change program semantics, producing false findings.
export const buildEquivalentFuzzVariants = (
  code: string,
  sections?: ReadonlyArray<string>,
): EquivalentVariant[] => {
  const variants: EquivalentVariant[] = [
    {
      label: "leading block comment",
      code: `/* metamorphic leading comment */\n${code}`,
    },
    {
      label: "trailing unused declaration",
      code: `${code}\nconst __reactDoctorFuzzUnused__ = 0;\nvoid __reactDoctorFuzzUnused__;\n`,
    },
    {
      label: "trailing line comment",
      code: `${code}// metamorphic trailing comment\n`,
    },
  ];
  if (sections !== undefined && sections.length > 1) {
    variants.push(
      {
        label: "comments between sections",
        code: `${sections.join("\n\n// metamorphic separator\n\n")}\n`,
      },
      {
        label: "extra blank lines between sections",
        code: `${sections.join("\n\n\n\n")}\n`,
      },
      {
        label: "block comments between sections",
        code: `${sections.join("\n\n/* metamorphic\n   separator */\n\n")}\n`,
      },
    );
  }
  return variants;
};
