// .slate cartridge loading. A cartridge can come from:
//  1. data appended to this executable (exported games): [json][u64 len LE]["SLATECRT"]
//  2. a path on the command line (editor "Run", development)

use base64::Engine as _;
use serde::Deserialize;
use std::path::{Path, PathBuf};

pub const FOOTER_MAGIC: &[u8; 8] = b"SLATECRT";

#[derive(Deserialize, Clone)]
pub struct SpriteDef {
    pub name: String,
    #[serde(default = "default_fps")]
    pub fps: f32,
    /// one PNG data URL per frame...
    #[serde(default)]
    pub frames: Vec<String>,
    /// ...or one sprite sheet (frames of w x h, left to right then top to bottom)
    #[serde(default)]
    pub sheet: Option<String>,
    #[serde(default)]
    pub w: u32,
    #[serde(default)]
    pub h: u32,
    /// number of frames in the sheet (default: every cell)
    #[serde(default)]
    pub count: Option<usize>,
    #[serde(default)]
    pub tags: Vec<Tag>,
    #[serde(default)]
    pub flags: Vec<u32>,
    /// per-frame duration in milliseconds (0 or missing = 1/fps)
    #[serde(default)]
    pub durations: Vec<f32>,
    /// hitbox drawn in the editor: [x, y, w, h] from the sprite's top-left
    #[serde(default, rename = "box")]
    pub hitbox: Option<[f32; 4]>,
    /// tilesets: animated tiles (water, torches): these frames cycle wherever any of them is placed
    #[serde(default, rename = "tileAnims")]
    pub tile_anims: Vec<TileAnim>,
}

#[derive(Deserialize, Clone)]
pub struct TileAnim {
    pub frames: Vec<usize>,
    #[serde(default = "tile_fps")]
    pub fps: f32,
}

fn tile_fps() -> f32 {
    6.0
}

#[derive(Deserialize, Clone)]
pub struct MapLayer {
    pub name: String,
    #[serde(default = "yes")]
    pub visible: bool,
    pub data: Vec<i32>,
    /// scroll speed relative to the camera ([0.5, 0.5] = background that moves at half speed);
    /// such layers are scenery: they never collide
    #[serde(default)]
    pub parallax: Option<[f32; 2]>,
    /// repeat sideways forever (backgrounds)
    #[serde(default, rename = "repeatX")]
    pub repeat_x: bool,
}

impl MapLayer {
    /// Scrolls with the camera (the normal case): the layer the game plays on.
    pub fn solid_layer(&self) -> bool {
        self.parallax.is_none_or(|p| p == [1.0, 1.0])
    }
}

fn yes() -> bool {
    true
}

/// Tile values pack the tileset too: value = tileset index * TILE_STRIDE + frame.
/// Maps with one tileset (all older ones) just hold frame numbers.
pub const TILE_STRIDE: i32 = 4096;

/// A grid of frames from tileset sprites (one frame = one tile).
#[derive(Deserialize, Clone)]
pub struct TileMap {
    pub name: String,
    /// the first tileset (sets the tile size)
    pub tileset: String,
    /// every tileset the map uses, in tile-value order; empty = just `tileset`
    #[serde(default)]
    pub tilesets: Vec<String>,
    pub w: usize,
    pub h: usize,
    pub layers: Vec<MapLayer>,
    /// editor-placed objects: { id, type, sprite?, x, y, props? }
    #[serde(default)]
    pub objects: Vec<serde_json::Value>,
}

#[derive(Deserialize, Clone)]
pub struct Tag {
    pub name: String,
    pub from: usize,
    pub to: usize,
    #[serde(default)]
    pub dir: String,
}

fn default_fps() -> f32 {
    8.0
}

#[derive(Deserialize, Clone)]
pub struct Cartridge {
    pub name: String,
    pub resolution: (u32, u32),
    pub background: Option<String>,
    pub sprites: Vec<SpriteDef>,
    #[serde(default)]
    pub maps: Vec<TileMap>,
    /// single-file code (older cartridges); projects use `scripts` + `main` instead
    #[serde(default)]
    pub code: String,
    /// project scripts: path ("scripts/player.luau") -> source. Loaded with require("player").
    #[serde(default)]
    pub scripts: std::collections::BTreeMap<String, String>,
    /// the script run first (default "scripts/main.luau")
    #[serde(default)]
    pub main: Option<String>,
    /// sound effects: name -> data URL (WAV / OGG), played with sfx(name)
    #[serde(default)]
    pub sounds: std::collections::HashMap<String, String>,
    /// start in fullscreen (slate.json "fullscreen": true); F11 / Alt+Enter toggle it while playing
    #[serde(default)]
    pub fullscreen: bool,
    /// "luau" (native) or "js" (legacy web runtime)
    #[serde(default)]
    pub lang: Option<String>,
    /// music tracks: name -> `data:audio/ogg;base64,...` (OGG Vorbis or WAV)
    #[serde(default)]
    pub music: std::collections::HashMap<String, String>,
    /// editor "Play from here": { map, x, y }, read by games with playtest()
    #[serde(default)]
    pub playtest: Option<serde_json::Value>,
    /// particle presets from the editor: name -> burst options (fx:burst(x, y, "name"))
    #[serde(default)]
    pub particles: std::collections::HashMap<String, serde_json::Value>,
    /// UI screens made in the editor (HUDs, menus): name -> { elements }, drawn by UI.screen(name)
    #[serde(default)]
    pub screens: std::collections::HashMap<String, serde_json::Value>,
}

