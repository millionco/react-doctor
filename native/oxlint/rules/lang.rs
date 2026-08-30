use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeValue, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::has_jsx_prop_ignore_case,
};

const MESSAGE: &str = "Screen readers can't pick the right voice because this `lang` isn't a real language code, so use a valid one like `en` or `en-US`.";
const COMMON_LANGUAGE_PRIMARY_TAGS: &str = "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu";
const ISO_639_THREE_LETTER_PRIMARY_TAGS: &str = "ace ach ada ady ain akk ale alt ang anp arb arc arn arp arw ast awa bal ban bas bej bem ber bho bik bin bla bra bua bug byn cad car cdo ceb chb chg chk chm chn cho chp chr chy cjy cmn cnr cop cpx cre crh csb czh czo dak dar del den dgr din doi dsb dua dum dyu dzo efi egy eka elx enm ewo fan fat fil fon frm fro frr frs fur gaa gan gay gba gez gil gmh goh gon gor got grb grc gsw gwi hai hak haw hil hit hmn hsb hsn hup iba ido inh jbo jpr jrb kaa kab kac kam kar kaw kbd kha kho kmb kok kos kpe krc krl kru kum kut lad lah lam lez lol loz lua lui lun luo lus lzh mad mag mai mak man mas mdf mdr men mga mic min mlg mnc mni mnp moh mos mus mwl mwr myv nah nan nap nds new nia niu nog non nqo nso nub nwc nym nyn nyo nzi osa ota pag pal pam pap pau peo pes phn pnb pon pro prs raj rap rar rom rup sad sah sam sas sat scn sco sel sga shn sid sma smj smn sms snk sog son srn srr suk sus sux swh syc syr tem ter tet tig tiv tkl tlh tli tmh tog tpi tsi tum tvl tyv udm uga umb vai vot wal war was wen wuu xal yao yap yue zap zen zgh zsm zun zza";
const GRANDFATHERED_PRIMARY_TAGS: [&str; 4] = ["i", "art", "cel", "sgn"];

#[derive(Debug, Default, Clone)]
pub struct Lang;

declare_oxc_lint!(
    /// Validates the lang attribute on HTML root elements.
    Lang,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Invalid lang attribute value.",
);

impl Rule for Lang {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_configured_jsx_element_type(opening_element, ctx) != "html" {
            return;
        }
        let Some(attribute) = has_jsx_prop_ignore_case(opening_element, "lang")
            .and_then(JSXAttributeItem::as_attribute)
        else {
            return;
        };
        if matches!(
            attribute.value.as_ref(),
            Some(JSXAttributeValue::ExpressionContainer(container))
                if matches!(
                    &container.expression,
                    JSXExpression::Identifier(identifier) if identifier.name == "undefined"
                ) || matches!(&container.expression, JSXExpression::NullLiteral(_))
        ) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
            return;
        }
        let Some(JSXAttributeValue::StringLiteral(value)) = attribute.value.as_ref() else {
            return;
        };
        if !is_valid_lang_tag(value.value.as_str()) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
        }
    }
}

fn is_valid_lang_tag(value: &str) -> bool {
    let mut parts = value.split(['-', '_']);
    let Some(primary) = parts.next() else {
        return false;
    };
    if primary.is_empty() || !is_known_primary_subtag(&primary.to_ascii_lowercase()) {
        return false;
    }
    std::iter::once(primary)
        .chain(parts)
        .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_alphanumeric()))
}

fn is_known_primary_subtag(primary: &str) -> bool {
    COMMON_LANGUAGE_PRIMARY_TAGS
        .split_ascii_whitespace()
        .chain(ISO_639_THREE_LETTER_PRIMARY_TAGS.split_ascii_whitespace())
        .chain(GRANDFATHERED_PRIMARY_TAGS)
        .any(|candidate| candidate == primary)
}
