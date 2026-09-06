fn get_implicit_role<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    element_type: &str,
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'static str> {
    match element_type {
        "a" | "area" | "link" => crate::utils::has_jsx_prop_ignore_case(opening_element, "href")
            .is_some()
            .then_some("link"),
        "article" => Some("article"),
        "aside" => Some("complementary"),
        "body" => Some("document"),
        "button" => Some("button"),
        "datalist" | "select" => Some("listbox"),
        "details" => Some("group"),
        "dialog" => Some("dialog"),
        "form" => Some("form"),
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => Some("heading"),
        "hr" => Some("separator"),
        "img" => image_implicit_role(opening_element),
        "input" => input_implicit_role(opening_element, ctx),
        "li" => Some("listitem"),
        "menu" => (get_plain_string_prop_value_for_implicit_role(opening_element, "type")
            == Some("toolbar"))
        .then_some("toolbar"),
        "menuitem" => {
            match get_plain_string_prop_value_for_implicit_role(opening_element, "type") {
                Some("checkbox") => Some("menuitemcheckbox"),
                Some("command") => Some("menuitem"),
                Some("radio") => Some("menuitemradio"),
                _ => None,
            }
        }
        "meter" | "progress" => Some("progressbar"),
        "nav" => Some("navigation"),
        "ol" | "ul" => Some("list"),
        "option" => Some("option"),
        "output" => Some("status"),
        "section" => Some("region"),
        "tbody" | "tfoot" | "thead" => Some("rowgroup"),
        "textarea" => Some("textbox"),
        _ => None,
    }
}

fn image_implicit_role(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> Option<&'static str> {
    let Some(attribute) = get_first_implicit_role_jsx_attribute(opening_element, "alt") else {
        return Some("img");
    };
    match attribute.value.as_ref() {
        Some(oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal))
            if string_literal.value.is_empty() =>
        {
            None
        }
        _ => Some("img"),
    }
}

fn input_implicit_role<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<&'static str> {
    let Some(type_attribute) = get_first_implicit_role_jsx_attribute(opening_element, "type")
    else {
        return Some("textbox");
    };
    let input_type_values = get_static_jsx_attribute_string_values(type_attribute, ctx)?;
    let mut implicit_role = None;
    for input_type in input_type_values {
        let candidate_role = match input_type.to_ascii_lowercase().as_str() {
            "button" | "image" | "reset" | "submit" => "button",
            "checkbox" => "checkbox",
            "number" => "spinbutton",
            "radio" => "radio",
            "range" => "slider",
            _ => "textbox",
        };
        if implicit_role.is_some_and(|role| role != candidate_role) {
            return None;
        }
        implicit_role = Some(candidate_role);
    }
    implicit_role
}

fn get_plain_string_prop_value_for_implicit_role<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    attribute_name: &str,
) -> Option<&'a str> {
    let attribute = get_first_implicit_role_jsx_attribute(opening_element, attribute_name)?;
    let oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal) =
        attribute.value.as_ref()?
    else {
        return None;
    };
    Some(string_literal.value.as_str())
}

fn get_first_implicit_role_jsx_attribute<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    attribute_name: &str,
) -> Option<&'b oxc_ast::ast::JSXAttribute<'a>> {
    opening_element.attributes.iter().find_map(|attribute| {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
            return None;
        };
        matches!(
            &attribute.name,
            oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                if identifier.name.eq_ignore_ascii_case(attribute_name)
        )
        .then_some(&**attribute)
    })
}
