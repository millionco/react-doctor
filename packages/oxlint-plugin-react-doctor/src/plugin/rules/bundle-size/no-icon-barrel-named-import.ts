import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Curated allowlist of monolithic icon-barrel packages whose bare index
// re-exports every icon. Only the EXACT source is flagged — any deeper
// subpath (`@mui/icons-material/Download`) is the correct form.
const ICON_BARREL_PACKAGES = new Set([
  "@mui/icons-material",
  "@material-ui/icons",
  "@ant-design/icons",
]);

// Named imports from these barrels are tree-shaken by every modern bundler
// (the packages ship sideEffects:false ESM) and rewritten outright by
// Next.js >= 13.5 optimizePackageImports, so only the namespace forms —
// which materialize the whole barrel as one object — are flagged, and the
// rule is disabled entirely on Next.js projects.
export const noIconBarrelNamedImport = defineRule({
  id: "no-icon-barrel-named-import",
  title: "Namespace import of an icon barrel",
  tags: ["test-noise"],
  severity: "warn",
  disabledBy: ["nextjs"],
  recommendation:
    "Import each icon from its deep path (`import Download from '@mui/icons-material/Download'`) instead of materializing the whole barrel as a namespace object.",
  create: (context: RuleContext) => {
    const reportBarrelNamespace = (
      node: EsTreeNodeOfType<"ImportDeclaration"> | EsTreeNodeOfType<"ExportAllDeclaration">,
      source: string,
    ) => {
      context.report({
        node,
        message: `This namespace form pulls the whole "${source}" icon barrel into your build — bundlers cannot drop icons reached through a namespace object. Import each icon from its deep path instead: \`import Download from '${source}/Download'\`.`,
      });
    };

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (node.importKind === "type") return;
        const source = node.source?.value;
        if (typeof source !== "string" || !ICON_BARREL_PACKAGES.has(source)) return;
        const hasNamespaceImport = node.specifiers.some(
          (specifier) => specifier.type === "ImportNamespaceSpecifier",
        );
        if (!hasNamespaceImport) return;
        reportBarrelNamespace(node, source);
      },
      ExportAllDeclaration(node: EsTreeNodeOfType<"ExportAllDeclaration">) {
        if (node.exportKind === "type") return;
        if (!node.exported) return;
        const source = node.source?.value;
        if (typeof source !== "string" || !ICON_BARREL_PACKAGES.has(source)) return;
        reportBarrelNamespace(node, source);
      },
    };
  },
});
