// rule: postmessage-origin-risk
// verdict: pass
// weakness: alias-guard
// source: synthetic
const senderAllowed = (message) => message.origin === "https://trusted.example";
const receive = (event) => {
  if (!senderAllowed(event)) return;
  console.log(event.data);
};
window.addEventListener("message", receive);
