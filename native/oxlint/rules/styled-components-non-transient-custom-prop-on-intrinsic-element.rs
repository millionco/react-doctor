use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Declaration, Expression, JSXAttributeItem, JSXAttributeName,
        JSXElementName, ObjectPropertyKind, PropertyKey, Statement, TSSignature, TSType,
        TSTypeName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{AstNode, context::LintContext, rule::Rule};

const STYLED_COMPONENTS_MODULES: [&str; 1] = ["styled-components"];
const TYPE_RESOLUTION_DEPTH_LIMIT: usize = 3;
const STYLED_DOM_PROPERTY_NAMES_LOWER: &[&str] = &[
    "accentheight",
    "accept",
    "acceptcharset",
    "accesskey",
    "accumulate",
    "action",
    "additive",
    "alignmentbaseline",
    "allow",
    "alphabetic",
    "alt",
    "amplitude",
    "arabicform",
    "as",
    "ascent",
    "async",
    "attributename",
    "attributetype",
    "autocapitalize",
    "autocomplete",
    "autocorrect",
    "autofocus",
    "autopictureinpicture",
    "autoplay",
    "autosave",
    "azimuth",
    "basefrequency",
    "baselineshift",
    "baseprofile",
    "bbox",
    "begin",
    "bias",
    "border",
    "buffered",
    "by",
    "calcmode",
    "capheight",
    "capture",
    "cellpadding",
    "cellspacing",
    "challenge",
    "children",
    "cite",
    "classid",
    "classname",
    "clip",
    "clippath",
    "clippathunits",
    "cliprule",
    "code",
    "codebase",
    "color",
    "colorinterpolation",
    "colorinterpolationfilters",
    "colorprofile",
    "colorrendering",
    "cols",
    "colspan",
    "content",
    "contenteditable",
    "contentscripttype",
    "contentstyletype",
    "contextmenu",
    "controls",
    "controlslist",
    "coords",
    "crossorigin",
    "csp",
    "cursor",
    "cx",
    "cy",
    "d",
    "dangerouslysetinnerhtml",
    "data",
    "datetime",
    "decelerate",
    "decoding",
    "default",
    "defaultchecked",
    "defaultvalue",
    "defer",
    "descent",
    "diffuseconstant",
    "dir",
    "direction",
    "disabled",
    "disablepictureinpicture",
    "disableremoteplayback",
    "display",
    "divisor",
    "dominantbaseline",
    "draggable",
    "dur",
    "dx",
    "dy",
    "edgemode",
    "elevation",
    "enablebackground",
    "enctype",
    "end",
    "enterkeyhint",
    "exponent",
    "exportparts",
    "fill",
    "fillopacity",
    "fillrule",
    "filter",
    "filterres",
    "filterunits",
    "floodcolor",
    "floodopacity",
    "fontfamily",
    "fontsize",
    "fontsizeadjust",
    "fontstretch",
    "fontstyle",
    "fontvariant",
    "fontweight",
    "form",
    "formaction",
    "format",
    "formenctype",
    "formmethod",
    "formnovalidate",
    "formtarget",
    "fr",
    "frameborder",
    "from",
    "fx",
    "fy",
    "g1",
    "g2",
    "glyphname",
    "glyphorientationhorizontal",
    "glyphorientationvertical",
    "glyphref",
    "gradienttransform",
    "gradientunits",
    "hanging",
    "headers",
    "height",
    "hidden",
    "high",
    "horizadvx",
    "horizoriginx",
    "href",
    "hreflang",
    "htmlfor",
    "httpequiv",
    "icon",
    "id",
    "ideographic",
    "imagerendering",
    "imagesizes",
    "imagesrcset",
    "importance",
    "in",
    "in2",
    "inert",
    "inputmode",
    "integrity",
    "intercept",
    "ismap",
    "itemid",
    "itemprop",
    "itemref",
    "itemscope",
    "itemtype",
    "k",
    "k1",
    "k2",
    "k3",
    "k4",
    "kernelmatrix",
    "kernelunitlength",
    "kerning",
    "key",
    "keyparams",
    "keypoints",
    "keysplines",
    "keytimes",
    "keytype",
    "kind",
    "label",
    "lang",
    "language",
    "lengthadjust",
    "letterspacing",
    "lightingcolor",
    "limitingconeangle",
    "list",
    "loading",
    "local",
    "loop",
    "low",
    "manifest",
    "marginheight",
    "marginwidth",
    "markerend",
    "markerheight",
    "markermid",
    "markerstart",
    "markerunits",
    "markerwidth",
    "mask",
    "maskcontentunits",
    "maskunits",
    "mathematical",
    "max",
    "maxlength",
    "media",
    "mediagroup",
    "method",
    "min",
    "minlength",
    "mode",
    "multiple",
    "muted",
    "name",
    "nonce",
    "novalidate",
    "numoctaves",
    "offset",
    "onabort",
    "onabortcapture",
    "onanimationend",
    "onanimationendcapture",
    "onanimationiteration",
    "onanimationstart",
    "onanimationstartcapture",
    "onauxclick",
    "onauxclickcapture",
    "onbeforeinput",
    "onbeforeinputcapture",
    "onbeforetoggle",
    "onblur",
    "onblurcapture",
    "oncanplay",
    "oncanplaycapture",
    "oncanplaythrough",
    "oncanplaythroughcapture",
    "onchange",
    "onchangecapture",
    "onclick",
    "onclickcapture",
    "oncompositionend",
    "oncompositionendcapture",
    "oncompositionstart",
    "oncompositionstartcapture",
    "oncompositionupdate",
    "oncompositionupdatecapture",
    "oncontextmenu",
    "oncontextmenucapture",
    "oncopy",
    "oncopycapture",
    "oncut",
    "oncutcapture",
    "ondoubleclick",
    "ondoubleclickcapture",
    "ondrag",
    "ondragcapture",
    "ondragend",
    "ondragendcapture",
    "ondragenter",
    "ondragentercapture",
    "ondragexit",
    "ondragexitcapture",
    "ondragleave",
    "ondragleavecapture",
    "ondragover",
    "ondragovercapture",
    "ondragstart",
    "ondragstartcapture",
    "ondrop",
    "ondropcapture",
    "ondurationchange",
    "ondurationchangecapture",
    "onemptied",
    "onemptiedcapture",
    "onencrypted",
    "onencryptedcapture",
    "onended",
    "onendedcapture",
    "onerror",
    "onerrorcapture",
    "onfocus",
    "onfocuscapture",
    "ongotpointercapture",
    "ongotpointercapturecapture",
    "oninput",
    "oninputcapture",
    "oninvalid",
    "oninvalidcapture",
    "onkeydown",
    "onkeydowncapture",
    "onkeypress",
    "onkeypresscapture",
    "onkeyup",
    "onkeyupcapture",
    "onload",
    "onloadcapture",
    "onloadeddata",
    "onloadeddatacapture",
    "onloadedmetadata",
    "onloadedmetadatacapture",
    "onloadstart",
    "onloadstartcapture",
    "onlostpointercapture",
    "onlostpointercapturecapture",
    "onmousedown",
    "onmousedowncapture",
    "onmouseenter",
    "onmouseleave",
    "onmousemove",
    "onmousemovecapture",
    "onmouseout",
    "onmouseoutcapture",
    "onmouseover",
    "onmouseovercapture",
    "onmouseup",
    "onmouseupcapture",
    "onpaste",
    "onpastecapture",
    "onpause",
    "onpausecapture",
    "onplay",
    "onplaycapture",
    "onplaying",
    "onplayingcapture",
    "onpointercancel",
    "onpointercancelcapture",
    "onpointerdown",
    "onpointerdowncapture",
    "onpointerenter",
    "onpointerentercapture",
    "onpointerleave",
    "onpointerleavecapture",
    "onpointermove",
    "onpointermovecapture",
    "onpointerout",
    "onpointeroutcapture",
    "onpointerover",
    "onpointerovercapture",
    "onpointerup",
    "onpointerupcapture",
    "onprogress",
    "onprogresscapture",
    "onratechange",
    "onratechangecapture",
    "onreset",
    "onresetcapture",
    "onresize",
    "onscroll",
    "onscrollcapture",
    "onscrollend",
    "onscrollendcapture",
    "onseeked",
    "onseekedcapture",
    "onseeking",
    "onseekingcapture",
    "onselect",
    "onselectcapture",
    "onstalled",
    "onstalledcapture",
    "onsubmit",
    "onsubmitcapture",
    "onsuspend",
    "onsuspendcapture",
    "ontimeupdate",
    "ontimeupdatecapture",
    "ontoggle",
    "ontouchcancel",
    "ontouchcancelcapture",
    "ontouchend",
    "ontouchendcapture",
    "ontouchmove",
    "ontouchmovecapture",
    "ontouchstart",
    "ontouchstartcapture",
    "ontransitionend",
    "ontransitionendcapture",
    "onvolumechange",
    "onvolumechangecapture",
    "onwaiting",
    "onwaitingcapture",
    "onwheel",
    "onwheelcapture",
    "opacity",
    "open",
    "operator",
    "optimum",
    "order",
    "orient",
    "orientation",
    "origin",
    "overflow",
    "overlineposition",
    "overlinethickness",
    "paintorder",
    "panose1",
    "part",
    "path",
    "pathlength",
    "pattern",
    "patterncontentunits",
    "patterntransform",
    "patternunits",
    "ping",
    "placeholder",
    "pointerevents",
    "points",
    "pointsatx",
    "pointsaty",
    "pointsatz",
    "popover",
    "poster",
    "preload",
    "preservealpha",
    "preserveaspectratio",
    "primitiveunits",
    "profile",
    "property",
    "r",
    "radiogroup",
    "radius",
    "readonly",
    "ref",
    "referrerpolicy",
    "refx",
    "refy",
    "rel",
    "rendering-intent",
    "repeatcount",
    "repeatdur",
    "required",
    "requiredextensions",
    "requiredfeatures",
    "restart",
    "result",
    "results",
    "reversed",
    "role",
    "rotate",
    "rows",
    "rowspan",
    "rx",
    "ry",
    "sandbox",
    "scale",
    "scope",
    "seamless",
    "security",
    "seed",
    "selected",
    "shape",
    "shaperendering",
    "size",
    "sizes",
    "slope",
    "slot",
    "spacing",
    "span",
    "specularconstant",
    "specularexponent",
    "speed",
    "spellcheck",
    "spreadmethod",
    "src",
    "srcdoc",
    "srclang",
    "srcset",
    "start",
    "startoffset",
    "stddeviation",
    "stemh",
    "stemv",
    "step",
    "stitchtiles",
    "stopcolor",
    "stopopacity",
    "strikethroughposition",
    "strikethroughthickness",
    "string",
    "stroke",
    "strokedasharray",
    "strokedashoffset",
    "strokelinecap",
    "strokelinejoin",
    "strokemiterlimit",
    "strokeopacity",
    "strokewidth",
    "style",
    "summary",
    "suppresscontenteditablewarning",
    "suppresshydrationwarning",
    "surfacescale",
    "systemlanguage",
    "tabindex",
    "tablevalues",
    "target",
    "targetx",
    "targety",
    "textanchor",
    "textdecoration",
    "textlength",
    "textrendering",
    "title",
    "to",
    "transform",
    "transformorigin",
    "translate",
    "type",
    "u1",
    "u2",
    "underlineposition",
    "underlinethickness",
    "unicode",
    "unicodebidi",
    "unicoderange",
    "unitsperem",
    "usemap",
    "valphabetic",
    "value",
    "values",
    "vectoreffect",
    "version",
    "vertadvy",
    "vertoriginx",
    "vertoriginy",
    "vhanging",
    "videographic",
    "viewbox",
    "viewtarget",
    "visibility",
    "vmathematical",
    "width",
    "widths",
    "wmode",
    "wordspacing",
    "wrap",
    "writingmode",
    "x",
    "x1",
    "x2",
    "xchannelselector",
    "xheight",
    "xlinkactuate",
    "xlinkarcrole",
    "xlinkhref",
    "xlinkrole",
    "xlinkshow",
    "xlinktitle",
    "xlinktype",
    "xmlbase",
    "xmllang",
    "xmlns",
    "xmlnsxlink",
    "xmlspace",
    "y",
    "y1",
    "y2",
    "ychannelselector",
    "z",
    "zoomandpan",
];
const STYLED_DOM_PROPERTY_TO_ALLOWED_TAGS: &[(&str, &[&str])] = &[
    ("abbr", &["th", "td"]),
    (
        "align",
        &[
            "applet", "caption", "col", "colgroup", "hr", "iframe", "img", "table", "tbody", "td",
            "tfoot", "th", "thead", "tr",
        ],
    ),
    ("allowFullScreen", &["iframe", "video"]),
    ("as", &["link"]),
    ("autoPictureInPicture", &["video"]),
    ("charset", &["meta"]),
    ("checked", &["input"]),
    ("closedby", &["dialog"]),
    ("controls", &["audio", "video"]),
    ("controlsList", &["audio", "video"]),
    (
        "crossOrigin",
        &["script", "img", "video", "audio", "link", "image"],
    ),
    ("disablePictureInPicture", &["video"]),
    ("disableRemotePlayback", &["audio", "video"]),
    ("displaystyle", &["math"]),
    ("download", &["a", "area"]),
    ("fetchPriority", &["img", "link", "script"]),
    (
        "fill",
        &[
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
            "animate",
            "animateColor",
            "animateMotion",
            "animateTransform",
            "set",
        ],
    ),
    ("focusable", &["svg"]),
    ("imageSizes", &["link"]),
    ("imageSrcSet", &["link"]),
    ("loop", &["audio", "video"]),
    ("mozAllowFullScreen", &["iframe", "video"]),
    ("muted", &["audio", "video"]),
    ("noModule", &["script"]),
    ("onAbort", &["audio", "video"]),
    ("onCancel", &["dialog"]),
    ("onCanPlay", &["audio", "video"]),
    ("onCanPlayThrough", &["audio", "video"]),
    ("onClose", &["dialog"]),
    ("onDurationChange", &["audio", "video"]),
    ("onEmptied", &["audio", "video"]),
    ("onEncrypted", &["audio", "video"]),
    ("onEnded", &["audio", "video"]),
    (
        "onError",
        &[
            "audio", "video", "img", "link", "source", "script", "picture", "iframe",
        ],
    ),
    (
        "onLoad",
        &[
            "script", "img", "link", "picture", "iframe", "object", "source", "body",
        ],
    ),
    ("onLoadedData", &["audio", "video"]),
    ("onLoadedMetadata", &["audio", "video"]),
    ("onLoadStart", &["audio", "video"]),
    ("onPause", &["audio", "video"]),
    ("onPlay", &["audio", "video"]),
    ("onPlaying", &["audio", "video"]),
    ("onProgress", &["audio", "video"]),
    ("onRateChange", &["audio", "video"]),
    ("onResize", &["audio", "video"]),
    ("onSeeked", &["audio", "video"]),
    ("onSeeking", &["audio", "video"]),
    ("onStalled", &["audio", "video"]),
    ("onSuspend", &["audio", "video"]),
    ("onTimeUpdate", &["audio", "video"]),
    ("onVolumeChange", &["audio", "video"]),
    ("onWaiting", &["audio", "video"]),
    ("playsInline", &["video"]),
    ("popoverTarget", &["button", "input"]),
    ("popoverTargetAction", &["button", "input"]),
    ("poster", &["video"]),
    ("precedence", &["style", "link"]),
    ("preload", &["audio", "video"]),
    ("property", &["meta"]),
    ("returnValue", &["dialog"]),
    ("scrolling", &["iframe"]),
    ("shadowrootclonable", &["template"]),
    ("shadowrootdelegatesfocus", &["template"]),
    ("shadowrootmode", &["template"]),
    ("shadowrootserializable", &["template"]),
    (
        "transform-origin",
        &[
            "a",
            "circle",
            "clipPath",
            "defs",
            "ellipse",
            "foreignObject",
            "g",
            "image",
            "line",
            "linearGradient",
            "marker",
            "mask",
            "path",
            "pattern",
            "polygon",
            "polyline",
            "radialGradient",
            "rect",
            "stop",
            "svg",
            "switch",
            "symbol",
            "text",
            "textPath",
            "tspan",
            "use",
        ],
    ),
    (
        "valign",
        &[
            "tr", "td", "th", "thead", "tbody", "tfoot", "colgroup", "col",
        ],
    ),
    ("viewBox", &["marker", "pattern", "svg", "symbol", "view"]),
    ("webkitAllowFullScreen", &["iframe", "video"]),
    ("webkitDirectory", &["input"]),
];

