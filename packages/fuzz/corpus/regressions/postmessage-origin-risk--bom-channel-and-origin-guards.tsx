// rule: postmessage-origin-risk
// weakness: wrapper-transparency
// source: native parity audit of JavaScript BOM whitespace in channel and origin guards
// verdict: pass

// prettier-ignore
const stream = new﻿EventSource(url);
stream.onmessage = (event) => consume(event.data);

// prettier-ignore
const connect = (receiver:﻿Worker) => {
  receiver.onmessage = (event) => consume(event.data);
};

window.onmessage = (event) => {
  // prettier-ignore
  const﻿payload = event.data;
  if (event.origin !== window.location.origin) return;
  consume(payload);
};
