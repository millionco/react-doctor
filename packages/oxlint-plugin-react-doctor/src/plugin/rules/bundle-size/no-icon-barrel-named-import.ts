import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Curated allowlist of monolithic icon-barrel packages whose bare index
// re-exports every icon. Only the EXACT source is flagged — any deeper
// subpath (`@mui/icons-material/Download`) is the correct form.
const ICON_BARREL_PACKAGES = new Set([
  "@mui/icons-material",
  "@material-ui/icons",
  "@ant-design/icons",
]);

// The deep single-icon import is never worse than the named-barrel form
// and is universally safe across bundlers, so we recommend it even where
// tree-shaking already handles the cost.
export const noIconBarrelNamedImport = defineRule({
  id: "no-icon-barrel-named-import",
  title: "Named import from an icon barrel",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Import the single icon from its deep path (`import Download from '@mui/icons-material/Download'`), which is smaller and safe across every bundler.",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.importKind === "type") return;
      const source = node.source?.value;
      if (typeof source !== "string" || !ICON_BARREL_PACKAGES.has(source)) return;

      const runtimeNamedIcons: string[] = [];
      let hasNamespaceImport = false;
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") {
          hasNamespaceImport = true;
          continue;
        }
        if (specifier.type !== "ImportSpecifier") continue;
        if (specifier.importKind === "type") continue;
        const imported = specifier.imported;
        if (isNodeOfType(imported, "Identifier")) {
          runtimeNamedIcons.push(imported.name);
        } else if (isNodeOfType(imported, "Literal") && typeof imported.value === "string") {
          runtimeNamedIcons.push(imported.value);
        }
      }

      if (runtimeNamedIcons.length === 0 && !hasNamespaceImport) return;

      const exampleIcon = runtimeNamedIcons[0] ?? "Download";
      context.report({
        node,
        message: `This pulls the whole "${source}" icon barrel into your build and, without perfect tree-shaking, ships unused icons. Import the single icon directly: \`import ${exampleIcon} from '${source}/${exampleIcon}'\`.`,
      });
    },
  }),
});
