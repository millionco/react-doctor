// rule: no-fetch-response-used-without-status-check
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (oEmbed title: the consuming chain validates the shape and ends in a deliberate .catch swallow)
export function loadTitle(endpoint: string, setEmbedTitle: (title: string) => void) {
  fetch(endpoint)
    .then((r) => r.json())
    .then((data) => {
      if (typeof data.title === "string") setEmbedTitle(data.title);
    })
    .catch(() => {});
}
