// rule: no-object-or-array-coerced-to-string-in-template-literal
// weakness: library-idiom
// source: Daytona parity PR #1402, D3 and CSV serialization

const coordinates = [10, 20];
const headers = ["time", "status", "logs"];
const body = "12:00,ok,ready";

export const transform = `translate(${coordinates})`;
export const csv = `${headers}\r\n${body}`;
