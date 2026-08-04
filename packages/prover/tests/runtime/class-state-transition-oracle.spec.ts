import { expect, test } from "@playwright/test";

test("a prop-history guard converges after one class state write", async ({ page }) => {
  await page.goto("/?oracle=class-state-transition&mode=guarded");
  await page.getByRole("button", { name: "update class prop" }).click();

  await expect(page.getByTestId("class-draft")).toHaveText("beta");
  await expect.poll(() => page.evaluate(() => window.classStateWrites)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.classStateUpdates)).toBe(2);
});

test("an unguarded componentDidUpdate state write reaches React's update-depth failure", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?oracle=class-state-transition&mode=loop");
  await page.getByRole("button", { name: "trigger class loop" }).click();

  await expect
    .poll(() => errors.some((error) => error.includes("Maximum update depth")))
    .toBe(true);
});
