//! Prefill (D45, slice 7d): a mapping guessed from the model's own names and its VTube
//! Studio `.vtube.json`, for models that come without one. Names are untrusted and in any
//! language, so this only ever suggests; the user checks the result in the mapping editor.
//!
//! Each expression and motion group is known by its name, its files' stems and the names
//! of the `.vtube.json` hotkeys that play those files: a model may call its expressions
//! `1`…`7` while its hotkeys say `生气` (angry) and `lianhong` (blush).

use std::collections::{BTreeMap, HashSet};

use serde_json::Value;

use super::{
    manifest::ModelManifest,
    mapping::{Mapping, Target},
    model3::ModelFiles,
    pack::ModelExtras,
    paths::safe_relative_path,
};

/// Words that suggest each slot, strongest first. ASCII words match whole words of a name
/// (`Tap@Body` reads as "tap body", `eyes_bikkuri` as "eyes bikkuri"); words in other
/// scripts match anywhere in it. Characters that mean different things in Chinese and
/// Japanese stay out (`困`: sleepy in one, troubled in the other), as do pinyin syllables
/// short enough to be something else.
const SLOT_WORDS: [(&str, &[&str]); 15] = [
    ("idle", &["idle", "待机", "待機", "wait", "loop"]),
    (
        "talking",
        &[
            "talk",
            "talking",
            "speak",
            "speaking",
            "说话",
            "讲话",
            "話す",
            "しゃべ",
        ],
    ),
    (
        "greet",
        &[
            "greet",
            "greeting",
            "hello",
            "wave",
            "waving",
            "招手",
            "挥手",
            "打招呼",
            "手を振",
            "挨拶",
            "あいさつ",
            "zhaoshou",
            "huishou",
        ],
    ),
    (
        "thinking",
        &[
            "think",
            "thinking",
            "ponder",
            "思考",
            "考虑",
            "考え",
            "かんがえ",
            "sikao",
            "kangae",
            "curious",
            "好奇",
            "haoqi",
        ],
    ),
    (
        "yawn",
        &[
            "yawn",
            "yawning",
            "哈欠",
            "あくび",
            "欠伸",
            "haqian",
            "akubi",
        ],
    ),
    (
        "sleepy",
        &[
            "sleepy",
            "sleep",
            "sleeping",
            "doze",
            "dozing",
            "drowsy",
            "瞌睡",
            "犯困",
            "睡觉",
            "睡眠",
            "眠い",
            "眠そう",
            "ねむ",
            "うとうと",
            "keshui",
            "nemui",
        ],
    ),
    (
        "bored",
        &[
            "bored",
            "boring",
            "无聊",
            "退屈",
            "たいくつ",
            "wuliao",
            "taikutsu",
        ],
    ),
    (
        "tapped_head",
        &[
            "tap head",
            "head tap",
            "tapped head",
            "pat head",
            "headpat",
            "摸头",
            "なでなで",
        ],
    ),
    (
        "tapped_body",
        &["tap body", "body tap", "tapped body", "tap", "poke", "戳"],
    ),
    (
        "neutral",
        &[
            "neutral",
            "normal",
            "default",
            "普通",
            "通常",
            "ふつう",
            "默认",
        ],
    ),
    (
        "joy",
        &[
            "joy",
            "happy",
            "smile",
            "smiling",
            "laugh",
            "laughing",
            "glad",
            "笑",
            "开心",
            "高兴",
            "嬉",
            "喜",
            "楽し",
            "egao",
            "warai",
            "kaixin",
            "gaoxing",
            "ureshii",
            "眯眯眼",
            "爱心",
            "heart",
        ],
    ),
    (
        "sad",
        &[
            "sad",
            "cry",
            "crying",
            "tear",
            "tears",
            "sorrow",
            "哭",
            "泣",
            "悲",
            "难过",
            "伤心",
            "涙",
            "なみだ",
            "kanashii",
            "naki",
            "kuku",
            "nanguo",
            "shangxin",
        ],
    ),
    (
        "angry",
        &[
            "angry",
            "anger",
            "mad",
            "rage",
            "annoyed",
            "pout",
            "怒",
            "生气",
            "气愤",
            "不爽",
            "哼",
            "イライラ",
            "ぷんぷん",
            "ikari",
            "okori",
            "shengqi",
            "heng",
        ],
    ),
    (
        "surprised",
        &[
            "surprised",
            "surprise",
            "shock",
            "shocked",
            "astonished",
            "惊",
            "びっくり",
            "驚",
            "odoroki",
            "bikkuri",
            "jingya",
            "chijing",
        ],
    ),
    (
        "shy",
        &[
            "shy",
            "blush",
            "blushing",
            "embarrassed",
            "bashful",
            "害羞",
            "脸红",
            "羞",
            "照れ",
            "赤面",
            "てれ",
            "tere",
            "haixiu",
            "lianhong",
        ],
    ),
];

