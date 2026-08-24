fn resolve_jsx_import_api_path<'a>(
    element_name: &oxc_ast::ast::JSXElementName<'a>,
    module_source_matches: impl Fn(&str) -> bool,
    ctx: &crate::context::LintContext<'a>,
) -> Option<Vec<String>> {
    use oxc_ast::ast::{JSXElementName, JSXMemberExpressionObject};

    let mut member_path = Vec::new();
    let root_identifier = match element_name {
        JSXElementName::IdentifierReference(identifier) => identifier,
        JSXElementName::MemberExpression(member_expression) => {
            let mut current_member = member_expression;
            member_path.push(current_member.property.name.to_string());
            loop {
                match &current_member.object {
                    JSXMemberExpressionObject::IdentifierReference(identifier) => {
                        member_path.reverse();
                        break identifier;
                    }
                    JSXMemberExpressionObject::MemberExpression(parent_member) => {
                        current_member = parent_member;
                        member_path.push(current_member.property.name.to_string());
                    }
                    JSXMemberExpressionObject::ThisExpression(_) => return None,
                }
            }
        }
        _ => return None,
    };
    let import_entry = resolve_identifier_import(root_identifier, ctx)?;
    if !module_source_matches(import_entry.module_request.name()) {
        return None;
    }
    match &import_entry.import_name {
        crate::module_record::ImportImportName::Name(imported_name) => {
            member_path.insert(0, imported_name.name().to_string());
        }
        crate::module_record::ImportImportName::Default(_) => {
            member_path.insert(0, "default".to_string());
        }
        crate::module_record::ImportImportName::NamespaceObject => {}
    }
    Some(member_path)
}
