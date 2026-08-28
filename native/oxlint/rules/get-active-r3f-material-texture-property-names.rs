const R3F_UV_TEXTURE_PROPERTY_NAMES_BY_MATERIAL: [(&str, &[&str]); 10] = [
    (
        "MeshBasicMaterial",
        &["alphaMap", "aoMap", "lightMap", "map", "specularMap"],
    ),
    ("MeshDepthMaterial", &["alphaMap", "displacementMap", "map"]),
    (
        "MeshDistanceMaterial",
        &["alphaMap", "displacementMap", "map"],
    ),
    (
        "MeshLambertMaterial",
        &[
            "alphaMap",
            "aoMap",
            "bumpMap",
            "displacementMap",
            "emissiveMap",
            "lightMap",
            "map",
            "normalMap",
            "specularMap",
        ],
    ),
    (
        "MeshMatcapMaterial",
        &["alphaMap", "bumpMap", "displacementMap", "map", "normalMap"],
    ),
    (
        "MeshNormalMaterial",
        &["bumpMap", "displacementMap", "normalMap"],
    ),
    (
        "MeshPhongMaterial",
        &[
            "alphaMap",
            "aoMap",
            "bumpMap",
            "displacementMap",
            "emissiveMap",
            "lightMap",
            "map",
            "normalMap",
            "specularMap",
        ],
    ),
    (
        "MeshPhysicalMaterial",
        &[
            "alphaMap",
            "anisotropyMap",
            "aoMap",
            "bumpMap",
            "clearcoatMap",
            "clearcoatNormalMap",
            "clearcoatRoughnessMap",
            "displacementMap",
            "emissiveMap",
            "iridescenceMap",
            "iridescenceThicknessMap",
            "lightMap",
            "map",
            "metalnessMap",
            "normalMap",
            "roughnessMap",
            "sheenColorMap",
            "sheenRoughnessMap",
            "specularColorMap",
            "specularIntensityMap",
            "thicknessMap",
            "transmissionMap",
        ],
    ),
    (
        "MeshStandardMaterial",
        &[
            "alphaMap",
            "aoMap",
            "bumpMap",
            "displacementMap",
            "emissiveMap",
            "lightMap",
            "map",
            "metalnessMap",
            "normalMap",
            "roughnessMap",
        ],
    ),
    (
        "MeshToonMaterial",
        &[
            "alphaMap",
            "aoMap",
            "bumpMap",
            "displacementMap",
            "emissiveMap",
            "lightMap",
            "map",
            "normalMap",
        ],
    ),
];

fn get_active_r3f_material_texture_property_names<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    material_constructor_name: &str,
) -> Vec<&'static str> {
    let Some((_, texture_property_names)) = R3F_UV_TEXTURE_PROPERTY_NAMES_BY_MATERIAL
        .iter()
        .find(|(constructor_name, _)| *constructor_name == material_constructor_name)
    else {
        return Vec::new();
    };
    texture_property_names
        .iter()
        .copied()
        .filter(|property_name| {
            get_authoritative_jsx_attribute(opening_element, property_name, true).is_some_and(
                |attribute| {
                    jsx_attribute_expression(attribute)
                        .is_none_or(|expression| !is_nullish_expression(expression))
                },
            )
        })
        .collect()
}