/// Slots that play a body movement first; the rest (emotions) a facial expression first.
const MOTION_SLOTS: [&str; 9] = [
    "idle",
    "talking",
    "greet",
    "thinking",
    "yawn",
    "sleepy",
    "bored",
    "tapped_head",
    "tapped_body",
];

/// Toggles worth wearing at rest: VTube Studio models show their watermark until one of
/// these is switched on.
const BASE_WORDS: [&str; 5] = ["水印", "watermark", "透かし", "ウォーターマーク", "logo"];

/// `.vtube.json` tracking inputs for each parameter role the runtime drives, preferred
/// first. Only the output id is taken: the ranges are VTube Studio's (eye X is often
/// inverted there).
const ROLE_INPUTS: [(&str, &[&str]); 5] = [
    ("ParamAngleX", &["FaceAngleX"]),
    ("ParamAngleY", &["FaceAngleY"]),
    ("ParamAngleZ", &["FaceAngleZ"]),
    ("ParamEyeBallX", &["EyeRightX", "EyeLeftX"]),
    ("ParamEyeBallY", &["EyeRightY", "EyeLeftY"]),
];

const BREATH: &str = "ParamBreath";

/// A name split into words: ASCII letters and digits break at case changes and between
/// letters and digits and are lower-cased; runs of other letters (CJK, kana) stay whole;
/// everything else separates.
fn words(name: &str) -> Vec<String> {
    #[derive(PartialEq, Clone, Copy)]
    enum Kind {
        Lower,
        Upper,
        Digit,
        Other,
    }
    let mut words: Vec<String> = Vec::new();
    let mut last: Option<Kind> = None;
    for c in name.chars() {
        let kind = if c.is_ascii_lowercase() {
            Kind::Lower
        } else if c.is_ascii_uppercase() {
            Kind::Upper
        } else if c.is_ascii_digit() {
            Kind::Digit
        } else if !c.is_ascii() && c.is_alphanumeric() {
            Kind::Other
        } else {
            last = None;
            continue;
        };
        let joins = match (last, kind) {
            (Some(Kind::Upper), Kind::Lower) => true,
            (Some(previous), kind) => previous == kind,
            (None, _) => false,
        };
        match words.last_mut() {
            Some(word) if joins => word.push(c.to_ascii_lowercase()),
            _ => words.push(c.to_ascii_lowercase().to_string()),
        }
        last = Some(kind);
    }
    words
}

/// How strongly `name` carries `keyword`: 2 when it is (nearly) the whole name, 1 for a
/// part of it.
fn strength(name: &str, keyword: &str) -> u8 {
    let name_words = words(name);
    if keyword.is_ascii() {
        let keyword: Vec<&str> = keyword.split(' ').collect();
        if name_words.len() == keyword.len() && name_words.iter().zip(&keyword).all(|(a, b)| a == b)
        {
            2
        } else if name_words
            .windows(keyword.len())
            .any(|window| window.iter().zip(&keyword).all(|(a, b)| a == b))
        {
            1
        } else {
            0
        }
    } else if name_words.len() == 1
        && name_words[0].contains(keyword)
        // CJK names often add one character for the part shown: 害羞脸 "shy face".
        && name_words[0].chars().count() <= keyword.chars().count() + 1
    {
        2
    } else if name_words.iter().any(|word| word.contains(keyword)) {
        1
    } else {
        0
    }
}

