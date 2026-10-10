//! Whether a model is heavy enough to warn about at import (D49). The idle budget (D48) is
//! for typical models; a heavy one still installs, but the user is told what it costs.

use std::{fs::File, io::Read, path::Path};

use tracing::debug;

use super::model3::ModelFiles;

const MIB: u64 = 1024 * 1024;
/// The render loop's rate at rest (D40).
const IDLE_FPS: f64 = 30.0;
/// A Core update above this takes ~12% of a core at rest by itself, most of what the budget
/// leaves after the app's own ~9% (M1 exit check). Typical models take 0.2–2.4 ms.
const MAX_UPDATE_MS: f64 = 4.0;
/// The Core's heap stayed at its 16 MB default for every typical model surveyed (mocs up to
/// 8 MB) and grew to 256 MB for a 109 MB one.
const MAX_MOC_BYTES: u64 = 32 * MIB;
/// Textures are RGBA with mipmaps; four 8192² ones (~1.3 GB) are the case this catches.
const MAX_TEXTURE_BYTES: u64 = 1024 * MIB;

const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

/// What a model costs, as far as the core and the webview could measure it.
#[derive(Debug, Default, PartialEq)]
pub struct Weight {
    /// The median Cubism Core update the webview timed while reading the moc.
    pub update_ms: f64,
    pub moc_bytes: Option<u64>,
    /// Width and height of each texture whose header could be read.
    pub textures: Vec<(u32, u32)>,
}

/// Reads a PNG's width and height from its header.
fn png_size(header: &[u8]) -> Option<(u32, u32)> {
    if header.len() < 24 || &header[..8] != PNG_SIGNATURE || &header[12..16] != b"IHDR" {
        return None;
    }
    let read = |at: usize| header[at..at + 4].try_into().ok().map(u32::from_be_bytes);
    Some((read(16)?, read(20)?))
}

fn texture_size(path: &Path) -> Option<(u32, u32)> {
    let mut header = [0; 24];
    let size = File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .ok()
        .and_then(|()| png_size(&header));
    if size.is_none() {
        debug!(path = %path.display(), "could not read a texture's size");
    }
    size
}

/// Video memory for a texture uploaded as RGBA with a full mipmap chain.
fn texture_bytes((width, height): (u32, u32)) -> u64 {
    u64::from(width) * u64::from(height) * 4 * 4 / 3
}

impl Weight {
    /// Measures the files of the model in `model_dir`; `update_ms` comes from the webview.
    pub fn read(model_dir: &Path, files: &ModelFiles, update_ms: f64) -> Self {
        Self {
            update_ms,
            moc_bytes: std::fs::metadata(model_dir.join(files.moc()))
                .ok()
                .map(|m| m.len()),
            textures: files
                .textures()
                .iter()
                .filter_map(|texture| texture_size(&model_dir.join(texture)))
                .collect(),
        }
    }

    /// Why the model is heavy, one sentence per reason; empty for a typical model.
    pub fn reasons(&self) -> Vec<String> {
        let mut reasons = Vec::new();
        if self.update_ms > MAX_UPDATE_MS {
            let percent = self.update_ms * IDLE_FPS / 10.0;
            reasons.push(format!(
                "Animating it takes {:.1} ms per frame on this computer: about {percent:.0}% of \
                 a CPU core while it sits idle, and twice that while the cursor is over it.",
                self.update_ms
            ));
        }
        if let Some(bytes) = self.moc_bytes.filter(|&bytes| bytes > MAX_MOC_BYTES) {
            reasons.push(format!(
                "Its model file is {} MB, and it needs a few times that in memory while it is \
                 shown.",
                (bytes + MIB / 2) / MIB
            ));
        }
        let texture_bytes: u64 = self.textures.iter().copied().map(texture_bytes).sum();
        if texture_bytes > MAX_TEXTURE_BYTES {
            reasons.push(format!(
                "Its textures need about {:.1} GB of video memory.",
                texture_bytes as f64 / (1024 * MIB) as f64
            ));
        }
        reasons
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut header = PNG_SIGNATURE.to_vec();
        header.extend_from_slice(&13u32.to_be_bytes());
        header.extend_from_slice(b"IHDR");
        header.extend_from_slice(&width.to_be_bytes());
        header.extend_from_slice(&height.to_be_bytes());
        header
    }