#[derive(Debug, Default, Clone)]
pub struct StyledComponentsNonTransientCustomPropOnIntrinsicElement;

declare_oxc_lint!(
    /// Disallow non-transient custom props on styled intrinsic elements.
    StyledComponentsNonTransientCustomPropOnIntrinsicElement,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow non-transient custom props on styled intrinsic elements.",
);

impl Rule for StyledComponentsNonTransientCustomPropOnIntrinsicElement {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let type_index = styled_build_type_index(ctx);
        let jsx_component_names = styled_jsx_component_names(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::TaggedTemplateExpression(template) = node.kind() else {
                continue;
            };
            let Some(tag_name) = styled_intrinsic_tag_name(&template.tag, ctx) else {
                continue;
            };
            let Some(prop_type) = template
                .type_arguments
                .as_ref()
                .and_then(|arguments| arguments.params.first())
            else {
                continue;
            };
            let Some(members) = styled_prop_type_members(prop_type, &type_index, 0, ctx) else {
                continue;
            };
            for (prop_name, span) in members {
                if styled_prop_is_forwardable(&prop_name, tag_name) {
                    continue;
                }
                if styled_local_usages_never_pass_prop(
                    node,
                    &prop_name,
                    &type_index,
                    &jsx_component_names,
                    ctx,
                ) {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "styled-components v6 forwards the custom prop `{prop_name}` to the <{tag_name}> DOM node, producing a React unknown-prop warning — prefix it with `$` to make it transient."
                    ))
                    .with_label(span),
                );
            }
        }
    }
}