/// A file's name without its folder and its `.exp3.json`/`.motion3.json` suffix.
fn stem(file: &str) -> &str {
    let name = file.rsplit('/').next().unwrap_or(file);
    name.split_once('.').map_or(name, |(stem, _)| stem)
}

/// The same file, however a reference spells it.
fn same_file(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// A `.vtube.json` hotkey that plays a file.
struct Hotkey<'a> {
    action: &'a str,
    file: String,
    name: &'a str,
}

fn hotkeys(vtube: Option<&Value>) -> Vec<Hotkey<'_>> {
    vtube
        .and_then(|v| v.get("Hotkeys"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|hotkey| {
            let text = |key| hotkey.get(key).and_then(Value::as_str);
            Some(Hotkey {
                action: text("Action")?,
                file: safe_relative_path(text("File")?)?,
                name: text("Name").map(str::trim).filter(|n| !n.is_empty())?,
            })
        })
        .collect()
}

/// A slot target and every name it goes by.
struct Candidate {
    target: Target,
    names: Vec<String>,
    /// For base expressions, which name files.
    files: Vec<String>,
}

fn candidates(
    manifest: &ModelManifest,
    files: &ModelFiles,
    extras: &ModelExtras,
    hotkeys: &[Hotkey],
) -> Vec<Candidate> {
    let named = |action: &str, own: &[String]| -> Vec<String> {
        hotkeys
            .iter()
            .filter(|h| h.action == action && own.iter().any(|f| same_file(f, &h.file)))
            .map(|h| h.name.to_owned())
            .collect()
    };
    let with_files = |name: Option<String>, own: Vec<String>, action: &str| {
        let mut names: Vec<String> = name.into_iter().collect();
        names.extend(own.iter().map(|f| stem(f).to_owned()));
        names.extend(named(action, &own));
        names.retain(|n| !n.trim().is_empty());
        (names, own)
    };

    let expressions = manifest.expressions.iter().map(|name| {
        let own: Vec<String> = files
            .expression_files
            .iter()
            .filter(|(n, _)| n == name)
            .map(|(_, f)| f.clone())
            .chain(
                extras
                    .expressions
                    .iter()
                    .filter(|e| &e.name == name)
                    .map(|e| e.file.clone()),
            )
            .collect();
        let (names, files) = with_files(Some(name.clone()), own, "ToggleExpression");
        Candidate {
            target: Target::Expression(name.clone()),
            names,
            files,
        }
    });
    let motions = manifest.motion_groups.iter().map(|group| {
        let own: Vec<String> = files
            .motion_files
            .iter()
            .filter(|(g, _)| g == &group.name)
            .map(|(_, f)| f.clone())
            .chain(
                extras
                    .motion_groups
                    .iter()
                    .filter(|g| g.name == group.name)
                    .flat_map(|g| g.motions.iter().map(|m| m.file.clone())),
            )
            .collect();
        let (names, files) = with_files(Some(group.name.clone()), own, "TriggerAnimation");
        Candidate {
            target: Target::Motion(group.name.clone()),
            names,
            files,
        }
    });
    expressions.chain(motions).collect()
}

/// The best match of `candidate` for `keywords`: (strength, keyword rank), or `None`.
fn best_match(candidate: &Candidate, keywords: &[&str]) -> Option<(u8, usize)> {
    keywords
        .iter()
        .enumerate()
        .filter_map(|(rank, keyword)| {
            let strength = candidate
                .names
                .iter()
                .map(|name| strength(name, keyword))
                .max()
                .unwrap_or(0);
            (strength > 0).then_some((strength, rank))
        })
        .max_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)))
}

