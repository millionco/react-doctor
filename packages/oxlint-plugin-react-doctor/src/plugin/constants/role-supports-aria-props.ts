// GENERATED - do not edit by hand.
// Mirrors OXC's `is_valid_aria_property_for_role` table from
// `oxc_linter::rules::jsx_a11y::role_supports_aria_props`.

interface RolePropsGroup {
  readonly roles: ReadonlyArray<string>;
  readonly props: string;
}

const ROLE_PROP_GROUPS: ReadonlyArray<RolePropsGroup> = [
  {
    roles: [
      "alert",
      "alertdialog",
      "banner",
      "blockquote",
      "command",
      "complementary",
      "dialog",
      "window",
    ],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-modal aria-owns aria-relevant aria-roledescription",
  },
  {
    roles: ["application"],
    props:
      "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription",
  },
  {
    roles: ["article"],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-setsize",
  },
  {
    roles: ["button"],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-pressed aria-relevant aria-roledescription",
  },
  {
    roles: ["caption", "cell", "code", "deletion", "emphasis", "generic"],
    props:
      "aria-atomic aria-busy aria-colindex aria-colspan aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-rowindex aria-rowspan",
  },
  {
    roles: ["checkbox", "switch"],
    props:
      "aria-atomic aria-busy aria-checked aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-required aria-roledescription",
  },
  {
    roles: ["columnheader", "rowheader"],
    props:
      "aria-atomic aria-busy aria-colindex aria-colspan aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-required aria-roledescription aria-rowindex aria-rowspan aria-selected aria-sort",
  },
  {
    roles: ["combobox"],
    props:
      "aria-activedescendant aria-atomic aria-autocomplete aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-required aria-roledescription",
  },
  {
    roles: ["composite", "group"],
    props:
      "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription",
  },
  {
    roles: [
      "contentinfo",
      "definition",
      "directory",
      "document",
      "feed",
      "figure",
      "form",
      "img",
      "landmark",
      "list",
      "log",
      "main",
      "marquee",
      "math",
      "navigation",
      "note",
      "region",
      "roletype",
      "rowgroup",
      "search",
      "section",
      "sectionhead",
      "status",
      "structure",
      "tabpanel",
      "term",
      "time",
      "timer",
      "tooltip",
      "widget",
    ],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription",
  },
  {
    roles: ["grid"],
    props:
      "aria-activedescendant aria-atomic aria-busy aria-colcount aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-rowcount",
  },
  {
    roles: ["gridcell"],
    props:
      "aria-atomic aria-busy aria-colindex aria-colspan aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-required aria-roledescription aria-rowindex aria-rowspan aria-selected",
  },
  {
    roles: ["heading"],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-owns aria-relevant aria-roledescription",
  },
  {
    roles: ["input"],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription",
  },
  {
    roles: ["insertion", "link", "paragraph", "presentation", "strong", "subscript", "superscript"],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription",
  },
  {
    roles: ["listbox"],
    props:
      "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-required aria-roledescription",
  },
  {
    roles: ["listitem"],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-posinset aria-owns aria-relevant aria-roledescription aria-setsize",
  },
  {
    roles: ["mark"],
    props:
      "aria-atomic aria-braillelabel aria-brailleroledescription aria-busy aria-controls aria-current aria-describedby aria-description aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription",
  },
  {
    roles: ["menu", "menubar", "select", "toolbar"],
    props:
      "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-roledescription",
  },
  {
    roles: ["menuitem"],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-setsize",
  },
  {
    roles: ["menuitemcheckbox", "menuitemradio"],
    props:
      "aria-atomic aria-busy aria-checked aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-relevant aria-required aria-roledescription aria-setsize",
  },
  {
    roles: ["meter", "progressbar"],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-valuemax aria-valuemin aria-valuenow aria-valuetext",
  },
  {
    roles: ["option"],
    props:
      "aria-atomic aria-busy aria-checked aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-selected aria-setsize",
  },
  {
    roles: ["radio"],
    props:
      "aria-atomic aria-busy aria-checked aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-setsize",
  },
  {
    roles: ["radiogroup", "tree"],
    props:
      "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-flowto aria-grabbed aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-required aria-roledescription",
  },
  {
    roles: ["range"],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-valuemax aria-valuemin aria-valuenow",
  },
  {
    roles: ["row"],
    props:
      "aria-activedescendant aria-atomic aria-busy aria-colindex aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-rowindex aria-selected aria-setsize",
  },
  {
    roles: ["scrollbar", "separator"],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-roledescription aria-valuemax aria-valuemin aria-valuenow aria-valuetext",
  },
  {
    roles: ["searchbox", "textbox"],
    props:
      "aria-activedescendant aria-atomic aria-autocomplete aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-multiline aria-owns aria-placeholder aria-relevant aria-required aria-roledescription",
  },
  {
    roles: ["slider"],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-roledescription aria-valuemin aria-valuemax aria-valuenow aria-valuetext",
  },
  {
    roles: ["spinbutton"],
    props:
      "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-flowto aria-grabbed aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-required aria-roledescription aria-valuemax aria-valuemin aria-valuenow aria-valuetext",
  },
  {
    roles: ["tab"],
    props:
      "aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-selected aria-setsize",
  },
  {
    roles: ["table"],
    props:
      "aria-atomic aria-busy aria-colcount aria-controls aria-current aria-describedby aria-details aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription aria-rowcount",
  },
  {
    roles: ["tablist"],
    props:
      "aria-activedescendant aria-atomic aria-busy aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-orientation aria-owns aria-relevant aria-roledescription",
  },
  {
    roles: ["treegrid"],
    props:
      "aria-activedescendant aria-atomic aria-busy aria-colcount aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-flowto aria-grabbed aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-live aria-orientation aria-owns aria-relevant aria-required aria-roledescription aria-rowcount",
  },
  {
    roles: ["treeitem"],
    props:
      "aria-atomic aria-busy aria-checked aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-owns aria-posinset aria-relevant aria-roledescription aria-selected aria-setsize",
  },
];

const toSet = (props: string): ReadonlySet<string> => new Set(props.split(" "));

const buildRoleSupportsAriaProps = (): Record<string, ReadonlySet<string>> => {
  const roleSupportsAriaProps: Record<string, ReadonlySet<string>> = {};
  for (const group of ROLE_PROP_GROUPS) {
    const supportedProps = toSet(group.props);
    for (const role of group.roles) {
      roleSupportsAriaProps[role] = supportedProps;
    }
  }
  return roleSupportsAriaProps;
};

export const ROLE_SUPPORTS_ARIA_PROPS: Record<
  string,
  ReadonlySet<string>
> = buildRoleSupportsAriaProps();