fn styled_intrinsic_tag_name<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a str> {
    let base = styled_unwrap_configuration_calls(expression)?;
    let Expression::StaticMemberExpression(member) = base else {
        return None;
    };
    let property_name = member.property.name.as_str();
    if property_name
        .as_bytes()
        .first()
        .is_none_or(|byte| !byte.is_ascii_lowercase())
    {
        return None;
    }
    if styled_factory_is_styled_components(&member.object, ctx) {
        Some(property_name)
    } else {
        None
    }
}

fn styled_unwrap_configuration_calls<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a Expression<'a>> {
    let mut current = expression;
    loop {
        let Expression::CallExpression(call) = current else {
            return Some(current);
        };
        let Expression::StaticMemberExpression(member) = &call.callee else {
            return None;
        };
        match member.property.name.as_str() {
            "attrs" => current = &member.object,
            "withConfig" if styled_config_cannot_filter_props(call) => {
                current = &member.object;
            }
            _ => return None,
        }
    }
}

fn styled_config_cannot_filter_props(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    let Some(Expression::ObjectExpression(config)) = call
        .arguments
        .first()
        .and_then(|argument| argument.as_expression())
    else {
        return false;
    };
    config.properties.iter().all(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        if property.computed {
            return false;
        }
        match &property.key {
            PropertyKey::StaticIdentifier(identifier) => identifier.name != "shouldForwardProp",
            PropertyKey::StringLiteral(literal) => literal.value != "shouldForwardProp",
            _ => false,
        }
    })
}

