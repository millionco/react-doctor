// rule: postmessage-origin-risk
// weakness: library-idiom
// source: synthetic closed CommonJS server-stream receiver
// verdict: pass

const StreamClient = require("sockjs-client");
const connection = new StreamClient("/stream");
connection.onclose = () => consume("closed");
connection.onmessage = (event) => consume(event.data);
