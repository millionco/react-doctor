export const debugLog = (message: string) => console.log(message);

export const triggerWith = (event: string, payload: number) => fireEvent(event, payload);

export const variadicWrap = (...args: unknown[]) => downstream(...args);

export const callOnly = () => bootstrap();

export const legitWrap = (input: string) => transform(input.toUpperCase());

export const legitExtra = (input: string) => transform(input, "extra");

export const legitDifferentOrder = (a: number, b: number) => fn(b, a);

const fireEvent = (event: string, payload: number) => `${event}:${payload}`;
const downstream = (...args: unknown[]) => args.length;
const bootstrap = () => "ready";
const transform = (..._args: unknown[]) => "done";
const fn = (..._args: unknown[]) => 0;

console.log(
  debugLog("ok"),
  triggerWith("e", 1),
  variadicWrap(1, 2),
  callOnly(),
  legitWrap("hi"),
  legitExtra("yo"),
  legitDifferentOrder(1, 2),
);
