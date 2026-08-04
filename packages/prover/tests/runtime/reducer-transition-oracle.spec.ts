import { expect, test } from "@playwright/test";
import { REDUCER_INITIAL_COUNT, REDUCER_INCREMENT, STRICT_MODE_REDUCER_RUNS } from "./constants.js";

test("Strict Mode replays a pure reducer and lazy initializer without changing the committed state", async ({
  page,
}) => {
  await page.goto("/?oracle=reducer-transition");

  await expect
    .poll(() => page.evaluate(() => window.reducerInitializerRuns))
    .toBe(STRICT_MODE_REDUCER_RUNS);
  await page.getByRole("button", { name: "run reducer" }).click();

  await expect(page.getByTestId("reducer-count")).toHaveText(
    String(REDUCER_INITIAL_COUNT + REDUCER_INCREMENT),
  );
  await expect.poll(() => page.evaluate(() => window.reducerRuns)).toBe(STRICT_MODE_REDUCER_RUNS);
  await expect(page.getByTestId("expected-reducer-runs")).toHaveText(
    String(STRICT_MODE_REDUCER_RUNS),
  );
});
