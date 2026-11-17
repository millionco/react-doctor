// rule: postmessage-origin-risk
// weakness: name-heuristic
// source: Synthetic erased-only require binding with native SockJS receiver
// verdict: pass
interface require {
  note: string;
}
const SockJS = require("sockjs-client");
const connection = new SockJS("/stream");
connection.onmessage = (event) => consume(event.data);
