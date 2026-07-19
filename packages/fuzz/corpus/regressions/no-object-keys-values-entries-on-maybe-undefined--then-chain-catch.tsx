// rule: no-object-keys-values-entries-on-maybe-undefined
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (medium blogs: the throwing read sits inside a .then whose chain ends in a .catch fallback)
export async function loadMediumPosts() {
  return fetch("/medium.json")
    .then((response) => response.json())
    .then((data) => {
      const posts = Object.values(data?.payload?.references?.Post);
      return posts.slice(0, 3);
    })
    .catch((error) => {
      console.error("Error fetching Medium data:", error);
      return [];
    });
}
