import { titleCase } from "./title-case.ts";

interface SectionHeadingProps {
  text: string;
}

// Existing consumer (keeps title-case.ts reachable). Do not edit.
export const SectionHeading = ({ text }: SectionHeadingProps) => <h2>{titleCase(text)}</h2>;
