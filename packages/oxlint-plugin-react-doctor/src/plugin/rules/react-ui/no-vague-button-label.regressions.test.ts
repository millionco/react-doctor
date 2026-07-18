import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noVagueButtonLabel } from "./no-vague-button-label.js";

const run = (code: string) => runRule(noVagueButtonLabel, code, { filename: "fixture.tsx" });

describe("react-ui/no-vague-button-label — regressions", () => {
  it("allows Continue in a form with explicit previous-step navigation", () => {
    const result = run(
      `const StepAddons = () => <form><div><Link as="button" to="/previous">Back</Link></div><Button type="submit">Continue</Button></form>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("finds previous-step navigation inside a fragment", () => {
    const result = run(
      `const StepAddons = () => <form><><button type="button">Back</button></><button type="submit">Continue</button></form>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports Continue without proven wizard context", () => {
    const result = run(`const Dialog = () => <Button>Continue</Button>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports other vague labels in forms", () => {
    const result = run(
      `const Form = () => <form><button>Back</button><button>Submit</button></form>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