/// Assigns slots greedily, best match first, so each target fills at most one slot.
fn slots(candidates: &[Candidate]) -> BTreeMap<String, Target> {
    // (strength, preferred kind, keyword rank, slot index, candidate index)
    let mut matches = Vec::new();
    for (slot_index, (slot, keywords)) in SLOT_WORDS.iter().enumerate() {
        let motion_slot = MOTION_SLOTS.contains(slot);
        for (index, candidate) in candidates.iter().enumerate() {
            let is_motion = matches!(candidate.target, Target::Motion(_));
            if *slot == "idle" && !is_motion {
                continue;
            }
            if let Some((strength, rank)) = best_match(candidate, keywords) {
                matches.push((strength, is_motion == motion_slot, rank, slot_index, index));
            }
        }
    }
    matches.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then(b.1.cmp(&a.1))
            .then(a.2.cmp(&b.2))
            .then(a.3.cmp(&b.3))
            .then(a.4.cmp(&b.4))
    });
    let mut slots = BTreeMap::new();
    let mut used = HashSet::new();
    for (_, _, _, slot_index, index) in matches {
        let slot = SLOT_WORDS[slot_index].0;
        if !slots.contains_key(slot) && used.insert(index) {
            slots.insert(slot.to_owned(), candidates[index].target.clone());
        }
    }
    slots
}

