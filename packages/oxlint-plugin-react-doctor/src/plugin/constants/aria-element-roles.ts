// Ported verbatim from oxc_linter::utils::react::ELEMENT_ROLE_MAP.
// Maps HTML element names to their implicit WAI-ARIA roles.
// Some elements have multiple implicit roles depending on attributes
// (e.g. <input> varies by `type`); both appear here so callers that
// need a single role have to pick.

const ELEMENT_ROLE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["a", "link"],
  ["address", "group"],
  ["area", "link"],
  ["article", "article"],
  ["aside", "complementary"],
  ["blockquote", "blockquote"],
  ["button", "button"],
  ["caption", "caption"],
  ["code", "code"],
  ["datalist", "listbox"],
  ["del", "deletion"],
  ["details", "group"],
  ["dfn", "term"],
  ["dialog", "dialog"],
  ["em", "emphasis"],
  ["fieldset", "group"],
  ["figure", "figure"],
  ["footer", "contentinfo"],
  ["form", "form"],
  ["h1", "heading"],
  ["h2", "heading"],
  ["h3", "heading"],
  ["h4", "heading"],
  ["h5", "heading"],
  ["h6", "heading"],
  ["header", "banner"],
  ["hgroup", "group"],
  ["hr", "separator"],
  ["img", "img"],
  ["img", "image"],
  ["input", "checkbox"],
  ["input", "combobox"],
  ["input", "radio"],
  ["input", "searchbox"],
  ["input", "slider"],
  ["input", "spinbutton"],
  ["input", "textbox"],
  ["ins", "insertion"],
  ["li", "listitem"],
  ["main", "main"],
  ["math", "math"],
  ["menu", "list"],
  ["meter", "meter"],
  ["nav", "navigation"],
  ["ol", "list"],
  ["optgroup", "group"],
  ["option", "option"],
  ["output", "status"],
  ["p", "paragraph"],
  ["progress", "progressbar"],
  ["s", "deletion"],
  ["search", "search"],
  ["section", "region"],
  ["select", "combobox"],
  ["select", "listbox"],
  ["strong", "strong"],
  ["sub", "subscript"],
  ["sup", "superscript"],
  ["svg", "graphics-document"],
  ["table", "table"],
  ["tbody", "rowgroup"],
  ["td", "cell"],
  ["td", "gridcell"],
  ["textarea", "textbox"],
  ["tfoot", "rowgroup"],
  ["th", "columnheader"],
  ["th", "rowheader"],
  ["th", "gridcell"],
  ["thead", "rowgroup"],
  ["time", "time"],
  ["tr", "row"],
  ["ul", "list"],
];

const EMPTY_ROLE_LIST: ReadonlyArray<string> = [];

const buildLookup = (
  pairs: ReadonlyArray<readonly [string, string]>,
  keyIndex: 0 | 1,
): ReadonlyMap<string, ReadonlyArray<string>> => {
  const lookup = new Map<string, string[]>();
  for (const pair of pairs) {
    const key = pair[keyIndex];
    const value = pair[keyIndex === 0 ? 1 : 0];
    const values = lookup.get(key);
    if (!values) {
      lookup.set(key, [value]);
    } else if (!values.includes(value)) {
      values.push(value);
    }
  }
  return lookup;
};

const IMPLICIT_ROLES_BY_TAG = buildLookup(ELEMENT_ROLE_PAIRS, 0);
const TAGS_BY_ROLE = buildLookup(ELEMENT_ROLE_PAIRS, 1);

// Returns all implicit roles for `tag`. Empty array if tag has none.
export const getElementImplicitRoles = (tag: string): ReadonlyArray<string> =>
  IMPLICIT_ROLES_BY_TAG.get(tag) ?? EMPTY_ROLE_LIST;

// Reverse lookup: HTML elements that map to `role`.
export const getTagsForRole = (role: string): ReadonlyArray<string> =>
  TAGS_BY_ROLE.get(role) ?? EMPTY_ROLE_LIST;
