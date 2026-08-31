use std::{borrow::Cow, sync::OnceLock};

use cow_utils::CowUtils;
use itertools::Itertools;
use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeName, JSXOpeningElement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan as _, Span};
use phf::{Map, Set, phf_map, phf_set};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    globals::{HTML_TAG, is_valid_aria_property},
    rule::Rule,
    utils::get_jsx_attribute_name,
};

fn invalid_prop_on_tag(span: Span, prop: &str, tag: &str) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "React ignores `{prop}` here because it only works on these tags: {tag}."
    ))
    .with_label(span)
}

fn data_lowercase_required(span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn("React drops this `data-*` prop because of its capital letters.")
        .with_label(span)
}

fn unknown_prop(span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn("React ignores this prop because it doesn't recognize the name.")
        .with_label(span)
}

#[derive(Debug, Default, Clone)]
pub struct NoUnknownProperty;

struct NoUnknownPropertySettings {
    ignore: FxHashSet<String>,
    require_data_lowercase: bool,
}

declare_oxc_lint!(
    /// Disallows unknown properties on React DOM elements.
    NoUnknownProperty,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow usage of unknown DOM properties.",
);

const ATTRIBUTE_TAGS_MAP: Map<&'static str, Set<&'static str>> = phf_map! {
    "abbr" => phf_set! {"th", "td"},
    "charset" => phf_set! {"meta"},
    "checked" => phf_set! {"input"},
    // Intentionally lowercased, per the react types.
    "closedby" => phf_set! {"dialog"},
    // image is required for SVG support, all other tags are HTML.
    "crossOrigin" => phf_set! {"script", "img", "video", "audio", "link", "image"},
    "displaystyle" => phf_set! {"math"},
    // https://html.spec.whatwg.org/multipage/links.html#downloading-resources
    "download" => phf_set! {"a", "area"},
    // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#fetch-priority-attributes
    "fetchPriority" => phf_set! {"img", "link", "script"},
    "fill" => phf_set! {
         // https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/fill
         // Fill color
         "altGlyph",
         "circle",
         "ellipse",
         "g",
         "line",
         "marker",
         "mask",
         "path",
         "polygon",
         "polyline",
         "rect",
         "svg",
         "symbol",
         "text",
         "textPath",
         "tref",
         "tspan",
         "use",
         // Animation final state
         "animate",
         "animateColor",
         "animateMotion",
         "animateTransform",
         "set",
    },
    "focusable" => phf_set! {"svg"},
    "imageSizes" => phf_set! {"link"},
    "imageSrcSet" => phf_set! {"link"},
    "property" => phf_set! {"meta"},
    // https://html.spec.whatwg.org/multipage/popover.html#the-popovertarget-attribute
    "popoverTarget" => phf_set! {"button", "input"},
    "popoverTargetAction" => phf_set! {"button", "input"},
    "viewBox" => phf_set! {"marker", "pattern", "svg", "symbol", "view"},
    "as" => phf_set! {"link"},
    "align" => phf_set! {
        "applet", "caption", "col", "colgroup", "hr", "iframe", "img", "table", "tbody", "td",
        "tfoot", "th", "thead", "tr",
    },
    // deprecated, but known
    "valign" => phf_set! {"tr", "td", "th", "thead", "tbody", "tfoot", "colgroup", "col"}, // deprecated, but known
    "noModule" => phf_set! {"script"},
    // Media events allowed only on audio and video tags, see https://github.com/facebook/react/blob/256aefbea1449869620fb26f6ec695536ab453f5/CHANGELOG.md#notable-enhancements
    "onAbort" => phf_set! {"audio", "video"},
    "onCancel" => phf_set! {"dialog"},
    "onCanPlay" => phf_set! {"audio", "video"},
    "onCanPlayThrough" => phf_set! {"audio", "video"},
    "onClose" => phf_set! {"dialog"},
    "onDurationChange" => phf_set! {"audio", "video"},
    "onEmptied" => phf_set! {"audio", "video"},
    "onEncrypted" => phf_set! {"audio", "video"},
    "onEnded" => phf_set! {"audio", "video"},
    "onError" => phf_set! {"audio", "video", "img", "link", "source", "script", "picture", "iframe"},
    "onLoad" => phf_set! {"script", "img", "link", "picture", "iframe", "object", "source", "body"},
    "onLoadedData" => phf_set! {"audio", "video"},
    "onLoadedMetadata" => phf_set! {"audio", "video"},
    "onLoadStart" => phf_set! {"audio", "video"},
    "onPause" => phf_set! {"audio", "video"},
    "onPlay" => phf_set! {"audio", "video"},
    "onPlaying" => phf_set! {"audio", "video"},
    "onProgress" => phf_set! {"audio", "video"},
    "onRateChange" => phf_set! {"audio", "video"},
    "onResize" => phf_set! {"audio", "video"},
    "onSeeked" => phf_set! {"audio", "video"},
    "onSeeking" => phf_set! {"audio", "video"},
    "onStalled" => phf_set! {"audio", "video"},
    "onSuspend" => phf_set! {"audio", "video"},
    "onTimeUpdate" => phf_set! {"audio", "video"},
    "onVolumeChange" => phf_set! {"audio", "video"},
    "onWaiting" => phf_set! {"audio", "video"},
    "autoPictureInPicture" => phf_set! {"video"},
    "controls" => phf_set! {"audio", "video"},
    "controlsList" => phf_set! {"audio", "video"},
    "disablePictureInPicture" => phf_set! {"video"},
    "disableRemotePlayback" => phf_set! {"audio", "video"},
    "loop" => phf_set! {"audio", "video"},
    "muted" => phf_set! {"audio", "video"},
    "playsInline" => phf_set! {"video"},
    "allowFullScreen" => phf_set! {"iframe", "video"},
    "webkitAllowFullScreen" => phf_set! {"iframe", "video"},
    "mozAllowFullScreen" => phf_set! {"iframe", "video"},
    "poster" => phf_set! {"video"},
    "preload" => phf_set! {"audio", "video"},
    "scrolling" => phf_set! {"iframe"},
    "returnValue" => phf_set! {"dialog"},
    "webkitDirectory" => phf_set! {"input"},
    "shadowrootmode" => phf_set! {"template"},
    "shadowrootclonable" => phf_set! {"template"},
    "shadowrootdelegatesfocus" => phf_set! {"template"},
    "shadowrootserializable" => phf_set! {"template"},
    "transform-origin" => phf_set! {
        "a", "circle", "clipPath", "defs", "ellipse", "foreignObject", "g", "image", "line",
        "linearGradient", "marker", "mask", "path", "pattern", "polygon", "polyline",
        "radialGradient", "rect", "stop", "svg", "switch", "symbol", "text", "textPath",
        "tspan", "use",
    },
    // React 19: https://react.dev/reference/react-dom/components/link#props
    "precedence" => phf_set! {"style", "link"},
};

