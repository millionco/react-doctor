// rule: no-global-css-variable-animation
// source: PR #1337 fuzz verdict-drop

requestAnimationFrame(() => {
  (document.documentElement.style as any).setProperty("--scroll", String(window.scrollY));
  document.body.style!.setProperty("--progress", String(window.scrollY));
});
