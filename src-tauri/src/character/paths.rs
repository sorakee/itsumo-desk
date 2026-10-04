//! Path and id rules shared by pack validation, import and the `character` URI scheme. Pack
//! contents come from third parties, so every file reference goes through here.

const MAX_ID_LEN: usize = 64;
/// Leaves room for a `-NN` suffix when a slug is taken.
const MAX_SLUG_LEN: usize = 48;
const FALLBACK_ID: &str = "character";

/// Names Windows maps to devices in any folder, with or without an extension.
const DEVICE_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Whether `segment` is a plain file or folder name: not empty, not `.`/`..`, no separators,
/// no `:` (drives and alternate data streams) and not a device name.
pub fn is_plain_segment(segment: &str) -> bool {
    if segment.is_empty() || segment == "." || segment == ".." {
        return false;
    }
    if segment.contains(['/', '\\', ':', '\0']) {
        return false;
    }
    let stem = segment.split('.').next().unwrap_or(segment).trim_end();
    !DEVICE_NAMES
        .iter()
        .any(|device| stem.eq_ignore_ascii_case(device))
}

/// Normalises a file reference to a relative path with `/` separators, or `None` if it is
/// absolute, has a URL scheme or drive, climbs out with `..`, or names a device. Mirrors
/// `safeRelativePath` in `src/live2d/modelSettings.ts`, plus the Windows-only rules.
pub fn safe_relative_path(raw: &str) -> Option<String> {
    if raw.trim().is_empty() {
        return None;
    }
    let path = raw.replace('\\', "/");
    if path.starts_with('/') {
        return None;
    }
    let mut segments = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => continue,
            segment if is_plain_segment(segment) => segments.push(segment),
            _ => return None,
        }
    }
    (!segments.is_empty()).then(|| segments.join("/"))
}

/// Pack ids double as folder names and URL segments.
pub fn is_valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    id.len() <= MAX_ID_LEN
        && (first.is_ascii_lowercase() || first.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// A pack id derived from a display name. Names without ASCII letters or digits (e.g. CJK
/// model names) fall back to a generic id.
pub fn slugify(name: &str) -> String {
    let mut slug = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
        if slug.len() >= MAX_SLUG_LEN {
            break;
        }
    }
    let slug = slug.trim_end_matches('-');
    if slug.is_empty() {
        FALLBACK_ID.to_owned()
    } else {
        slug.to_owned()
    }
}

/// `base`, or `base-2`, `base-3`, … whichever is not `taken`.
pub fn unique_id(base: &str, taken: impl Fn(&str) -> bool) -> String {
    if !taken(base) {
        return base.to_owned();
    }
    let mut n = 2;
    loop {
        let id = format!("{base}-{n}");
        if !taken(&id) {
            return id;
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_are_normalised() {
        assert_eq!(
            safe_relative_path("textures\\a.png").as_deref(),
            Some("textures/a.png")
        );
        assert_eq!(
            safe_relative_path("./a//b/./c.json").as_deref(),
            Some("a/b/c.json")
        );
        assert_eq!(
            safe_relative_path("阿库露_vts.4096/texture_00.png").as_deref(),
            Some("阿库露_vts.4096/texture_00.png")
        );
    }

    #[test]
    fn escaping_and_special_paths_are_rejected() {
        for raw in [
            "",
            "  ",
            ".",
            "/etc/passwd",
            "\\\\server\\share",
            "../a.png",
            "a/../../b",
            "C:/Windows/win.ini",
            "c:a.png",
            "https://example.com/a.png",
            "a.png:stream",
            "CON",
            "textures/nul.png",
            "Com1.txt",
            "a\0b",
        ] {
            assert_eq!(safe_relative_path(raw), None, "{raw:?}");
        }
    }

    #[test]
    fn device_name_check_only_matches_whole_stems() {
        assert!(is_plain_segment("console.png"));
        assert!(is_plain_segment("com10"));
        assert!(!is_plain_segment("aux.exp3.json"));
    }

    #[test]
    fn ids_are_lower_case_ascii() {
        assert!(is_valid_id("hiyori"));
        assert!(is_valid_id("0-mao_pro"));
        assert!(!is_valid_id(""));
        assert!(!is_valid_id("-lead"));
        assert!(!is_valid_id("Upper"));
        assert!(!is_valid_id(".staging"));
        assert!(!is_valid_id("a/b"));
        assert!(!is_valid_id(&"a".repeat(65)));
    }

    #[test]
    fn slugs_come_from_names() {
        assert_eq!(slugify("Hiyori Pro (t11)"), "hiyori-pro-t11");
        assert_eq!(slugify("  __mao__  "), "mao");
        assert_eq!(slugify("阿库露_vts"), "vts");
        assert_eq!(slugify("阿库露"), "character");
        assert!(is_valid_id(&slugify(&"x".repeat(200))));
    }

    #[test]
    fn taken_ids_get_a_suffix() {
        let taken = ["a", "a-2"];
        assert_eq!(unique_id("a", |id| taken.contains(&id)), "a-3");
        assert_eq!(unique_id("b", |id| taken.contains(&id)), "b");
    }
}
