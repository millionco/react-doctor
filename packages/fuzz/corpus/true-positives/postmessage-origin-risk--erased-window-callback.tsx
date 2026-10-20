// rule: postmessage-origin-risk
// weakness: name-heuristic
// source: Synthetic erased-only window and callback bindings
// verdict: fail
interface window {
  note: string;
}
interface receive {
  note: string;
}
const receive = (event) => consume(event.data);
window.addEventListener("message", receive);