fn styled_factory_is_styled_components<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if module_api_path_matches(expression, &[], &STYLED_COMPONENTS_MODULES, true, ctx)
        || module_api_path_matches(
            expression,
            &["styled"],
            &STYLED_COMPONENTS_MODULES,
            false,
            ctx,
        )
    {
        return true;
    }
    matches!(expression, Expression::Identifier(identifier)
        if identifier.name == "styled"
            && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}

fn styled_prop_type_members<'a>(
    type_node: &'a TSType<'a>,
    type_index: &StyledTypeIndex<'a>,
    depth: usize,
    ctx: &LintContext<'a>,
) -> Option<Vec<(String, Span)>> {
    if depth > TYPE_RESOLUTION_DEPTH_LIMIT {
        return None;
    }
    match type_node {
        TSType::TSTypeLiteral(literal) => styled_signature_members(&literal.members),
        TSType::TSIntersectionType(intersection) => {
            let mut members = Vec::new();
            for member in &intersection.types {
                members.extend(styled_prop_type_members(
                    member,
                    type_index,
                    depth + 1,
                    ctx,
                )?);
            }
            Some(members)
        }
        TSType::TSTypeReference(reference)
            if reference
                .type_arguments
                .as_ref()
                .is_none_or(|arguments| arguments.params.is_empty()) =>
        {
            let TSTypeName::IdentifierReference(identifier) = &reference.type_name else {
                return None;
            };
            let mut declarations =
                styled_same_file_type_declarations(identifier.name.as_str(), type_index);
            if declarations.is_empty()
                && let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                && let Some(declaration) =
                    styled_program_type_declaration_for_symbol(symbol_id, ctx)
            {
                declarations.push(declaration);
            }
            if declarations.is_empty() {
                return None;
            }
            let mut members = Vec::new();
            for declaration in declarations {
                members.extend(styled_declared_prop_members(
                    declaration,
                    type_index,
                    depth + 1,
                    ctx,
                )?);
            }
            Some(members)
        }
        _ => None,
    }
}

