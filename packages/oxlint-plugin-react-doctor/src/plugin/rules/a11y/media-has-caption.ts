import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  'Deaf and hard-of-hearing users need captions for this media. Add a `<track kind="captions">` inside the `<audio>` or `<video>`.';

const DEFAULT_AUDIO: ReadonlyArray<string> = ["audio"];
const DEFAULT_VIDEO: ReadonlyArray<string> = ["video"];
const DEFAULT_TRACK: ReadonlyArray<string> = ["track"];

interface MediaHasCaptionSettings {
  audio?: ReadonlyArray<string>;
  video?: ReadonlyArray<string>;
  track?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): { audio: ReadonlyArray<string>; video: ReadonlyArray<string>; track: ReadonlyArray<string> } => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { mediaHasCaption?: MediaHasCaptionSettings }).mediaHasCaption ?? {})
      : {};
  return {
    audio: [...DEFAULT_AUDIO, ...(ruleSettings.audio ?? [])],
    video: [...DEFAULT_VIDEO, ...(ruleSettings.video ?? [])],
    track: [...DEFAULT_TRACK, ...(ruleSettings.track ?? [])],
  };
};

// Determine if `muted` is statically truthy: bare attr or
// `muted={true}` / `muted="true"`. Returns null when value is dynamic.
const evaluateMuted = (attribute: EsTreeNodeOfType<"JSXAttribute"> | undefined): boolean | null => {
  if (!attribute) return false;
  const value = attribute.value as EsTreeNode | null;
  if (!value) return true;
  if (isNodeOfType(value, "Literal") && typeof value.value === "string") {
    return value.value === "true";
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "boolean") {
      return expression.value;
    }
  }
  return false;
};

// Port of `oxc_linter::rules::jsx_a11y::media_has_caption`.
export const mediaHasCaption = defineRule<Rule>({
  id: "media-has-caption",
  title: "Media missing captions",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: 'Add `<track kind="captions">` inside every `<audio>` / `<video>`.',
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const tag = getElementType(node, context.settings);
        const isAudioOrVideo = settings.audio.includes(tag) || settings.video.includes(tag);
        if (!isAudioOrVideo) return;
        const mutedAttribute = hasJsxPropIgnoreCase(node.attributes, "muted");
        if (evaluateMuted(mutedAttribute) === true) return;

        const parent = (node as EsTreeNode).parent;
        if (!parent || !isNodeOfType(parent, "JSXElement")) {
          context.report({ node: node.name, message: MESSAGE });
          return;
        }
        const hasCaption = parent.children.some((child) => {
          if (!isNodeOfType(child as EsTreeNode, "JSXElement")) return false;
          const opening = (child as EsTreeNodeOfType<"JSXElement">).openingElement;
          const childTag = getElementType(opening, context.settings);
          if (!settings.track.includes(childTag)) return false;
          const kindAttribute = hasJsxPropIgnoreCase(opening.attributes, "kind");
          if (!kindAttribute) return false;
          const kindValue = kindAttribute.value as EsTreeNode | null;
          if (!kindValue || !isNodeOfType(kindValue, "Literal")) return false;
          if (typeof kindValue.value !== "string") return false;
          return kindValue.value.toLowerCase() === "captions";
        });
        if (!hasCaption) {
          context.report({ node: node.name, message: MESSAGE });
        }
      },
    };
  },
});
