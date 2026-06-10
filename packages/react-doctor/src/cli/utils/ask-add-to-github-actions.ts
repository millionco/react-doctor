import { GITHUB_ACTIONS_SETUP_URL, highlighter } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import { CI_TRUST_COMPANIES } from "./constants.js";
import { openUrl } from "./open-url.js";
import { prompts } from "./prompts.js";

const CI_YES_CHOICE = "ci-yes";
const CI_LEARN_MORE_CHOICE = "ci-learn-more";
const CI_NO_CHOICE = "ci-no";

// `\x1b[22m` (SGR "bold off") cancels the bold the `prompts` `select` renderer
// wraps every message in (`select.js`: `color.bold(this.msg)`), so the question
// stays bold while the indented pitch lines render in normal weight (and dim,
// for the social-proof tagline) — matching the intended two-line emphasis.
const SGR_BOLD_OFF = "\x1b[22m";

// The pitch (incremental backlog + social proof) lives as part of the `message`
// text, indented under the question itself so the value is visually attached to
// the action it justifies. `hint: " "` (single space — `""` re-triggers the
// library's verbose fallback) keeps the trailing ` ›` quietly on the last pitch
// line instead of a "Use arrow-keys…" row that reads as broken UI.
const ciQuestionMessage = [
  "Add React Doctor to GitHub Actions?",
  `${SGR_BOLD_OFF}  ${highlighter.dim("Scan every pull request to prevent new React issues while you fix the backlog.")}`,
  `${SGR_BOLD_OFF}  ${highlighter.dim(`Used by teams at ${CI_TRUST_COMPANIES}.`)}`,
].join("\n");

export type CiPromptOutcome = "yes" | "no" | "cancel";

// The single canonical "Add React Doctor to GitHub Actions?" pitch, shared by
// the `install` onboarding and the post-scan agent handoff so both surfaces ask
// it identically. "Learn more" opens the docs in the user's default browser via
// `openUrl` and re-prompts, so the user can decide after reading without
// restarting the CLI. Cancel (Esc / Ctrl-C) maps to "cancel" so a stray
// keypress never accidentally installs workflow files. The `prompt` arg is
// injectable for tests; production callers use the default real prompt.
export const askAddToGitHubActions = async (
  prompt: typeof prompts = prompts,
): Promise<CiPromptOutcome> => {
  while (true) {
    const { ciChoice } = await prompt<"ciChoice">(
      {
        type: "select",
        name: "ciChoice",
        message: ciQuestionMessage,
        hint: " ",
        choices: [
          {
            title: "Yes",
            description: "Adds the workflow file and a doctor package script",
            value: CI_YES_CHOICE,
          },
          {
            title: "Learn more",
            description: "Opens the docs page in your browser",
            value: CI_LEARN_MORE_CHOICE,
          },
          {
            title: "No",
            description: "Skip for now",
            value: CI_NO_CHOICE,
          },
        ],
        initial: 0,
      },
      { onCancel: () => true },
    );

    if (ciChoice === undefined) return "cancel";
    if (ciChoice === CI_YES_CHOICE) return "yes";
    if (ciChoice === CI_NO_CHOICE) return "no";

    // CI_LEARN_MORE_CHOICE: open the docs and loop back to the question.
    const opened = openUrl(GITHUB_ACTIONS_SETUP_URL);
    logger.log(
      opened
        ? `Opened ${highlighter.info(GITHUB_ACTIONS_SETUP_URL)} in your browser.`
        : `Visit ${highlighter.info(GITHUB_ACTIONS_SETUP_URL)} to learn more.`,
    );
    logger.break();
  }
};