impl TileMap {
    /// The tileset name and frame of a tile value (None for empty cells).
    pub fn tile(&self, v: i32) -> Option<(&str, usize)> {
        if v < 0 {
            return None;
        }
        let set = (v / TILE_STRIDE) as usize;
        let name = if set == 0 && self.tilesets.is_empty() { Some(&self.tileset) } else { self.tilesets.get(set) };
        name.map(|n| (n.as_str(), (v % TILE_STRIDE) as usize))
    }
}

pub struct Image {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}

pub enum Source {
    Embedded,
    File(PathBuf),
}

pub fn parse(bytes: &[u8]) -> Result<Cartridge, String> {
    serde_json::from_slice(bytes).map_err(|e| format!("invalid cartridge: {e}"))
}

/// Cartridge appended to our own executable, if any.
pub fn embedded() -> Option<Vec<u8>> {
    let exe = std::env::current_exe().ok()?;
    let data = std::fs::read(exe).ok()?;
    let n = data.len();
    if n < 16 || &data[n - 8..] != FOOTER_MAGIC {
        return None;
    }
    let len = u64::from_le_bytes(data[n - 16..n - 8].try_into().ok()?) as usize;
    if len > n - 16 {
        return None;
    }
    Some(data[n - 16 - len..n - 16].to_vec())
}

pub fn load() -> Result<(Cartridge, Source), String> {
    #[cfg(target_arch = "wasm32")]
    return match crate::web::cart() {
        Some(bytes) => Ok((parse(&bytes)?, Source::Embedded)),
        None => Err("no game.slate next to the page".into()),
    };
    #[allow(unreachable_code)]
    if let Some(bytes) = embedded() {
        return Ok((parse(&bytes)?, Source::Embedded));
    }
    // exported macOS / Linux games: game.slate beside the player (Mac: Contents/Resources in the .app),
    // so the signed player binary stays untouched
    if std::env::args().skip(1).all(|a| a.starts_with("--")) {
        if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
            for p in [dir.join("game.slate"), dir.join("../Resources/game.slate")] {
                if let Ok(bytes) = std::fs::read(&p) {
                    return Ok((parse(&bytes)?, Source::Embedded));
                }
            }
        }
    }
    let path = std::env::args()
        .skip(1)
        .find(|a| !a.starts_with("--"))
        .ok_or("no cartridge: run `slate-player game.slate`")?;
    let bytes = std::fs::read(&path).map_err(|e| format!("cannot read {path}: {e}"))?;
    Ok((parse(&bytes)?, Source::File(PathBuf::from(path))))
}

pub fn mtime(path: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// Decode the bytes of a `data:...;base64,...` URL.
pub fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let b64 = data_url.split_once(',').map(|(_, b)| b).unwrap_or(data_url);
    base64::engine::general_purpose::STANDARD.decode(b64.trim()).map_err(|e| format!("bad base64: {e}"))
}

/// Cut a sheet into frames of w x h (left to right, then top to bottom).
pub fn split_sheet(img: &Image, w: u32, h: u32, count: Option<usize>) -> Vec<Image> {
    let (w, h) = (if w == 0 { img.w } else { w.min(img.w) }, if h == 0 { img.h } else { h.min(img.h) });
    let (cols, rows) = ((img.w / w).max(1), (img.h / h).max(1));
    let n = count.unwrap_or((cols * rows) as usize).min((cols * rows) as usize).max(1);
    (0..n)
        .map(|i| {
            let (cx, cy) = ((i as u32 % cols) * w, (i as u32 / cols) * h);
            let mut rgba = Vec::with_capacity((w * h * 4) as usize);
            for y in 0..h {
                let o = (((cy + y) * img.w + cx) * 4) as usize;
                rgba.extend_from_slice(&img.rgba[o..o + (w * 4) as usize]);
            }
            Image { w, h, rgba }
        })
        .collect()
}

/// Decode a `data:image/png;base64,...` frame into straight (non-premultiplied) RGBA.
pub fn decode_frame(data_url: &str) -> Result<Image, String> {
    let b64 = data_url.split_once(',').map(|(_, b)| b).unwrap_or(data_url);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("bad base64: {e}"))?;
    let mut dec = png::Decoder::new(std::io::Cursor::new(bytes));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().map_err(|e| format!("bad png: {e}"))?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| format!("bad png: {e}"))?;
    let (w, h) = (info.width, info.height);
    let px = (w * h) as usize;
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf[..px * 4].to_vec(),
        png::ColorType::Rgb => buf[..px * 3].chunks(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => buf[..px * 2].chunks(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
        png::ColorType::Grayscale => buf[..px].iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err("indexed png not expanded".into()),
    };
    Ok(Image { w, h, rgba })
}
