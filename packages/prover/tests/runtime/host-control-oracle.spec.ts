import { expect, test } from "@playwright/test";

test("an exact controlled input update preserves the typed DOM value", async ({ page }) => {
  await page.goto("/?oracle=host-control&mode=exact");

  const input = page.getByRole("textbox", { name: "profile name" });
  await input.fill("Ada");
  await expect(input).toHaveValue("Ada");
  await expect(page.getByTestId("host-control-value")).toHaveText("Ada");
});

test("a nullish-to-defined value transition produces React's ownership warning", async ({
  page,
}) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    consoleMessages.push(message.text());
  });
  await page.goto("/?oracle=host-control&mode=switch");

  await page.getByRole("button", { name: "load profile" }).click();
  await expect(page.getByRole("textbox", { name: "profile name" })).toHaveValue("Ada");
  await expect
    .poll(() => consoleMessages.join("\n"))
    .toContain("changing an uncontrolled input to be controlled");
});
