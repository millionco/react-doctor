// rule: effect-remove-listener-inline-handler
// weakness: library-idiom
// source: PR #1000 deep adversarial audit
export const powerDown = (device: { off: (mode: string, done: () => void) => void }) => {
  device.off("power", () => reportPoweredDown());
};
