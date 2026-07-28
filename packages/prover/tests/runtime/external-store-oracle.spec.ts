import { expect, test } from "@playwright/test";

test("confirms that a fresh external-store snapshot triggers React's cache invariant", async ({
  page,
}) => {
  const runtimeMessages: string[] = [];
  page.on("console", (message) => runtimeMessages.push(message.text()));
  page.on("pageerror", (error) => runtimeMessages.push(error.message));

  await page.goto("/?oracle=external-store&mode=fresh");

  await expect
    .poll(() => runtimeMessages.join("\n"))
    .toMatch(/getSnapshot should be cached|Maximum update depth/);
});

test("confirms that a cached external-store snapshot remains stable", async ({ page }) => {
  const runtimeMessages: string[] = [];
  page.on("console", (message) => runtimeMessages.push(message.text()));
  page.on("pageerror", (error) => runtimeMessages.push(error.message));

  await page.goto("/?oracle=external-store&mode=safe");

  await expect(page.getByTestId("connection")).toHaveText("online");
  expect(runtimeMessages.join("\n")).not.toMatch(
    /getSnapshot should be cached|Maximum update depth/,
  );
});

test("switches between independently correlated external-store render branches", async ({
  page,
}) => {
  await page.goto("/?oracle=external-store-branches");

  await expect(page.getByTestId("store-version")).toHaveText("0");
  await page.getByRole("button", { name: "update primary" }).click();
  await expect(page.getByTestId("store-version")).toHaveText("1");
  await page.getByRole("button", { name: "switch store" }).click();
  await expect(page.getByTestId("store-version")).toHaveText("100");
  await page.getByRole("button", { name: "update primary" }).click();
  await expect(page.getByTestId("store-version")).toHaveText("100");
  await page.getByRole("button", { name: "update secondary" }).click();
  await expect(page.getByTestId("store-version")).toHaveText("101");
});

test("switches callback channels selected by one intra-attribute guard", async ({ page }) => {
  await page.goto("/?oracle=external-store-conditional");

  await expect(page.getByTestId("store-version")).toHaveText("0");
  await page.getByRole("button", { name: "update primary" }).click();
  await expect(page.getByTestId("store-version")).toHaveText("1");
  await page.getByRole("button", { name: "switch store" }).click();
  await expect(page.getByTestId("store-version")).toHaveText("100");
  await page.getByRole("button", { name: "update primary" }).click();
  await expect(page.getByTestId("store-version")).toHaveText("100");
  await page.getByRole("button", { name: "update secondary" }).click();
  await expect(page.getByTestId("store-version")).toHaveText("101");
});
