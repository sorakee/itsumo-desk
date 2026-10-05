//! Display names (D44): the default name of a wrapped model and the rules for aliases.

/// The longest alias, in characters. Mirrored by `MAX_NAME_LENGTH` in the settings window.
pub const MAX_DISPLAY_NAME_CHARS: usize = 64;

/// A readable name for a model file stem: `hiyori_pro_t11` becomes `hiyori pro t11`.
pub fn from_stem(stem: &str) -> String {
    let name = stem
        .split(|c: char| c == '_' || c == '-' || c.is_whitespace())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if name.is_empty() {
        stem.to_owned()
    } else {
        name
    }
}

/// Checks an alias the user typed. A blank one is `Ok(None)`: the pack's own name applies.
pub fn display_name(raw: &str) -> Result<Option<String>, &'static str> {
    let name = raw.trim();
    if name.is_empty() {
        return Ok(None);
    }
    if name.chars().any(char::is_control) {
        return Err("a name cannot contain line breaks or control characters");
    }
    if name.chars().count() > MAX_DISPLAY_NAME_CHARS {
        return Err("a name can be at most 64 characters long");
    }
    Ok(Some(name.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stems_lose_separators() {
        assert_eq!(from_stem("hiyori_pro_t11"), "hiyori pro t11");
        assert_eq!(from_stem("mao-pro__en"), "mao pro en");
        assert_eq!(from_stem("阿库露(礼服)"), "阿库露(礼服)");
        // Nothing but separators: keep what there was rather than an empty name.
        assert_eq!(from_stem("__"), "__");
    }

    #[test]
    fn display_names_are_trimmed_and_checked() {
        assert_eq!(display_name("  Hiyori  "), Ok(Some("Hiyori".into())));
        assert_eq!(display_name(" \t "), Ok(None));
        assert!(display_name("two\nlines").is_err());
        assert!(display_name("bell\u{7}").is_err());
        let longest = "あ".repeat(MAX_DISPLAY_NAME_CHARS);
        assert_eq!(display_name(&longest), Ok(Some(longest.clone())));
        assert!(display_name(&format!("{longest}a")).is_err());
    }
}
