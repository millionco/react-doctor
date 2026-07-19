// rule: no-fetch-response-used-without-status-check
// source: react-bench corpus audit 2026-07
export function loadTitle(endpoint: string, setEmbedTitle: (title: string) => void) {
  fetch(endpoint)
    .then((response) => response.json())
    .then((data) => {
      if (typeof data.title === "string") setEmbedTitle(data.title);
    })
    .catch(() => {});
}