const DOM_PROPERTIES_NAMES: Set<&'static str> = phf_set! {
    // Global attributes - can be used on any HTML/DOM element
    // See https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes
    "dir", "draggable", "hidden", "id", "lang", "nonce", "part", "popover", "slot", "style", "title", "translate", "inert",
    // Element specific attributes
    // See https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes (includes global attributes too)
    // To be considered if these should be added also to ATTRIBUTE_TAGS_MAP
    "accept", "action", "allow", "alt", "as", "async", "buffered", "capture", "challenge", "cite", "code", "cols",
    "content", "coords", "csp", "data", "decoding", "default", "defer", "disabled", "form",
    "headers", "height", "high", "href", "icon", "importance", "integrity", "kind", "label",
    "language", "loading", "list", "loop", "low", "manifest", "max", "media", "method", "min", "multiple", "muted",
    "name", "open", "optimum", "pattern", "ping", "placeholder", "poster", "preload", "profile",
    "rel", "required", "reversed", "role", "rows", "sandbox", "scope", "seamless", "selected", "shape", "size", "sizes",
    "span", "src", "start", "step", "summary", "target", "type", "value", "width", "wmode", "wrap",
    // SVG attributes
    // See https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute
    "accumulate", "additive", "alphabetic", "amplitude", "ascent", "azimuth", "bbox", "begin",
    "bias", "by", "clip", "color", "cursor", "cx", "cy", "d", "decelerate", "descent", "direction",
    "display", "divisor", "dur", "dx", "dy", "elevation", "end", "exponent", "fill", "filter",
    "format", "from", "fr", "fx", "fy", "g1", "g2", "hanging", "hreflang", "ideographic",
    "in", "in2", "intercept", "k", "k1", "k2", "k3", "k4", "kerning", "local", "mask", "mode",
    "offset", "opacity", "operator", "order", "orient", "orientation", "origin", "overflow", "path",
    "points", "r", "radius", "restart", "result", "rotate", "rx", "ry", "scale",
    "seed", "slope", "spacing", "speed", "stemh", "stemv", "string", "stroke", "to", "transform",
    "u1", "u2", "unicode", "values", "version", "visibility", "widths", "x", "x1", "x2", "xmlns",
    "y", "y1", "y2", "z",
    // OpenGraph meta tag attributes
    "property",
    // React specific attributes
    "ref", "key", "children",
    // Non-standard
    "results", "security",
    // Video specific
    "controls",
    // TWO WORD DOM_PROPERTIES_NAMES

    // Global attributes - can be used on any HTML/DOM element
    // See https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes
    "accessKey", "autoCapitalize", "autoFocus", "contentEditable", "enterKeyHint", "exportParts",
    "inputMode", "itemID", "itemRef", "itemProp", "itemScope", "itemType", "spellCheck", "tabIndex",
    // Element specific attributes
    // See https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes (includes global attributes too)
    // To be considered if these should be added also to ATTRIBUTE_TAGS_MAP
    "acceptCharset", "autoComplete", "autoPlay", "border", "cellPadding", "cellSpacing", "classID", "codeBase",
    "colSpan", "contextMenu", "dateTime", "encType", "formAction", "formEncType", "formMethod", "formNoValidate", "formTarget",
    "frameBorder", "hrefLang", "httpEquiv", "imageSizes", "imageSrcSet", "isMap", "keyParams", "keyType", "marginHeight", "marginWidth",
    "maxLength", "mediaGroup", "minLength", "noValidate", "onAnimationEnd", "onAnimationIteration", "onAnimationStart",
    "onBlur", "onChange", "onClick", "onContextMenu", "onCopy", "onCompositionEnd", "onCompositionStart",
    "onCompositionUpdate", "onCut", "onDoubleClick", "onDrag", "onDragEnd", "onDragEnter", "onDragExit", "onDragLeave",
    "onError", "onFocus", "onInput", "onKeyDown", "onKeyPress", "onKeyUp", "onLoad", "onWheel", "onDragOver",
    "onDragStart", "onDrop", "onMouseDown", "onMouseEnter", "onMouseLeave", "onMouseMove", "onMouseOut", "onMouseOver",
    "onMouseUp", "onPaste", "onScroll", "onScrollEnd", "onSelect", "onSubmit", "onBeforeToggle", "onToggle", "onTransitionEnd", "radioGroup",
    "readOnly", "referrerPolicy", "rowSpan", "srcDoc", "srcLang", "srcSet", "useMap",
    // SVG attributes
    // See https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute
    "crossOrigin", "accentHeight", "alignmentBaseline", "arabicForm", "attributeName",
    "attributeType", "baseFrequency", "baselineShift", "baseProfile", "calcMode", "capHeight",
    "clipPathUnits", "clipPath", "clipRule", "colorInterpolation", "colorInterpolationFilters",
    "colorProfile", "colorRendering", "contentScriptType", "contentStyleType", "diffuseConstant",
    "dominantBaseline", "edgeMode", "enableBackground", "fillOpacity", "fillRule", "filterRes",
    "filterUnits", "floodColor", "floodOpacity", "fontFamily", "fontSize", "fontSizeAdjust",
    "fontStretch", "fontStyle", "fontVariant", "fontWeight", "glyphName",
    "glyphOrientationHorizontal", "glyphOrientationVertical", "glyphRef", "gradientTransform",
    "gradientUnits", "horizAdvX", "horizOriginX", "imageRendering", "kernelMatrix",
    "kernelUnitLength", "keyPoints", "keySplines", "keyTimes", "lengthAdjust", "letterSpacing",
    "lightingColor", "limitingConeAngle", "markerEnd", "markerMid", "markerStart", "markerHeight",
    "markerUnits", "markerWidth", "maskContentUnits", "maskUnits", "mathematical", "numOctaves",
    "overlinePosition", "overlineThickness", "panose1", "paintOrder", "pathLength",
    "patternContentUnits", "patternTransform", "patternUnits", "pointerEvents", "pointsAtX",
    "pointsAtY", "pointsAtZ", "preserveAlpha", "preserveAspectRatio", "primitiveUnits",
    "refX", "refY", "rendering-intent", "repeatCount", "repeatDur",
    "requiredExtensions", "requiredFeatures", "shapeRendering", "specularConstant",
    "specularExponent", "spreadMethod", "startOffset", "stdDeviation", "stitchTiles", "stopColor",
    "stopOpacity", "strikethroughPosition", "strikethroughThickness", "strokeDasharray",
    "strokeDashoffset", "strokeLinecap", "strokeLinejoin", "strokeMiterlimit", "strokeOpacity",
    "strokeWidth", "surfaceScale", "systemLanguage", "tableValues", "targetX", "targetY",
    "textAnchor", "textDecoration", "textRendering", "textLength", "transformOrigin",
    "underlinePosition", "underlineThickness", "unicodeBidi", "unicodeRange", "unitsPerEm",
    "vAlphabetic", "vHanging", "vIdeographic", "vMathematical", "vectorEffect", "vertAdvY",
    "vertOriginX", "vertOriginY", "viewBox", "viewTarget", "wordSpacing", "writingMode", "xHeight",
    "xChannelSelector", "xlinkActuate", "xlinkArcrole", "xlinkHref", "xlinkRole", "xlinkShow",
    "xlinkTitle", "xlinkType", "xmlBase", "xmlLang", "xmlnsXlink", "xmlSpace", "yChannelSelector",
    "zoomAndPan",
    // Safari/Apple specific, no listing available
    "autoCorrect", // https://stackoverflow.com/questions/47985384/html-autocorrect-for-text-input-is-not-working
    "autoSave", // https://stackoverflow.com/questions/25456396/what-is-autosave-attribute-supposed-to-do-how-do-i-use-it
    // React specific attributes https://reactjs.org/docs/dom-elements.html#differences-in-attributes
    "className", "dangerouslySetInnerHTML", "defaultValue", "defaultChecked", "htmlFor",
    // Events" capture events
    "onBeforeInput",
    "onInvalid", "onReset", "onTouchCancel", "onTouchEnd", "onTouchMove", "onTouchStart", "suppressContentEditableWarning", "suppressHydrationWarning",
    "onAbort", "onCanPlay", "onCanPlayThrough", "onDurationChange", "onEmptied", "onEncrypted", "onEnded",
    "onLoadedData", "onLoadedMetadata", "onLoadStart", "onPause", "onPlay", "onPlaying", "onProgress", "onRateChange", "onResize",
    "onSeeked", "onSeeking", "onStalled", "onSuspend", "onTimeUpdate", "onVolumeChange", "onWaiting",
    "onCopyCapture", "onCutCapture", "onPasteCapture", "onCompositionEndCapture", "onCompositionStartCapture", "onCompositionUpdateCapture",
    "onFocusCapture", "onBlurCapture", "onChangeCapture", "onBeforeInputCapture", "onInputCapture", "onResetCapture", "onSubmitCapture",
    "onInvalidCapture", "onLoadCapture", "onErrorCapture", "onKeyDownCapture", "onKeyPressCapture", "onKeyUpCapture",
    "onAbortCapture", "onCanPlayCapture", "onCanPlayThroughCapture", "onDurationChangeCapture", "onEmptiedCapture", "onEncryptedCapture",
    "onEndedCapture", "onLoadedDataCapture", "onLoadedMetadataCapture", "onLoadStartCapture", "onPauseCapture", "onPlayCapture",
    "onPlayingCapture", "onProgressCapture", "onRateChangeCapture", "onSeekedCapture", "onSeekingCapture", "onStalledCapture", "onSuspendCapture",
    "onTimeUpdateCapture", "onVolumeChangeCapture", "onWaitingCapture", "onSelectCapture", "onTouchCancelCapture", "onTouchEndCapture",
    "onTouchMoveCapture", "onTouchStartCapture", "onScrollCapture", "onScrollEndCapture", "onWheelCapture", "onAnimationEndCapture",
    "onAnimationStartCapture", "onTransitionEndCapture",
    "onAuxClick", "onAuxClickCapture", "onClickCapture", "onContextMenuCapture", "onDoubleClickCapture",
    "onDragCapture", "onDragEndCapture", "onDragEnterCapture", "onDragExitCapture", "onDragLeaveCapture",
    "onDragOverCapture", "onDragStartCapture", "onDropCapture", "onMouseDownCapture",
    "onMouseMoveCapture", "onMouseOutCapture", "onMouseOverCapture", "onMouseUpCapture",
    // Video specific
    "autoPictureInPicture", "controlsList", "disablePictureInPicture", "disableRemotePlayback",

    // React on props
    "onGotPointerCapture",
    "onGotPointerCaptureCapture",
    "onLostPointerCapture",
    "onLostPointerCaptureCapture",
    "onPointerCancel",
    "onPointerCancelCapture",
    "onPointerDown",
    "onPointerDownCapture",
    "onPointerEnter",
    "onPointerEnterCapture",
    "onPointerLeave",
    "onPointerLeaveCapture",
    "onPointerMove",
    "onPointerMoveCapture",
    "onPointerOut",
    "onPointerOutCapture",
    "onPointerOver",
    "onPointerOverCapture",
    "onPointerUp",
    "onPointerUpCapture",
};

