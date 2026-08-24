const MOTION_ANIMATE_PROPERTY_NAMES: [&str; 8] = [
    "animate",
    "initial",
    "exit",
    "whileHover",
    "whileTap",
    "whileFocus",
    "whileDrag",
    "whileInView",
];
const MOTION_FACTORY_MODULE_SOURCES: [&str; 2] = ["framer-motion", "motion/react"];
const MOTION_FACTORY_EXPORT_NAMES: [&str; 2] = ["m", "motion"];

fn get_static_motion_transition_objects<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &'b crate::context::LintContext<'a>,
) -> Vec<&'b oxc_ast::ast::ObjectExpression<'a>> {
    if !is_proven_motion_jsx_element(&opening_element.name, ctx) {
        return Vec::new();
    }
    let mut transition_objects = Vec::new();
    if let Some(transition_object) =
        get_static_motion_property_object(opening_element, "transition")
    {
        transition_objects.push(transition_object);
    }
    for animation_property_name in MOTION_ANIMATE_PROPERTY_NAMES {
        let Some(animation_object) =
            get_static_motion_property_object(opening_element, animation_property_name)
        else {
            continue;
        };
        let Some(transition_property) =
            get_effective_motion_object_property(animation_object, "transition")
        else {
            continue;
        };
        let oxc_ast::ast::Expression::ObjectExpression(transition_object) =
            &transition_property.value
        else {
            continue;
        };
        transition_objects.push(transition_object);
    }
    transition_objects
}

fn get_effective_motion_object_property<'a, 'b>(
    object_expression: &'b oxc_ast::ast::ObjectExpression<'a>,
    target_name: &str,
) -> Option<&'b oxc_ast::ast::ObjectProperty<'a>> {
    for property in object_expression.properties.iter().rev() {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(object_property) = property else {
            return None;
        };
        let Some(property_name) = object_property.key.static_name() else {
            return None;
        };
        if property_name == target_name {
            return Some(object_property);
        }
    }
    None
}

fn get_static_motion_property_object<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    property_name: &str,
) -> Option<&'b oxc_ast::ast::ObjectExpression<'a>> {
    let attribute = get_authoritative_jsx_attribute(opening_element, property_name, true)?;
    let oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) =
        attribute.value.as_ref()?
    else {
        return None;
    };
    let oxc_ast::ast::JSXExpression::ObjectExpression(object_expression) = &container.expression
    else {
        return None;
    };
    Some(object_expression)
}

fn is_proven_motion_jsx_element(
    element_name: &oxc_ast::ast::JSXElementName,
    ctx: &crate::context::LintContext,
) -> bool {
    let oxc_ast::ast::JSXElementName::MemberExpression(member_expression) = element_name else {
        return false;
    };
    is_motion_factory_object(&member_expression.object, ctx)
}

fn is_motion_factory_object(
    object: &oxc_ast::ast::JSXMemberExpressionObject,
    ctx: &crate::context::LintContext,
) -> bool {
    match object {
        oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            ctx.module_record().import_entries.iter().any(|entry| {
                !entry.is_type
                    && MOTION_FACTORY_MODULE_SOURCES.contains(&entry.module_request.name())
                    && ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == Some(symbol_id)
                    && matches!(
                        &entry.import_name,
                        crate::module_record::ImportImportName::Name(imported_name)
                            if MOTION_FACTORY_EXPORT_NAMES.contains(&imported_name.name())
                    )
            })
        }
        oxc_ast::ast::JSXMemberExpressionObject::MemberExpression(member_expression) => {
            if !MOTION_FACTORY_EXPORT_NAMES.contains(&member_expression.property.name.as_str()) {
                return false;
            }
            let oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return false;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            ctx.module_record().import_entries.iter().any(|entry| {
                !entry.is_type
                    && MOTION_FACTORY_MODULE_SOURCES.contains(&entry.module_request.name())
                    && ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == Some(symbol_id)
                    && matches!(
                        entry.import_name,
                        crate::module_record::ImportImportName::NamespaceObject
                    )
            })
        }
        _ => false,
    }
}