fn styled_signature_members(members: &[TSSignature<'_>]) -> Option<Vec<(String, Span)>> {
    Some(
        members
            .iter()
            .filter_map(|member| {
                let TSSignature::TSPropertySignature(property) = member else {
                    return None;
                };
                if property.computed {
                    return None;
                }
                match &property.key {
                    PropertyKey::StaticIdentifier(identifier) => {
                        Some((identifier.name.to_string(), property.span))
                    }
                    PropertyKey::StringLiteral(literal) => {
                        Some((literal.value.to_string(), property.span))
                    }
                    _ => None,
                }
            })
            .collect(),
    )
}

#[derive(Clone, Copy)]
enum StyledPropDeclaration<'a> {
    Interface(&'a oxc_ast::ast::TSInterfaceDeclaration<'a>),
    Alias(&'a oxc_ast::ast::TSTypeAliasDeclaration<'a>),
}

type StyledTypeIndex<'a> = FxHashMap<String, Vec<StyledPropDeclaration<'a>>>;

fn styled_build_type_index<'a>(ctx: &LintContext<'a>) -> StyledTypeIndex<'a> {
    let mut type_index = FxHashMap::default();
    let Some(program) = ctx.nodes().iter().find_map(|node| match node.kind() {
        AstKind::Program(program) => Some(program),
        _ => None,
    }) else {
        return type_index;
    };
    for statement in &program.body {
        let declaration = match statement {
            Statement::TSInterfaceDeclaration(declaration) => {
                StyledPropDeclaration::Interface(declaration)
            }
            Statement::TSTypeAliasDeclaration(declaration) => {
                StyledPropDeclaration::Alias(declaration)
            }
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::TSInterfaceDeclaration(declaration) => {
                    StyledPropDeclaration::Interface(declaration)
                }
                Declaration::TSTypeAliasDeclaration(declaration) => {
                    StyledPropDeclaration::Alias(declaration)
                }
                _ => continue,
            },
            _ => continue,
        };
        let name = match declaration {
            StyledPropDeclaration::Interface(declaration) => declaration.id.name.to_string(),
            StyledPropDeclaration::Alias(declaration) => declaration.id.name.to_string(),
        };
        type_index
            .entry(name)
            .or_insert_with(Vec::new)
            .push(declaration);
    }
    type_index
}

