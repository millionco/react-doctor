import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";

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
): {
  audio: ReadonlySet<string>;
  video: ReadonlySet<string>;
  track: ReadonlySet<string>;
} => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { mediaHasCaption?: MediaHasCaptionSettings }).mediaHasCaption ?? {})
      : {};
  return {
    audio: new Set([...DEFAULT_AUDIO, ...(ruleSettings.audio ?? [])]),
    video: new Set([...DEFAULT_VIDEO, ...(ruleSettings.video ?? [])]),
    track: new Set([...DEFAULT_TRACK, ...(ruleSettings.track ?? [])]),
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

// A track whose `kind` we cannot statically rule out as captions: a dynamic
// kind (`kind={t.kind}`), a static `kind="captions"`. A static non-caption
// kind (`kind="subtitles"`) or an absent kind (HTML defaults to subtitles)
// is provably NOT a caption track.
const trackKindMightBeCaptions = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const kindAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "kind");
  if (!kindAttribute) return false;
  let kindValue = kindAttribute.value as EsTreeNode | null;
  if (kindValue && isNodeOfType(kindValue, "JSXExpressionContainer")) {
    kindValue = kindValue.expression as EsTreeNode;
  }
  if (!kindValue || !isNodeOfType(kindValue, "Literal") || typeof kindValue.value !== "string") {
    return true;
  }
  return kindValue.value.toLowerCase() === "captions";
};

const getSrcStaticValue = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): string | null | undefined => {
  const value = attribute.value as EsTreeNode | null;
  if (!value) return undefined;
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "string" ? value.value : undefined;
  }
  if (!isNodeOfType(value, "JSXExpressionContainer")) return undefined;
  const expression = value.expression as EsTreeNode;
  if (isNodeOfType(expression, "Literal")) {
    return typeof expression.value === "string" ? expression.value : undefined;
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    return getStaticTemplateLiteralValue(expression);
  }
  return null;
};

// Docs-validation FP cluster: media whose every playable source is a runtime
// expression (blob/object URLs, user-uploaded attachments, generated media
// paths) has no static asset the author could pair a captions file with, so
// the documented fix (add `<track kind="captions">`) is inapplicable. Media
// with a statically-known src — or with no src at all — still fires.
const hasOnlyDynamicPlayableSources = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  const srcAttributes: Array<EsTreeNodeOfType<"JSXAttribute">> = [];
  const ownSrc = hasJsxPropIgnoreCase(node.attributes, "src");
  if (ownSrc) srcAttributes.push(ownSrc);
  const parent = (node as EsTreeNode).parent;
  if (parent && isNodeOfType(parent, "JSXElement")) {
    for (const child of parent.children) {
      if (!isNodeOfType(child as EsTreeNode, "JSXElement")) continue;
      const opening = (child as EsTreeNodeOfType<"JSXElement">).openingElement;
      if (getElementType(opening, settings) !== "source") continue;
      const sourceSrc = hasJsxPropIgnoreCase(opening.attributes, "src");
      if (sourceSrc) srcAttributes.push(sourceSrc);
    }
  }
  if (srcAttributes.length === 0) return false;
  return srcAttributes.every((attribute) => getSrcStaticValue(attribute) === null);
};

// A `{tracks.map(...)}` / `{cond && <track/>}` / `{cond ? <track/> : null}`
// child can render `<track>` elements the static scan can't see into. When
// such a dynamic source produces a track that MIGHT be a caption track, treat
// captions as possibly present and stay silent rather than emit a false
// positive. A dynamic source that only ever renders provably-non-caption
// tracks (e.g. a static `kind="subtitles"`) does not satisfy the requirement.
const childMayRenderTrack = (
  child: EsTreeNode,
  trackTags: ReadonlySet<string>,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  if (!isNodeOfType(child, "JSXExpressionContainer")) return false;
  const expression = child.expression;
  const isMapCall =
    isNodeOfType(expression, "CallExpression") &&
    isNodeOfType(expression.callee, "MemberExpression") &&
    isNodeOfType(expression.callee.property, "Identifier") &&
    expression.callee.property.name === "map";
  const isDynamicTrackSource =
    isMapCall ||
    isNodeOfType(expression, "LogicalExpression") ||
    isNodeOfType(expression, "ConditionalExpression");
  if (!isDynamicTrackSource) return false;

  let rendersCaptionTrack = false;
  walkAst(expression, (inner) => {
    if (rendersCaptionTrack) return false;
    if (
      isNodeOfType(inner, "JSXElement") &&
      trackTags.has(getElementType(inner.openingElement, settings)) &&
      trackKindMightBeCaptions(inner.openingElement)
    ) {
      rendersCaptionTrack = true;
      return false;
    }
  });
  return rendersCaptionTrack;
};

// Port of `oxc_linter::rules::jsx_a11y::media_has_caption`.
export const mediaHasCaption = defineRule({
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
        const isAudioOrVideo = settings.audio.has(tag) || settings.video.has(tag);
        if (!isAudioOrVideo) return;
        const mutedAttribute = hasJsxPropIgnoreCase(node.attributes, "muted");
        if (evaluateMuted(mutedAttribute) === true) return;
        if (hasOnlyDynamicPlayableSources(node, context.settings)) return;

        const parent = (node as EsTreeNode).parent;
        if (!parent || !isNodeOfType(parent, "JSXElement")) {
          context.report({ node: node.name, message: MESSAGE });
          return;
        }
        const hasDynamicTrackSource = parent.children.some((child) =>
          childMayRenderTrack(child as EsTreeNode, settings.track, context.settings),
        );
        if (hasDynamicTrackSource) return;
        const hasCaption = parent.children.some((child) => {
          if (!isNodeOfType(child as EsTreeNode, "JSXElement")) return false;
          const opening = (child as EsTreeNodeOfType<"JSXElement">).openingElement;
          const childTag = getElementType(opening, context.settings);
          if (!settings.track.has(childTag)) return false;
          const kindAttribute = hasJsxPropIgnoreCase(opening.attributes, "kind");
          if (!kindAttribute) return false;
          let kindValue = kindAttribute.value as EsTreeNode | null;
          // `kind={"captions"}` wraps the literal in an expression container.
          if (kindValue && isNodeOfType(kindValue, "JSXExpressionContainer")) {
            kindValue = kindValue.expression as EsTreeNode;
          }
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
