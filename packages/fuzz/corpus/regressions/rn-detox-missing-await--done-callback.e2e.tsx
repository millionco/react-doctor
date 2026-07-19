// rule: rn-detox-missing-await
// weakness: framework-gating
// source: Daytona parity PR #1402, wix/Detox

it("handles a done callback", (done) => {
  expect(element(by.text("Welcome")))
    .toBeVisible()
    .then(() => {
      setTimeout(() => done(), 1000);
    });
});