    #[test]
    fn png_size_reads_the_header() {
        assert_eq!(png_size(&png_header(8192, 16384)), Some((8192, 16384)));
        assert_eq!(png_size(&png_header(4096, 4096)[..23]), None);
        let mut jpeg = png_header(4096, 4096);
        jpeg[0] = 0xff;
        assert_eq!(png_size(&jpeg), None);
        let mut chunk = png_header(4096, 4096);
        chunk[12..16].copy_from_slice(b"IDAT");
        assert_eq!(png_size(&chunk), None);
    }

    #[test]
    fn texture_memory_counts_mipmaps() {
        // 4096² RGBA is 64 MiB, plus a third for the mipmaps.
        assert_eq!(texture_bytes((4096, 4096)), 64 * MIB * 4 / 3);
    }

    #[test]
    fn typical_models_are_not_heavy() {
        // Hiyori, Mao, and the largest typical ones surveyed.
        for weight in [
            Weight {
                update_ms: 0.2,
                moc_bytes: Some(MIB / 2),
                textures: vec![(2048, 2048); 2],
            },
            Weight {
                update_ms: 2.4,
                moc_bytes: Some(8 * MIB),
                textures: vec![(4096, 4096); 3],
            },
            Weight {
                update_ms: 0.6,
                moc_bytes: Some(MIB),
                textures: vec![(8192, 16384)],
            },
        ] {
            assert_eq!(weight.reasons(), Vec::<String>::new(), "{weight:?}");
        }
    }

    #[test]
    fn each_kind_of_weight_is_reported() {
        let cpu = Weight {
            update_ms: 8.9,
            ..Weight::default()
        };
        assert_eq!(cpu.reasons().len(), 1);
        assert!(cpu.reasons()[0].contains("8.9 ms"), "{:?}", cpu.reasons());
        assert!(cpu.reasons()[0].contains("27%"), "{:?}", cpu.reasons());

        let memory = Weight {
            moc_bytes: Some(109 * MIB + 300 * 1024),
            ..Weight::default()
        };
        assert_eq!(memory.reasons().len(), 1);
        assert!(
            memory.reasons()[0].contains("109 MB"),
            "{:?}",
            memory.reasons()
        );

        let textures = Weight {
            textures: vec![(8192, 8192); 4],
            ..Weight::default()
        };
        assert_eq!(textures.reasons().len(), 1);
        assert!(
            textures.reasons()[0].contains("1.3 GB"),
            "{:?}",
            textures.reasons()
        );
    }

    #[test]
    fn read_measures_the_model_files() {
        let tmp = crate::character::test_dir::TestDir::new("weight");
        let dir = tmp.path("model");
        std::fs::create_dir_all(dir.join("tex")).expect("created");
        std::fs::write(dir.join("m.moc3"), [0; 100]).expect("written");
        std::fs::write(dir.join("tex/a.png"), png_header(4096, 2048)).expect("written");
        std::fs::write(dir.join("tex/b.png"), b"not a png").expect("written");
        let files = crate::character::model3::parse(&serde_json::json!({
            "FileReferences": { "Moc": "m.moc3", "Textures": ["tex/a.png", "tex/b.png"] }
        }))
        .expect("parsed");
        assert_eq!(
            Weight::read(&dir, &files, 1.5),
            Weight {
                update_ms: 1.5,
                moc_bytes: Some(100),
                textures: vec![(4096, 2048)],
            }
        );
    }
}