fn styled_same_file_type_declarations<'a>(
    name: &str,
    type_index: &StyledTypeIndex<'a>,
) -> Vec<StyledPropDeclaration<'a>> {
    type_index.get(name).cloned().unwrap_or_default()
}

fn styled_program_type_declaration_for_symbol<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<StyledPropDeclaration<'a>> {
    let declaration_node = ctx.symbol_declaration(symbol_id);
    let declaration = match declaration_node.kind() {
        AstKind::TSInterfaceDeclaration(declaration) => {
            StyledPropDeclaration::Interface(declaration)
        }
        AstKind::TSTypeAliasDeclaration(declaration) => StyledPropDeclaration::Alias(declaration),
        _ => return None,
    };
    ctx.nodes()
        .iter()
        .find_map(|node| match node.kind() {
            AstKind::Program(program) => Some(program),
            _ => None,
        })?
        .body
        .iter()
        .any(|statement| {
            styled_statement_contains_type_declaration(statement, declaration_node.span())
        })
        .then_some(declaration)
}

fn styled_statement_contains_type_declaration(statement: &Statement<'_>, span: Span) -> bool {
    match statement {
        Statement::TSInterfaceDeclaration(declaration) => declaration.span == span,
        Statement::TSTypeAliasDeclaration(declaration) => declaration.span == span,
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::TSInterfaceDeclaration(declaration) => declaration.span == span,
            Declaration::TSTypeAliasDeclaration(declaration) => declaration.span == span,
            _ => false,
        },
        _ => false,
    }
}

