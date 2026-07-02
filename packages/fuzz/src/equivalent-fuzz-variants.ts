export interface EquivalentVariant {
  label: string;
  code: string;
}

// Semantics-preserving rewrites: a rule that reports differently on any of
// these variants is keying off incidental source shape (metamorphic oracle).
export const buildEquivalentFuzzVariants = (code: string): EquivalentVariant[] => [
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