const DOM_ATTRIBUTES_TO_CAMEL: Map<&'static str, &'static str> = phf_map! {
    "accept-charset" => "acceptCharset",
    "class" => "className",
    "http-equiv" => "httpEquiv",
    "crossorigin" => "crossOrigin",
    "fetchpriority" => "fetchPriority",
    "for" => "htmlFor",
    "nomodule" => "noModule",
    "popovertarget" => "popoverTarget",
    "popovertargetaction" => "popoverTargetAction",
    // svg
    "accent-height" => "accentHeight",
    "alignment-baseline" => "alignmentBaseline",
    "arabic-form" => "arabicForm",
    "baseline-shift" => "baselineShift",
    "cap-height" => "capHeight",
    "clip-path" => "clipPath",
    "clip-rule" => "clipRule",
    "color-interpolation" => "colorInterpolation",
    "color-interpolation-filters" => "colorInterpolationFilters",
    "color-profile" => "colorProfile",
    "color-rendering" => "colorRendering",
    "dominant-baseline" => "dominantBaseline",
    "enable-background" => "enableBackground",
    "fill-opacity" => "fillOpacity",
    "fill-rule" => "fillRule",
    "flood-color" => "floodColor",
    "flood-opacity" => "floodOpacity",
    "font-family" => "fontFamily",
    "font-size" => "fontSize",
    "font-size-adjust" => "fontSizeAdjust",
    "font-stretch" => "fontStretch",
    "font-style" => "fontStyle",
    "font-variant" => "fontVariant",
    "font-weight" => "fontWeight",
    "glyph-name" => "glyphName",
    "glyph-orientation-horizontal" => "glyphOrientationHorizontal",
    "glyph-orientation-vertical" => "glyphOrientationVertical",
    "horiz-adv-x" => "horizAdvX",
    "horiz-origin-x" => "horizOriginX",
    "image-rendering" => "imageRendering",
    "letter-spacing" => "letterSpacing",
    "lighting-color" => "lightingColor",
    "marker-end" => "markerEnd",
    "marker-mid" => "markerMid",
    "marker-start" => "markerStart",
    "overline-position" => "overlinePosition",
    "overline-thickness" => "overlineThickness",
    "paint-order" => "paintOrder",
    "panose-1" => "panose1",
    "pointer-events" => "pointerEvents",
    "rendering-intent" => "renderingIntent",
    "shape-rendering" => "shapeRendering",
    "stop-color" => "stopColor",
    "stop-opacity" => "stopOpacity",
    "strikethrough-position" => "strikethroughPosition",
    "strikethrough-thickness" => "strikethroughThickness",
    "stroke-dasharray" => "strokeDasharray",
    "stroke-dashoffset" => "strokeDashoffset",
    "stroke-linecap" => "strokeLinecap",
    "stroke-linejoin" => "strokeLinejoin",
    "stroke-miterlimit" => "strokeMiterlimit",
    "stroke-opacity" => "strokeOpacity",
    "stroke-width" => "strokeWidth",
    "text-anchor" => "textAnchor",
    "text-decoration" => "textDecoration",
    "text-rendering" => "textRendering",
    "underline-position" => "underlinePosition",
    "underline-thickness" => "underlineThickness",
    "unicode-bidi" => "unicodeBidi",
    "unicode-range" => "unicodeRange",
    "units-per-em" => "unitsPerEm",
    "v-alphabetic" => "vAlphabetic",
    "v-hanging" => "vHanging",
    "v-ideographic" => "vIdeographic",
    "v-mathematical" => "vMathematical",
    "vector-effect" => "vectorEffect",
    "vert-adv-y" => "vertAdvY",
    "vert-origin-x" => "vertOriginX",
    "vert-origin-y" => "vertOriginY",
    "word-spacing" => "wordSpacing",
    "writing-mode" => "writingMode",
    "x-height" => "xHeight",
    "xlink:actuate" => "xlinkActuate",
    "xlink:arcrole" => "xlinkArcrole",
    "xlink:href" => "xlinkHref",
    "xlink:role" => "xlinkRole",
    "xlink:show" => "xlinkShow",
    "xlink:title" => "xlinkTitle",
    "xlink:type" => "xlinkType",
    "xml:base" => "xmlBase",
    "xml:lang" => "xmlLang",
    "xml:space" => "xmlSpace",
};