fn styled_declared_prop_members<'a>(
    declaration: StyledPropDeclaration<'a>,
    type_index: &StyledTypeIndex<'a>,
    depth: usize,
    ctx: &LintContext<'a>,
) -> Option<Vec<(String, Span)>> {
    if depth > TYPE_RESOLUTION_DEPTH_LIMIT {
        return None;
    }
    match declaration {
        StyledPropDeclaration::Alias(alias) => {
            if alias
                .type_parameters
                .as_ref()
                .is_some_and(|parameters| !parameters.params.is_empty())
            {
                return None;
            }
            styled_prop_type_members(&alias.type_annotation, type_index, depth + 1, ctx)
        }
        StyledPropDeclaration::Interface(interface) => {
            if interface
                .type_parameters
                .as_ref()
                .is_some_and(|parameters| !parameters.params.is_empty())
            {
                return None;
            }
            let mut members = styled_signature_members(&interface.body.body)?;
            for heritage in &interface.extends {
                if heritage
                    .type_arguments
                    .as_ref()
                    .is_some_and(|arguments| !arguments.params.is_empty())
                {
                    continue;
                }
                let TSTypeName::IdentifierReference(identifier) = &heritage.type_name else {
                    continue;
                };
                for inherited in
                    styled_same_file_type_declarations(identifier.name.as_str(), type_index)
                {
                    if let Some(inherited_members) =
                        styled_declared_prop_members(inherited, type_index, depth + 1, ctx)
                    {
                        members.extend(inherited_members);
                    }
                }
            }
            Some(members)
        }
    }
}

fn styled_prop_is_forwardable(prop_name: &str, tag_name: &str) -> bool {
    if prop_name.starts_with('$')
        || prop_name.starts_with("data-")
        || prop_name.starts_with("aria-")
        || matches!(prop_name, "theme" | "as" | "forwardedAs")
    {
        return true;
    }
    if prop_name == "selected" {
        return tag_name == "option";
    }
    if let Some((_, allowed_tags)) = STYLED_DOM_PROPERTY_TO_ALLOWED_TAGS
        .iter()
        .find(|(property_name, _)| *property_name == prop_name)
    {
        return allowed_tags.contains(&tag_name);
    }
    let lowercase_prop_name = prop_name.to_ascii_lowercase();
    STYLED_DOM_PROPERTY_NAMES_LOWER
        .binary_search(&lowercase_prop_name.as_str())
        .is_ok()
}

