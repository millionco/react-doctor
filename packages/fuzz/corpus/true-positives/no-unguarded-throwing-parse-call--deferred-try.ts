// rule: no-unguarded-throwing-parse-call
// weakness: async-control-flow
// source: adversarial audit of PR parsing/string-safety group

try {
  Promise.resolve().then(() => decodeURIComponent(window.location.hash));
} catch {
  recover();
}