const DOM_PROPERTIES_IGNORE_CASE: [&str; 5] = [
    "charset",
    "allowFullScreen",
    "webkitAllowFullScreen",
    "mozAllowFullScreen",
    "webkitDirectory",
];

fn dom_properties_lower_map() -> &'static FxHashMap<Cow<'static, str>, &'static str> {
    static DOM_PROPERTIES_LOWER_MAP: OnceLock<FxHashMap<Cow<'static, str>, &'static str>> =
        OnceLock::new();
    DOM_PROPERTIES_LOWER_MAP.get_or_init(|| {
        DOM_PROPERTIES_NAMES
            .iter()
            .map(|it| (it.cow_to_ascii_lowercase(), *it))
            .collect::<FxHashMap<_, _>>()
    })
}

/// Checks if an attribute name is a valid `data-*` attribute:
/// - Name starts with "data-" and has alphanumeric words (browsers require lowercase, but React and TS lowercase them),
/// - Does not start with any casing of "xml"
/// - Words are separated by hyphens (-) (which is also called "kebab case" or "dash case")
fn is_valid_data_attr(name: &str) -> bool {
    if !name.starts_with("data-") {
        return false;
    }

    if name.cow_to_ascii_lowercase().starts_with("data-xml") {
        return false;
    }

    let data_name = &name["data-".len()..];
    if data_name.is_empty() {
        return false;
    }

    data_name.chars().all(|c| c != ':')
}

