// rule: no-fetch-response-used-without-status-check
// weakness: library-idiom
// source: react-bench corpus audit 2026-07 (cboard help text: fetching a bundler-emitted require(...) asset URL of the app's own bundle)
export function loadHelpText(lang: string, setMarkdown: (text: string) => void) {
  let markdownPath = "";
  try {
    markdownPath = require(`../translations/${lang}.md`);
  } catch {
    markdownPath = require("../translations/en-US.md");
  }
  fetch(markdownPath)
    .then((response) => response.text())
    .then((text) => setMarkdown(text));
}
