use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};
use oxc_ast::{
    AstKind,
    ast::{Expression, ObjectExpression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

#[derive(Debug, Default, Clone)]
pub struct NextjsMetadataUrlConsistency;
declare_oxc_lint!(
    /// Require canonical and Open Graph metadata URLs to agree.
    NextjsMetadataUrlConsistency,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require canonical and Open Graph URLs to agree."
);

impl Rule for NextjsMetadataUrlConsistency {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        is_next_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            return;
        };
        let Some(identifier) = declarator.id.get_binding_identifier() else {
            return;
        };
        if identifier.name != "metadata" || !nextjs_metadata_page_or_layout(ctx) {
            return;
        }
        let declaration = ctx.nodes().parent_node(node.id());
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::ExportDeclaration(_)
        ) {
            return;
        }
        let Some(Expression::ObjectExpression(metadata)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            return;
        };
        let Some((_, Expression::ObjectExpression(alternates))) =
            nextjs_metadata_property(metadata, "alternates")
        else {
            return;
        };
        let Some((_, Expression::ObjectExpression(open_graph))) =
            nextjs_metadata_property(metadata, "openGraph")
        else {
            return;
        };
        let Some((_, Expression::StringLiteral(canonical))) =
            nextjs_metadata_property(alternates, "canonical")
        else {
            return;
        };
        let Some((url_property, Expression::StringLiteral(open_graph_url))) =
            nextjs_metadata_property(open_graph, "url")
        else {
            return;
        };
        if nextjs_metadata_normalize_url(canonical.value.as_str())
            == nextjs_metadata_normalize_url(open_graph_url.value.as_str())
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(format!("openGraph.url is \"{}\" but the canonical URL is \"{}\", so social previews and search metadata identify different pages.", open_graph_url.value, canonical.value)).with_label(url_property.span()));
    }
}

fn nextjs_metadata_page_or_layout(ctx: &LintContext<'_>) -> bool {
    let path = ctx.file_path().to_string_lossy().replace('\\', "/");
    ["page", "layout"].iter().any(|name| {
        ["js", "jsx", "ts", "tsx", "mjs", "mts"]
            .iter()
            .any(|extension| path.ends_with(&format!("/{name}.{extension}")))
    })
}

fn nextjs_metadata_property<'a>(
    object: &'a ObjectExpression<'a>,
    name: &str,
) -> Option<(&'a oxc_ast::ast::ObjectProperty<'a>, &'a Expression<'a>)> {
    for property in object.properties.iter().rev() {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        let Some(property_name) = property.key.static_name() else {
            return None;
        };
        if property_name == name {
            return Some((property, property.value.get_inner_expression()));
        }
    }
    None
}

fn nextjs_metadata_normalize_url(value: &str) -> String {
    if let Ok(mut parsed_url) = url::Url::parse(value) {
        let pathname = parsed_url.path();
        let trimmed_pathname = (pathname.len() > 1 && pathname.ends_with('/'))
            .then(|| pathname[..pathname.len() - 1].to_string());
        if let Some(trimmed_pathname) = trimmed_pathname {
            parsed_url.set_path(&trimmed_pathname);
        }
        return parsed_url.to_string();
    }
    if value == "/" {
        value.to_string()
    } else {
        value.strip_suffix('/').unwrap_or(value).to_string()
    }
}