fn normalize_attribute_case(name: &str) -> &str {
    DOM_PROPERTIES_IGNORE_CASE
        .iter()
        .find(|camel_name| camel_name.eq_ignore_ascii_case(name))
        .unwrap_or(&name)
}
fn has_uppercase(name: &str) -> bool {
    name.bytes().any(|byte| byte.is_ascii_uppercase())
}

impl Rule for NoUnknownProperty {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let settings = no_unknown_property_settings(ctx);
        let curated_behavior = should_use_curated_port_behavior(ctx);
        let mut file_is_non_react_jsx = file_imports_non_react_jsx_dialect(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !file_is_non_react_jsx
                && opening_element_has_non_react_class_list_marker(opening_element)
            {
                file_is_non_react_jsx = true;
            }
            if file_is_non_react_jsx {
                continue;
            }
            check_unknown_properties(opening_element, &settings, curated_behavior, ctx);
        }
    }
}

fn file_imports_non_react_jsx_dialect(ctx: &LintContext<'_>) -> bool {
    let mut has_non_react_runtime = false;
    let mut has_react_runtime = false;
    for node in ctx.nodes().iter() {
        let AstKind::ImportDeclaration(declaration) = node.kind() else {
            continue;
        };
        if is_type_only_import(declaration) {
            continue;
        }
        let module_name = declaration.source.value.as_str();
        has_non_react_runtime |= is_non_react_jsx_runtime(module_name);
        has_react_runtime |= is_react_jsx_runtime(module_name);
    }
    has_non_react_runtime && !has_react_runtime
}

