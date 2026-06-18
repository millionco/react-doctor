// OSC 8 terminal hyperlink: ESC ] 8 ; <params> ; <uri> ST  <text>  ESC ] 8 ; ; ST
// Terminals that support it render <text> as a clickable link to <uri>; every
// other terminal ignores the escape sequences and prints <text> unchanged, so
// emitting these is safe wherever the link cannot hurt (see supports-hyperlinks).
// OSC = Operating System Command introducer (ESC ]); ST = String Terminator (ESC \\).
const OSC = "\u001B]";
const ST = "\u001B\\";

/**
 * Wraps `text` in an OSC 8 hyperlink pointing at `uri`. The visible characters
 * are exactly `text`; the link is carried in escape sequences a capable
 * terminal turns into a click target.
 */
export const formatHyperlink = (text: string, uri: string): string =>
  `${OSC}8;;${uri}${ST}${text}${OSC}8;;${ST}`;
