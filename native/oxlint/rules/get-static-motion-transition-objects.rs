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
fn get_static_motion_transition_objects<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &'b crate::context::LintContext<'a>,
) -> Vec<&'b oxc_ast::ast::ObjectExpression<'a>> {
    if !is_proven_motion_jsx_element(&opening_element.name, ctx) {
        return Vec::new();
    }
    let mut transition_objects = Vec::new();
    if let Some(transition_object) =
        get_static_motion_property_object(opening_element, "transition", ctx)
    {
        transition_objects.push(transition_object);
    }
    for animation_property_name in MOTION_ANIMATE_PROPERTY_NAMES {
        let Some(animation_object) =
            get_static_motion_property_object(opening_element, animation_property_name, ctx)
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
