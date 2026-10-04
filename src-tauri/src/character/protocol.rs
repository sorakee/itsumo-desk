//! The `character` URI scheme, which serves pack files to the webviews (D42):
//! `http://character.localhost/<id>/<path>` for installed packs and
//! `http://character.localhost/.staging/<token>/<path>` for an import under review.

use std::{
    fs,
    path::{Path, PathBuf},
};

use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use tauri::{
    http::{
        header::{ACCESS_CONTROL_ALLOW_ORIGIN, CACHE_CONTROL, CONTENT_TYPE},
        HeaderValue, Method, Request, Response, StatusCode,
    },
    AppHandle, Manager, UriSchemeResponder,
};

use super::{
    library::{is_valid_token, STAGING},
    paths::{is_plain_segment, is_valid_id},
    CharacterLibrary,
};

pub const SCHEME: &str = "character";

/// How WebView2 exposes custom schemes; other platforms use the scheme itself.
#[cfg(windows)]
const BASE_URL: &str = "http://character.localhost";
#[cfg(not(windows))]
const BASE_URL: &str = "character://localhost";

/// Everything but RFC 3986 unreserved characters, so file names never read as URL syntax.
const SEGMENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

/// The URL of a pack file, from its path segments.
pub fn url<'a>(segments: impl IntoIterator<Item = &'a str>) -> String {
    let mut url = BASE_URL.to_owned();
    for segment in segments {
        url.push('/');
        url.extend(utf8_percent_encode(segment, SEGMENT));
    }
    url
}

/// Maps a request path to a file inside `root`, or `None` if it does not name one.
pub fn resolve(root: &Path, request_path: &str) -> Option<PathBuf> {
    let segments = request_path
        .strip_prefix('/')?
        .split('/')
        .map(|raw| percent_decode_str(raw).decode_utf8().ok())
        .collect::<Option<Vec<_>>>()?;
    let (pack, file) = match segments.as_slice() {
        [first, token, file @ ..] if first == STAGING && is_valid_token(token) => (2, file),
        [id, file @ ..] if is_valid_id(id) => (1, file),
        _ => return None,
    };
    if file.is_empty() || !file.iter().all(|s| is_plain_segment(s)) {
        return None;
    }
    let path = segments
        .iter()
        .fold(root.to_path_buf(), |path, s| path.join(s.as_ref()));
    // Belt and braces: links inside a pack must not lead out of it.
    let pack_root = segments[..pack]
        .iter()
        .fold(root.to_path_buf(), |path, s| path.join(s.as_ref()));
    let resolved = fs::canonicalize(&path).ok()?;
    (resolved.starts_with(fs::canonicalize(pack_root).ok()?) && resolved.is_file())
        .then_some(resolved)
}

fn content_type(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("md") => "text/markdown; charset=utf-8",
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

fn response(status: StatusCode, content_type: &'static str, body: Vec<u8>) -> Response<Vec<u8>> {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    // Pages are served from another origin (tauri.localhost, or Vite in dev).
    headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    // A replaced pack keeps its URLs.
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

fn serve(root: &Path, method: &Method, path: &str) -> Response<Vec<u8>> {
    if method != Method::GET {
        return response(StatusCode::METHOD_NOT_ALLOWED, "text/plain", Vec::new());
    }
    let Some(file) = resolve(root, path) else {
        return response(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    };
    match fs::read(&file) {
        Ok(bytes) => response(StatusCode::OK, content_type(&file), bytes),
        Err(error) => {
            tracing::warn!(%error, "could not read a character file");
            response(StatusCode::NOT_FOUND, "text/plain", Vec::new())
        }
    }
}

/// The scheme's handler. File reads happen on a blocking thread.
pub fn handle(app: &AppHandle, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let Some(library) = app.try_state::<CharacterLibrary>() else {
        responder.respond(response(
            StatusCode::SERVICE_UNAVAILABLE,
            "text/plain",
            Vec::new(),
        ));
        return;
    };
    let root = library.root().to_path_buf();
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(serve(&root, &method, &path));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::character::test_dir::TestDir;

    #[test]
    fn urls_encode_each_segment() {
        assert_eq!(
            url(["vts", "model", "阿库露 (礼服).model3.json"]),
            format!("{BASE_URL}/vts/model/%E9%98%BF%E5%BA%93%E9%9C%B2%20%28%E7%A4%BC%E6%9C%8D%29.model3.json")
        );
        assert_eq!(url(["a", "#?%.png"]), format!("{BASE_URL}/a/%23%3F%25.png"));
    }

    #[test]
    fn resolves_files_inside_packs_only() {
        let tmp = TestDir::new("protocol");
        let root = tmp.path("characters");
        fs::create_dir_all(root.join("hiyori/model")).expect("create pack");
        fs::write(root.join("hiyori/model/阿 b.png"), b"png").expect("write file");
        fs::create_dir_all(root.join(".staging/ab12")).expect("create staging");
        fs::write(root.join(".staging/ab12/character.json"), b"{}").expect("write file");
        fs::write(root.join("secret.json"), b"{}").expect("write file");

        let file = resolve(&root, "/hiyori/model/%E9%98%BF%20b.png").expect("resolves");
        assert!(file.ends_with("阿 b.png"));
        assert!(resolve(&root, "/.staging/ab12/character.json").is_some());

        for path in [
            "",
            "/",
            "/hiyori",
            "/hiyori/",
            "/hiyori/model",
            "/hiyori/model/missing.png",
            "/hiyori/../secret.json",
            "/hiyori/%2E%2E/secret.json",
            "/hiyori/model%2F..%2F..%2Fsecret.json",
            "/hiyori/..%5Csecret.json",
            "/Hiyori/model/%E9%98%BF%20b.png",
            "/secret.json",
            "/.staging/xyz/character.json",
            "/.staging/ab12",
            "/hiyori/C:%5Cwindows%5Cwin.ini",
            "/hiyori/model/%FF.png",
        ] {
            assert_eq!(resolve(&root, path), None, "{path:?}");
        }
    }

    #[test]
    fn only_get_is_served() {
        let tmp = TestDir::new("protocol-method");
        let root = tmp.path("characters");
        fs::create_dir_all(root.join("a")).expect("create pack");
        fs::write(root.join("a/c.json"), b"{}").expect("write file");
        assert_eq!(
            serve(&root, &Method::GET, "/a/c.json").status(),
            StatusCode::OK
        );
        assert_eq!(
            serve(&root, &Method::POST, "/a/c.json").status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
        assert_eq!(
            serve(&root, &Method::GET, "/a/x.json").status(),
            StatusCode::NOT_FOUND
        );
    }
}