fn opening_element_has_non_react_class_list_marker(
    opening_element: &JSXOpeningElement<'_>,
) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return false;
        };
        let JSXAttributeName::Identifier(identifier) = &attribute.name else {
            return false;
        };
        identifier.name == "classList"
            && matches!(
                &attribute.value,
                Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container))
                    if matches!(
                        container.expression.as_expression(),
                        Some(oxc_ast::ast::Expression::ObjectExpression(_))
                    )
            )
    })
}

fn no_unknown_property_settings(ctx: &LintContext<'_>) -> NoUnknownPropertySettings {
    let rule_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("noUnknownProperty"));
    NoUnknownPropertySettings {
        ignore: rule_settings
            .and_then(|settings| settings.get("ignore"))
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(serde_json::Value::as_str)
            .map(str::to_string)
            .collect(),
        require_data_lowercase: rule_settings
            .and_then(|settings| settings.get("requireDataLowercase"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    }
}

fn check_unknown_properties<'a>(
    opening_element: &JSXOpeningElement<'a>,
    settings: &NoUnknownPropertySettings,
    curated_behavior: bool,
    ctx: &LintContext<'a>,
) {
    let Some((element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
        return;
    };
    if !element_type
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_lowercase)
        || matches!(element_type, "fbt" | "fbs")
    {
        return;
    }

    let mut is_valid_dom_tag = HTML_TAG.contains(element_type) || is_svg_tag_name(element_type);
    let mut has_customized_builtin_attribute = false;
    if is_valid_dom_tag {
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let JSXAttributeName::Identifier(identifier) = &attribute.name else {
                continue;
            };
            if identifier.name == "is" {
                is_valid_dom_tag = false;
                has_customized_builtin_attribute = true;
                break;
            }
        }
    }
    if !is_valid_dom_tag
        && !curated_behavior
        && (has_customized_builtin_attribute || element_type.contains('-'))
    {
        return;
    }

    for attribute in &opening_element.attributes {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            continue;
        };
        let span = attribute.name.span();
        let actual_name = get_jsx_attribute_name(&attribute.name);
        let actual_name = actual_name.as_ref();
        if settings.ignore.contains(actual_name) {
            continue;
        }
        if is_valid_data_attr(actual_name) {
            if settings.require_data_lowercase && has_uppercase(actual_name) {
                ctx.diagnostic(data_lowercase_required(span));
            }
            continue;
        }
        if is_valid_dom_aria_property(actual_name) {
            continue;
        }
        if curated_behavior && !is_valid_dom_tag {
            continue;
        }

        let normalized_name = normalize_attribute_case(actual_name);
        if let Some(tags) = ATTRIBUTE_TAGS_MAP.get(normalized_name) {
            if curated_behavior && is_synthetic_event_handler_name(normalized_name) {
                continue;
            }
            if !tags.contains(element_type) {
                let allowed_tags = allowed_tags_description(normalized_name, tags);
                ctx.diagnostic(invalid_prop_on_tag(
                    span,
                    actual_name,
                    allowed_tags.as_ref(),
                ));
            }
            continue;
        }
        if DOM_PROPERTIES_NAMES.contains(normalized_name) {
            continue;
        }
        if curated_behavior
            && is_svg_tag_name(element_type)
            && actual_name.contains('-')
            && !has_uppercase(actual_name)
            && DOM_ATTRIBUTES_TO_CAMEL.contains_key(actual_name)
        {
            continue;
        }

        let lowercase_name = normalized_name.cow_to_ascii_lowercase();
        let has_standard_name = dom_properties_lower_map().contains_key(&lowercase_name)
            || DOM_ATTRIBUTES_TO_CAMEL.contains_key(normalized_name);
        if has_standard_name {
            ctx.diagnostic(unknown_prop(span));
            continue;
        }

        let is_rendered_verbatim_by_react = !has_uppercase(actual_name)
            && !actual_name.starts_with("aria-")
            && !actual_name.starts_with("data-");
        if curated_behavior && is_rendered_verbatim_by_react {
            continue;
        }
        ctx.diagnostic(unknown_prop(span));
    }
}

