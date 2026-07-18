const ACCESSIBLE_NAME_PROPERTIES: ReadonlySet<string> = new Set([
  "aria-braillelabel",
  "aria-label",
  "aria-labelledby",
]);

export const PROHIBITED_ARIA_PROPERTIES_BY_ROLE: Readonly<Record<string, ReadonlySet<string>>> = {
  caption: ACCESSIBLE_NAME_PROPERTIES,
  code: ACCESSIBLE_NAME_PROPERTIES,
  definition: ACCESSIBLE_NAME_PROPERTIES,
  deletion: ACCESSIBLE_NAME_PROPERTIES,
  emphasis: ACCESSIBLE_NAME_PROPERTIES,
  generic: new Set([
    "aria-braillelabel",
    "aria-brailleroledescription",
    "aria-label",
    "aria-labelledby",
    "aria-roledescription",
  ]),
  insertion: ACCESSIBLE_NAME_PROPERTIES,
  mark: ACCESSIBLE_NAME_PROPERTIES,
  none: ACCESSIBLE_NAME_PROPERTIES,
  paragraph: ACCESSIBLE_NAME_PROPERTIES,
  presentation: ACCESSIBLE_NAME_PROPERTIES,
  strong: ACCESSIBLE_NAME_PROPERTIES,
  subscript: ACCESSIBLE_NAME_PROPERTIES,
  superscript: ACCESSIBLE_NAME_PROPERTIES,
  term: ACCESSIBLE_NAME_PROPERTIES,
  time: ACCESSIBLE_NAME_PROPERTIES,
  tooltip: ACCESSIBLE_NAME_PROPERTIES,
};
