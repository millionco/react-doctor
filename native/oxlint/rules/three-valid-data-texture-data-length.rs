use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, AstNode};

const STORAGE_DATA_TEXTURE_CONSTRUCTOR_NAMES: [&str; 3] =
    ["DataTexture", "Data3DTexture", "DataArrayTexture"];
const DATA_TEXTURE_FORMAT_COMPONENT_COUNTS: [(&str, f64); 10] = [
    ("AlphaFormat", 1.0),
    ("LuminanceFormat", 1.0),
    ("LuminanceAlphaFormat", 2.0),
    ("RedFormat", 1.0),
    ("RedIntegerFormat", 1.0),
    ("RGFormat", 2.0),
    ("RGIntegerFormat", 2.0),
    ("RGBFormat", 3.0),
    ("RGBAFormat", 4.0),
    ("RGBAIntegerFormat", 4.0),
];
const DATA_TEXTURE_UNPACKED_TYPE_NAMES: [&str; 8] = [
    "ByteType",
    "FloatType",
    "HalfFloatType",
    "IntType",
    "ShortType",
    "UnsignedByteType",
    "UnsignedIntType",
    "UnsignedShortType",
];
const DATA_TEXTURE_DATA_ARGUMENT_INDEX: usize = 0;
const DATA_TEXTURE_WIDTH_ARGUMENT_INDEX: usize = 1;
const DATA_TEXTURE_HEIGHT_ARGUMENT_INDEX: usize = 2;
const DATA_TEXTURE_DEPTH_ARGUMENT_INDEX: usize = 3;
const DATA_TEXTURE_FORMAT_ARGUMENT_INDEX: usize = 3;
const DATA_VOLUME_TEXTURE_FORMAT_ARGUMENT_INDEX: usize = 4;
const DATA_TEXTURE_TYPE_ARGUMENT_INDEX: usize = 4;
const DATA_VOLUME_TEXTURE_TYPE_ARGUMENT_INDEX: usize = 5;
const DEFAULT_DATA_TEXTURE_DIMENSION_PX: f64 = 1.0;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidDataTextureDataLength;

declare_oxc_lint!(
    /// Require enough static storage for Three.js data textures.
    ThreeValidDataTextureDataLength,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js data texture storage length.",
);

impl Rule for ThreeValidDataTextureDataLength {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::NewExpression(new_expression) = node.kind() else {
            return;
        };
        let Some(constructor_name) = three_module_api_name(&new_expression.callee, ctx) else {
            return;
        };
        if !STORAGE_DATA_TEXTURE_CONSTRUCTOR_NAMES.contains(&constructor_name.as_str()) {
            return;
        }
        let is_volume = constructor_name != "DataTexture";
        let Some(data_expression) = new_expression
            .arguments
            .get(DATA_TEXTURE_DATA_ARGUMENT_INDEX)
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        if matches!(
            data_expression.get_inner_expression(),
            oxc_ast::ast::Expression::NullLiteral(_)
        ) {
            return;
        }
        let Some(data_length) = resolve_static_array_like_length(data_expression, ctx) else {
            return;
        };
        let Some(width) = resolve_data_texture_dimension(
            new_expression
                .arguments
                .get(DATA_TEXTURE_WIDTH_ARGUMENT_INDEX),
            ctx,
        ) else {
            return;
        };
        let Some(height) = resolve_data_texture_dimension(
            new_expression
                .arguments
                .get(DATA_TEXTURE_HEIGHT_ARGUMENT_INDEX),
            ctx,
        ) else {
            return;
        };
        let depth = if is_volume {
            let Some(depth) = resolve_data_texture_dimension(
                new_expression
                    .arguments
                    .get(DATA_TEXTURE_DEPTH_ARGUMENT_INDEX),
                ctx,
            ) else {
                return;
            };
            depth
        } else {
            DEFAULT_DATA_TEXTURE_DIMENSION_PX
        };
        if [width, height, depth]
            .iter()
            .any(|dimension| dimension.fract() != 0.0 || *dimension <= 0.0)
        {
            return;
        }
        let format_argument_index = if is_volume {
            DATA_VOLUME_TEXTURE_FORMAT_ARGUMENT_INDEX
        } else {
            DATA_TEXTURE_FORMAT_ARGUMENT_INDEX
        };
        let format_name = new_expression
            .arguments
            .get(format_argument_index)
            .and_then(oxc_ast::ast::Argument::as_expression)
            .map(|expression| three_module_api_name(expression, ctx))
            .unwrap_or_else(|| Some("RGBAFormat".to_string()));
        let Some(format_name) = format_name else {
            return;
        };
        let Some(component_count) = DATA_TEXTURE_FORMAT_COMPONENT_COUNTS.iter().find_map(
            |(expected_name, component_count)| {
                (*expected_name == format_name).then_some(*component_count)
            },
        ) else {
            return;
        };
        let type_argument_index = if is_volume {
            DATA_VOLUME_TEXTURE_TYPE_ARGUMENT_INDEX
        } else {
            DATA_TEXTURE_TYPE_ARGUMENT_INDEX
        };
        if let Some(type_argument) = new_expression.arguments.get(type_argument_index) {
            let Some(type_expression) = type_argument.as_expression() else {
                return;
            };
            let Some(type_name) = three_module_api_name(type_expression, ctx) else {
                return;
            };
            if !DATA_TEXTURE_UNPACKED_TYPE_NAMES.contains(&type_name.as_str()) {
                return;
            }
        }
        let required_length = width * height * depth * component_count;
        if data_length >= required_length {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This data texture needs at least {required_length} array elements for {width} × {height} × {depth} texels in {format_name}, but the static buffer has {data_length}"
            ))
            .with_label(data_expression.span()),
        );
    }
}

fn resolve_data_texture_dimension<'a>(
    argument: Option<&'a oxc_ast::ast::Argument<'a>>,
    ctx: &LintContext<'a>,
) -> Option<f64> {
    let Some(expression) = argument.and_then(oxc_ast::ast::Argument::as_expression) else {
        return Some(DEFAULT_DATA_TEXTURE_DIMENSION_PX);
    };
    resolve_static_number(expression, ctx)
}
