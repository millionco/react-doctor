// rule: postmessage-origin-risk
// verdict: pass
// weakness: scope-binding
// source: synthetic
const receive = (event) => {
  console.log(
    (() => {
      try {
        throw {};
      } catch ({ ignored = (event = { data: "local" }) }) {
        void ignored;
      }
    })(),
    event.data,
  );
};
window.addEventListener("message", receive);