fn parameter_settings(vtube: Option<&Value>) -> impl Iterator<Item = &Value> {
    vtube
        .and_then(|v| v.get("ParameterSettings"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

/// The first output among `outputs` the model has, unless one of them is already the
/// standard id (then no role is needed).
fn role_for(standard: &str, outputs: &[&str], manifest: &ModelManifest) -> Option<String> {
    if outputs.contains(&standard) {
        return None;
    }
    outputs
        .iter()
        .find(|id| manifest.has_parameter(id))
        .map(|id| (*id).to_owned())
}

/// Parameter roles from the `.vtube.json` parameter mapping, for models whose head, eyes
/// or breath are not the standard parameters.
fn roles(vtube: Option<&Value>, manifest: &ModelManifest) -> BTreeMap<String, String> {
    let mut roles = BTreeMap::new();
    for (standard, inputs) in ROLE_INPUTS {
        // VTube Studio also feeds the face angles to the body; those outputs are not the head.
        let outputs: Vec<&str> = inputs
            .iter()
            .flat_map(|&input| {
                parameter_settings(vtube).filter(move |s| {
                    s.get("Input").and_then(Value::as_str) == Some(input)
                        && !s
                            .get("Name")
                            .and_then(Value::as_str)
                            .is_some_and(|n| n.to_lowercase().contains("body"))
                })
            })
            .filter_map(|s| s.get("OutputLive2D").and_then(Value::as_str))
            .filter(|id| !id.to_lowercase().starts_with("parambodyangle"))
            .collect();
        if let Some(id) = role_for(standard, &outputs, manifest) {
            roles.insert(standard.to_owned(), id);
        }
    }
    let breath: Vec<&str> = parameter_settings(vtube)
        .filter(|s| s.get("UseBreathing").and_then(Value::as_bool) == Some(true))
        .filter_map(|s| s.get("OutputLive2D").and_then(Value::as_str))
        .collect();
    if let Some(id) = role_for(BREATH, &breath, manifest) {
        roles.insert(BREATH.to_owned(), id);
    }
    roles
}

/// Expressions to suggest wearing at rest: what VTube Studio saved as switched on, and
/// watermark toggles. Never applied without the user picking them (D45).
fn base_expressions(candidates: &[Candidate], vtube: Option<&Value>) -> Vec<String> {
    // Not seen filled in any model yet; read tolerantly as names or file references.
    let saved: Vec<&str> = vtube
        .and_then(|v| v.get("SavedActiveExpressions"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            entry.as_str().or_else(|| {
                ["File", "FileName", "Name"]
                    .iter()
                    .find_map(|key| entry.get(key).and_then(Value::as_str))
            })
        })
        .collect();
    candidates
        .iter()
        .filter_map(|candidate| match &candidate.target {
            Target::Expression(name) => Some((name, candidate)),
            _ => None,
        })
        .filter(|(name, candidate)| {
            let was_saved = saved.iter().any(|s| {
                *s == name.as_str()
                    || safe_relative_path(s)
                        .is_some_and(|s| candidate.files.iter().any(|f| same_file(f, &s)))
            });
            was_saved || best_match(candidate, &BASE_WORDS).is_some()
        })
        .map(|(name, _)| name.clone())
        .collect()
}

/// A mapping suggested for a model: slots by name, parameter roles from the `.vtube.json`,
/// and base expressions that are only ever offered. Only names the manifest has appear.
pub fn suggest(
    manifest: &ModelManifest,
    files: &ModelFiles,
    extras: &ModelExtras,
    vtube: Option<&Value>,
) -> Mapping {
    let hotkeys = hotkeys(vtube);
    let candidates = candidates(manifest, files, extras, &hotkeys);
    Mapping {
        slots: slots(&candidates),
        custom: Vec::new(),
        parameters: roles(vtube, manifest),
        base_expressions: base_expressions(&candidates, vtube),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::character::{
        manifest::{MotionGroupInfo, ParameterInfo},
        pack::{ExtraExpression, ExtraMotion, ExtraMotionGroup},
    };

    fn model(expressions: &[&str], groups: &[&str], parameters: &[&str]) -> ModelManifest {
        ModelManifest {
            parameters: parameters
                .iter()
                .map(|id| ParameterInfo {
                    id: (*id).into(),
                    min: -30.0,
                    max: 30.0,
                    default: 0.0,
                    name: None,
                })
                .collect(),
            expressions: expressions.iter().map(|&e| e.into()).collect(),
            motion_groups: groups
                .iter()
                .map(|&name| MotionGroupInfo {
                    name: name.into(),
                    motions: vec![],
                })
                .collect(),
            hit_areas: vec![],
            standard_parameters: vec![],
            eye_blink_ids: vec![],
            lip_sync_ids: vec![],
        }
    }

    /// A VTube Studio export: everything comes from `modelExtras`, named by file stem.
    fn vts_extras(expressions: &[&str], motions: &[(&str, &str)]) -> ModelExtras {
        ModelExtras {
            expressions: expressions
                .iter()
                .map(|&name| ExtraExpression {
                    name: name.into(),
                    file: format!("{name}.exp3.json"),
                })
                .collect(),
            motion_groups: motions
                .iter()
                .map(|&(name, file)| ExtraMotionGroup {
                    name: name.into(),
                    motions: vec![ExtraMotion { file: file.into() }],
                })
                .collect(),
        }
    }

    fn slot(mapping: &Mapping, slot: &str) -> Option<String> {
        mapping.slots.get(slot).map(|target| match target {
            Target::Expression(name) | Target::Motion(name) | Target::Preset(name) => name.clone(),
        })
    }

    #[test]
    fn splits_names_into_words() {
        assert_eq!(words("Tap@Body"), ["tap", "body"]);
        assert_eq!(words("TapHead"), ["tap", "head"]);
        assert_eq!(words("IDLE"), ["idle"]);
        assert_eq!(words("eyes_bikkuri"), ["eyes", "bikkuri"]);
        assert_eq!(words("exp_01"), ["exp", "01"]);
        assert_eq!(words("手持手柄（礼服）"), ["手持手柄", "礼服"]);
        assert_eq!(words("照れ顔"), ["照れ顔"]);
        assert_eq!(words("white eyes"), ["white", "eyes"]);
    }

    #[test]
    fn ascii_words_match_whole_words_only() {
        assert_eq!(strength("Tap@Body", "tap body"), 2);
        assert_eq!(strength("Tap@Body", "tap"), 1);
        assert_eq!(strength("tapestry", "tap"), 0);
        assert_eq!(strength("happyface", "happy"), 0);
        assert_eq!(strength("哭哭", "哭"), 2);
        assert_eq!(strength("害羞脸", "害羞"), 2);
        assert_eq!(strength("手持麦克风", "麦克风"), 1);
        assert_eq!(strength("招手", "招手"), 2);
    }

    #[test]
    fn a_vts_export_maps_emotions_greet_idle_and_head_roles() {
        // 阿库露中式_vts, trimmed.
        let names = [
            "O形嘴",
            "呆呆脸",
            "哭哭",
            "害羞脸",
            "脸红",
            "生气脸",
            "眯眯眼脸",
            "麦克风开关",
        ];
        let extras = vts_extras(
            &names,
            &[("Idle", "IDLE.motion3.json"), ("招手", "招手.motion3.json")],
        );
        let vtube = json!({
            "Hotkeys": [
                { "Name": "害羞脸", "Action": "ToggleExpression", "File": "害羞脸.exp3.json" },
                { "Name": "移除所有按键表情", "Action": "RemoveAllExpressions", "File": "" }
            ],
            "ParameterSettings": [
                { "Name": "Face Left/Right Rotation", "Input": "FaceAngleX", "OutputLive2D": "Param72" },
                { "Name": "Face Up/Down Rotation", "Input": "FaceAngleY", "OutputLive2D": "Param73" },
                { "Name": "Face Lean Rotation", "Input": "FaceAngleZ", "OutputLive2D": "Param74" },
                { "Name": "Body Rotation X", "Input": "FaceAngleX", "OutputLive2D": "ParamBodyAngleX" },
                { "Name": "Eye X", "Input": "EyeRightX", "OutputLive2D": "ParamEyeBallX" },
                { "Name": "", "Input": "", "OutputLive2D": "ParamBreath", "UseBreathing": true }
            ]
        });
        let manifest = model(
            &names,
            &["Idle", "招手"],
            &[
                "ParamAngleX",
                "Param72",
                "Param73",
                "Param74",
                "ParamEyeBallX",
                "ParamBreath",
            ],
        );
        let mapping = suggest(&manifest, &ModelFiles::default(), &extras, Some(&vtube));

        assert_eq!(slot(&mapping, "idle").as_deref(), Some("Idle"));
        assert_eq!(slot(&mapping, "greet").as_deref(), Some("招手"));
        assert_eq!(slot(&mapping, "sad").as_deref(), Some("哭哭"));
        assert_eq!(slot(&mapping, "angry").as_deref(), Some("生气脸"));
        assert_eq!(slot(&mapping, "shy").as_deref(), Some("害羞脸"));
        assert_eq!(slot(&mapping, "joy").as_deref(), Some("眯眯眼脸"));
        assert_eq!(mapping.slots.len(), 6, "{:?}", mapping.slots);
        assert_eq!(
            mapping.parameters,
            BTreeMap::from([
                ("ParamAngleX".to_owned(), "Param72".to_owned()),
                ("ParamAngleY".to_owned(), "Param73".to_owned()),
                ("ParamAngleZ".to_owned(), "Param74".to_owned()),
            ])
        );
        assert!(mapping.base_expressions.is_empty());
    }

    #[test]
    fn hotkey_names_name_numbered_expressions() {
        // Design_genius: model3.json lists the expressions as "1"…"7".
        let files = ModelFiles {
            expression_files: (1..=6)
                .map(|n| (n.to_string(), format!("{n}.exp3.json")))
                .collect(),
            ..ModelFiles::default()
        };
        let hotkey = |name: &str, file: &str| json!({ "Name": name, "Action": "ToggleExpression", "File": file });
        let vtube = json!({ "Hotkeys": [
            hotkey("爱心眼", "1.exp3.json"),
            hotkey("生气", "2.exp3.json"),
            hotkey("OO", "3.exp3.json"),
            hotkey("lianhong", "5.exp3.json"),
            hotkey("heng", "6.exp3.json"),
            hotkey("kuku", "kuku.exp3.json")
        ] });
        let manifest = model(&["1", "2", "3", "4", "5", "6"], &[""], &[]);
        let mapping = suggest(&manifest, &files, &ModelExtras::default(), Some(&vtube));
        assert_eq!(slot(&mapping, "joy").as_deref(), Some("1"));
        assert_eq!(slot(&mapping, "angry").as_deref(), Some("2"));
        assert_eq!(slot(&mapping, "shy").as_deref(), Some("5"));
        // kuku.exp3.json is not one of the model's expressions.
        assert_eq!(slot(&mapping, "sad"), None);
        assert_eq!(mapping.slots.len(), 3, "{:?}", mapping.slots);
    }

    #[test]
    fn motion_groups_fill_behaviour_slots() {
        // Hiyori: tapped_body takes Tap@Body over the plain Tap group.
        let manifest = model(
            &[],
            &[
                "Idle",
                "Flick",
                "FlickDown",
                "FlickUp",
                "Tap",
                "Tap@Body",
                "Flick@Body",
            ],
            &[],
        );
        let mapping = suggest(
            &manifest,
            &ModelFiles::default(),
            &ModelExtras::default(),
            None,
        );
        assert_eq!(slot(&mapping, "idle").as_deref(), Some("Idle"));
        assert_eq!(slot(&mapping, "tapped_body").as_deref(), Some("Tap@Body"));
        assert_eq!(mapping.slots.len(), 2, "{:?}", mapping.slots);
        assert!(mapping.parameters.is_empty());
    }

    #[test]
    fn file_stems_count_as_names() {
        // huohuo (pinyin stems) and osagegirl (Japanese names, romaji files).
        let extras = vts_extras(
            &["angry", "baozhen", "cry", "white eyes"],
            &[
                ("Idle", "Scene1.motion3.json"),
                ("keshui", "keshui.motion3.json"),
            ],
        );
        let manifest = model(
            &["angry", "baozhen", "cry", "white eyes"],
            &["Idle", "keshui"],
            &[],
        );
        let mapping = suggest(&manifest, &ModelFiles::default(), &extras, None);
        assert_eq!(slot(&mapping, "angry").as_deref(), Some("angry"));
        assert_eq!(slot(&mapping, "sad").as_deref(), Some("cry"));
        assert_eq!(slot(&mapping, "sleepy").as_deref(), Some("keshui"));

        let files = ModelFiles {
            expression_files: vec![
                ("びっくり目".into(), "eyes_bikkuri.exp3.json".into()),
                ("あおざめ顔".into(), "face_aozame.exp3.json".into()),
            ],
            ..ModelFiles::default()
        };
        let manifest = model(&["びっくり目", "あおざめ顔"], &[], &[]);
        let mapping = suggest(&manifest, &files, &ModelExtras::default(), None);
        assert_eq!(slot(&mapping, "surprised").as_deref(), Some("びっくり目"));
        assert_eq!(mapping.slots.len(), 1, "{:?}", mapping.slots);
    }

    #[test]
    fn numbered_names_are_not_guessed() {
        // Mao: exp_01…exp_08 say nothing about which face is which.
        let names: Vec<String> = (1..=8).map(|n| format!("exp_0{n}")).collect();
        let names: Vec<&str> = names.iter().map(String::as_str).collect();
        let mapping = suggest(
            &model(&names, &["Idle", ""], &[]),
            &ModelFiles::default(),
            &ModelExtras::default(),
            None,
        );
        assert_eq!(
            mapping.slots,
            BTreeMap::from([("idle".to_owned(), Target::Motion("Idle".into()))])
        );
    }

    #[test]
    fn standard_and_missing_role_outputs_are_not_suggested() {
        let vtube = json!({ "ParameterSettings": [
            { "Name": "Face Left/Right Rotation", "Input": "FaceAngleX", "OutputLive2D": "ParamAngleX" },
            { "Name": "Face Up/Down Rotation", "Input": "FaceAngleY", "OutputLive2D": "Gone" },
            { "Name": "Eye X", "Input": "EyeLeftX", "OutputLive2D": "EyeX" },
            { "Name": "Breath", "Input": "", "OutputLive2D": "Breathe", "UseBreathing": true }
        ] });
        let manifest = model(&[], &[], &["ParamAngleX", "EyeX", "Breathe"]);
        let mapping = suggest(
            &manifest,
            &ModelFiles::default(),
            &ModelExtras::default(),
            Some(&vtube),
        );
        assert_eq!(
            mapping.parameters,
            BTreeMap::from([
                ("ParamBreath".to_owned(), "Breathe".to_owned()),
                ("ParamEyeBallX".to_owned(), "EyeX".to_owned()),
            ])
        );
    }

    #[test]
    fn base_expressions_are_watermarks_and_saved_toggles() {
        let names = ["水印开关", "麦克风开关", "clothes", "mask"];
        let extras = vts_extras(&names, &[]);
        let vtube = json!({ "SavedActiveExpressions": [{ "File": "clothes.exp3.json" }, 4] });
        let mapping = suggest(
            &model(&names, &[], &[]),
            &ModelFiles::default(),
            &extras,
            Some(&vtube),
        );
        assert_eq!(mapping.base_expressions, ["水印开关", "clothes"]);
        assert!(mapping.slots.is_empty());
    }
}
