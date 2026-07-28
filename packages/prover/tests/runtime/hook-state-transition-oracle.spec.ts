import { expect, test } from "@playwright/test";
import {
  HOOK_STATE_INCREMENT,
  HOOK_STATE_INITIAL_COUNT,
  STRICT_MODE_HOOK_UPDATER_RUNS,
} from "./constants.js";

test("Strict Mode invokes a Hook state updater twice while committing one transition", async ({
  page,
}) => {
  await page.goto("/?oracle=hook-state-transition");

  await page.getByRole("button", { name: "increment" }).click();

  await expect(page.getByTestId("hook-state-count")).toHaveText(
    String(HOOK_STATE_INITIAL_COUNT + HOOK_STATE_INCREMENT),
  );
  await expect
    .poll(() => page.evaluate(() => window.hookStateUpdaterRuns))
    .toBe(STRICT_MODE_HOOK_UPDATER_RUNS);
  await expect(page.getByTestId("expected-hook-state-updater-runs")).toHaveText(
    String(STRICT_MODE_HOOK_UPDATER_RUNS),
  );
});
