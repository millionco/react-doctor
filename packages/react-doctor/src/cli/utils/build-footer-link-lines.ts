import { CANONICAL_GITHUB_URL, DOCS_URL, highlighter } from "@react-doctor/core";
import { buildFooterDescriptionLines } from "./build-footer-description-lines.js";

export interface BuildFooterLinkLinesInput {
  readonly shareUrl: string | null;
}

export const buildFooterLinkLines = ({ shareUrl }: BuildFooterLinkLinesInput): string[] => [
  ...(shareUrl === null
    ? []
    : [
        `  ${highlighter.bold("Share:")} ${highlighter.info(shareUrl)}`,
        ...buildFooterDescriptionLines("Tell others how you did on socials"),
        "",
      ]),
  `  ${highlighter.bold("Docs:")} ${highlighter.info(DOCS_URL)}`,
  ...buildFooterDescriptionLines(
    "Learn more about fixing issues, setting up CI/CD, and configuring rules with a config file",
  ),
  "",
  `  ${highlighter.bold("GitHub:")} ${highlighter.info(CANONICAL_GITHUB_URL)}`,
  ...buildFooterDescriptionLines("Report issues and star the repository!"),
];