fn is_synthetic_event_handler_name(name: &str) -> bool {
    name.as_bytes().starts_with(b"on") && name.as_bytes().get(2).is_some_and(u8::is_ascii_uppercase)
}

fn is_valid_dom_aria_property(name: &str) -> bool {
    name.starts_with("aria-") && is_valid_aria_property(&name.cow_to_ascii_lowercase())
}

fn allowed_tags_description<'a>(property_name: &str, tags: &'a Set<&'static str>) -> Cow<'a, str> {
    match property_name {
        "abbr" => Cow::Borrowed("th, td"),
        "charset" => Cow::Borrowed("meta"),
        "checked" => Cow::Borrowed("input"),
        "closedby" => Cow::Borrowed("dialog"),
        "crossOrigin" => Cow::Borrowed("script, img, video, audio, link, image"),
        "displaystyle" => Cow::Borrowed("math"),
        "download" => Cow::Borrowed("a, area"),
        "fetchPriority" => Cow::Borrowed("img, link, script"),
        "fill" => Cow::Borrowed(
            "altGlyph, circle, ellipse, g, line, marker, mask, path, polygon, polyline, rect, svg, symbol, text, textPath, tref, tspan, use, animate, animateColor, animateMotion, animateTransform, set",
        ),
        "focusable" => Cow::Borrowed("svg"),
        "imageSizes" => Cow::Borrowed("link"),
        "imageSrcSet" => Cow::Borrowed("link"),
        "property" => Cow::Borrowed("meta"),
        "popoverTarget" => Cow::Borrowed("button, input"),
        "popoverTargetAction" => Cow::Borrowed("button, input"),
        "viewBox" => Cow::Borrowed("marker, pattern, svg, symbol, view"),
        "as" => Cow::Borrowed("link"),
        "align" => Cow::Borrowed(
            "applet, caption, col, colgroup, hr, iframe, img, table, tbody, td, tfoot, th, thead, tr",
        ),
        "valign" => Cow::Borrowed("tr, td, th, thead, tbody, tfoot, colgroup, col"),
        "noModule" => Cow::Borrowed("script"),
        "onAbort" => Cow::Borrowed("audio, video"),
        "onCancel" => Cow::Borrowed("dialog"),
        "onCanPlay" => Cow::Borrowed("audio, video"),
        "onCanPlayThrough" => Cow::Borrowed("audio, video"),
        "onClose" => Cow::Borrowed("dialog"),
        "onDurationChange" => Cow::Borrowed("audio, video"),
        "onEmptied" => Cow::Borrowed("audio, video"),
        "onEncrypted" => Cow::Borrowed("audio, video"),
        "onEnded" => Cow::Borrowed("audio, video"),
        "onError" => Cow::Borrowed("audio, video, img, link, source, script, picture, iframe"),
        "onLoad" => Cow::Borrowed("script, img, link, picture, iframe, object, source, body"),
        "onLoadedData" => Cow::Borrowed("audio, video"),
        "onLoadedMetadata" => Cow::Borrowed("audio, video"),
        "onLoadStart" => Cow::Borrowed("audio, video"),
        "onPause" => Cow::Borrowed("audio, video"),
        "onPlay" => Cow::Borrowed("audio, video"),
        "onPlaying" => Cow::Borrowed("audio, video"),
        "onProgress" => Cow::Borrowed("audio, video"),
        "onRateChange" => Cow::Borrowed("audio, video"),
        "onResize" => Cow::Borrowed("audio, video"),
        "onSeeked" => Cow::Borrowed("audio, video"),
        "onSeeking" => Cow::Borrowed("audio, video"),
        "onStalled" => Cow::Borrowed("audio, video"),
        "onSuspend" => Cow::Borrowed("audio, video"),
        "onTimeUpdate" => Cow::Borrowed("audio, video"),
        "onVolumeChange" => Cow::Borrowed("audio, video"),
        "onWaiting" => Cow::Borrowed("audio, video"),
        "autoPictureInPicture" => Cow::Borrowed("video"),
        "controls" => Cow::Borrowed("audio, video"),
        "controlsList" => Cow::Borrowed("audio, video"),
        "disablePictureInPicture" => Cow::Borrowed("video"),
        "disableRemotePlayback" => Cow::Borrowed("audio, video"),
        "loop" => Cow::Borrowed("audio, video"),
        "muted" => Cow::Borrowed("audio, video"),
        "playsInline" => Cow::Borrowed("video"),
        "allowFullScreen" => Cow::Borrowed("iframe, video"),
        "webkitAllowFullScreen" => Cow::Borrowed("iframe, video"),
        "mozAllowFullScreen" => Cow::Borrowed("iframe, video"),
        "poster" => Cow::Borrowed("video"),
        "preload" => Cow::Borrowed("audio, video"),
        "scrolling" => Cow::Borrowed("iframe"),
        "returnValue" => Cow::Borrowed("dialog"),
        "webkitDirectory" => Cow::Borrowed("input"),
        "shadowrootmode" => Cow::Borrowed("template"),
        "shadowrootclonable" => Cow::Borrowed("template"),
        "shadowrootdelegatesfocus" => Cow::Borrowed("template"),
        "shadowrootserializable" => Cow::Borrowed("template"),
        "transform-origin" => Cow::Borrowed(
            "a, circle, clipPath, defs, ellipse, foreignObject, g, image, line, linearGradient, marker, mask, path, pattern, polygon, polyline, radialGradient, rect, stop, svg, switch, symbol, text, textPath, tspan, use",
        ),
        "precedence" => Cow::Borrowed("style, link"),
        _ => Cow::Owned(tags.iter().join(", ")),
    }
}