fn styled_local_usages_never_pass_prop(
    template_node: &AstNode<'_>,
    prop_name: &str,
    type_index: &StyledTypeIndex<'_>,
    jsx_component_names: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    let declarator_node = ctx.nodes().parent_node(template_node.id());
    let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
        return false;
    };
    let Some(binding) = declarator.id.get_binding_identifier() else {
        return false;
    };
    if styled_symbol_is_exported(binding.symbol_id(), ctx) {
        return false;
    }
    let references = ctx
        .scoping()
        .get_resolved_references(binding.symbol_id())
        .collect::<Vec<_>>();
    if references.is_empty() {
        return jsx_component_names.contains(binding.name.as_str());
    }
    if type_index.contains_key(binding.name.as_str())
        && references.iter().all(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let parent = ctx.nodes().parent_node(reference_node.id());
            match parent.kind() {
                AstKind::JSXOpeningElement(opening) => opening.name.span() == reference_node.span(),
                AstKind::JSXClosingElement(closing) => closing.name.span() == reference_node.span(),
                AstKind::TSTypeReference(_) => template_node
                    .span()
                    .contains_inclusive(reference_node.span()),
                _ => false,
            }
        })
    {
        return jsx_component_names.contains(binding.name.as_str());
    }
    let mut saw_jsx_usage = false;
    for reference in references {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let parent = ctx.nodes().parent_node(reference_node.id());
        let AstKind::JSXOpeningElement(opening) = parent.kind() else {
            return false;
        };
        let JSXElementName::IdentifierReference(opening_name) = &opening.name else {
            return false;
        };
        if opening_name.span != reference_node.span() {
            return false;
        }
        saw_jsx_usage = true;
        for attribute in &opening.attributes {
            match attribute {
                JSXAttributeItem::Attribute(attribute) if matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == prop_name) =>
                {
                    return false;
                }
                JSXAttributeItem::SpreadAttribute(spread)
                    if !styled_spread_excludes_prop(&spread.argument, prop_name, ctx) =>
                {
                    return false;
                }
                _ => {}
            }
        }
    }
    saw_jsx_usage
}

fn styled_symbol_is_exported(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    if !ctx
        .scoping()
        .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
        .is_top()
    {
        return false;
    }
    let symbol_name = ctx.scoping().symbol_name(symbol_id);
    ctx.module_record()
        .local_export_entries
        .iter()
        .any(|entry| !entry.is_type && entry.local_name.name() == Some(symbol_name))
}

fn styled_jsx_component_names(ctx: &LintContext<'_>) -> FxHashSet<String> {
    ctx.nodes()
        .iter()
        .filter_map(|node| {
            let AstKind::JSXOpeningElement(opening) = node.kind() else {
                return None;
            };
            match &opening.name {
                JSXElementName::IdentifierReference(identifier) => {
                    Some(identifier.name.to_string())
                }
                JSXElementName::Identifier(identifier) => Some(identifier.name.to_string()),
                _ => None,
            }
        })
        .collect()
}

fn styled_spread_excludes_prop(
    expression: &Expression<'_>,
    prop_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let reference = ctx.scoping().get_reference(identifier.reference_id());
    let Some(symbol_id) = reference.symbol_id() else {
        return false;
    };
    let reference_node = ctx.nodes().get_node(reference.node_id());
    std::iter::once(reference_node)
        .chain(ctx.nodes().ancestors(reference_node.id()))
        .any(|ancestor| match ancestor.kind() {
            AstKind::ArrowFunctionExpression(function) => {
                function.params.items.iter().any(|parameter| {
                    styled_object_rest_excludes_prop(&parameter.pattern, symbol_id, prop_name)
                })
            }
            AstKind::Function(function) => function.params.items.iter().any(|parameter| {
                styled_object_rest_excludes_prop(&parameter.pattern, symbol_id, prop_name)
            }),
            AstKind::VariableDeclarator(declarator) => {
                styled_object_rest_excludes_prop(&declarator.id, symbol_id, prop_name)
            }
            _ => false,
        })
}

fn styled_object_rest_excludes_prop(
    pattern: &BindingPattern<'_>,
    rest_symbol_id: SymbolId,
    prop_name: &str,
) -> bool {
    let BindingPattern::ObjectPattern(object) = pattern else {
        return false;
    };
    object.rest.as_ref().is_some_and(|rest| {
        rest.argument
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == rest_symbol_id)
    }) && object.properties.iter().any(|property| {
        !property.computed
            && matches!(&property.key, PropertyKey::StaticIdentifier(identifier)
                    if identifier.name == prop_name)
    })
}
