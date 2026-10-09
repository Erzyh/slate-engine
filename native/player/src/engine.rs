// Engine state shared between the main loop and the script API.

use crate::audio::Mixer;
use crate::gfx::Gfx;
use macroquad::prelude::*;
use mlua::Value;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::rc::Rc;

pub type Shared = Rc<RefCell<Engine>>;

pub struct Engine {
    pub gfx: Gfx,
    pub input: Input,
    pub mixer: Mixer,
    pub time: f64,
    pub last_log: Option<String>,
    pub spr_cache: crate::fast::SprCache,
    pub color_cache: HashMap<Vec<u8>, [u8; 4]>,
    colors: HashMap<String, [u8; 4]>,
    pub maps: HashMap<String, crate::cart::TileMap>,
    /// input actions: name -> keys / pad buttons ("jump" -> ["z", "space", "pad_a"])
    pub bindings: HashMap<String, Vec<String>>,
    /// window mode the game wants; the frame loop applies changes
    pub fullscreen: bool,
    rng: u64,
    save_dir: PathBuf,
    /// bumps whenever map tiles change (path caches compare it)
    pub map_version: u64,
    pub paths: crate::path::Cache,
    /// editor Game view debugging: hitbox overlay
    pub debug_boxes: bool,
    /// editor "Play from here": { map, x, y }
    pub playtest: Option<serde_json::Value>,
    /// particle presets (Particles.preset)
    pub particles: HashMap<String, serde_json::Value>,
    /// UI screens (UI.screen)
    pub screens: HashMap<String, serde_json::Value>,
}

/// Default actions: arrows / WASD / d-pad / left stick to move, A B X Y like a gamepad.
pub fn default_bindings() -> HashMap<String, Vec<String>> {
    let b = |keys: &[&str]| keys.iter().map(|k| k.to_string()).collect::<Vec<_>>();
    HashMap::from([
        ("left".into(), b(&["left", "a", "pad_left", "lstick_left"])),
        ("right".into(), b(&["right", "d", "pad_right", "lstick_right"])),
        ("up".into(), b(&["up", "w", "pad_up", "lstick_up"])),
        ("down".into(), b(&["down", "s", "pad_down", "lstick_down"])),
        ("a".into(), b(&["z", "space", "j", "pad_a"])),
        ("b".into(), b(&["x", "k", "pad_b"])),
        ("x".into(), b(&["c", "l", "pad_x"])),
        ("y".into(), b(&["v", "i", "pad_y"])),
        ("start".into(), b(&["enter", "escape", "pad_start"])),
        ("select".into(), b(&["tab", "pad_select"])),
    ])
}

impl Engine {
    pub fn new(gfx: Gfx, cart_name: &str) -> Engine {
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(1);
        Engine {
            gfx,
            input: Input::default(),
            mixer: Mixer::new(),
            time: 0.0,
            last_log: None,
            spr_cache: Default::default(),
            color_cache: HashMap::new(),
            colors: HashMap::new(),
            maps: HashMap::new(),
            bindings: default_bindings(),
            fullscreen: false,
            rng: seed | 1,
            save_dir: save_dir(cart_name),
            map_version: 0,
            paths: Default::default(),
            debug_boxes: false,
            playtest: None,
            particles: HashMap::new(),
            screens: HashMap::new(),
        }
    }

    pub fn set_maps(&mut self, maps: &[crate::cart::TileMap]) {
        self.maps = maps.iter().map(|m| (m.name.clone(), m.clone())).collect();
        self.map_version += 1;
    }

    /// Tile size of a map (its first tileset's frame size).
    pub fn tile_size(&self, m: &crate::cart::TileMap) -> Option<(f32, f32)> {
        let t = self.gfx.sprites.get(&m.tileset)?;
        (t.w > 0.0 && t.h > 0.0).then_some((t.w, t.h))
    }

    /// Flag bits of a tile value on a map (0 for empty cells).
    pub fn tile_flags(&self, m: &crate::cart::TileMap, v: i32) -> u32 {
        m.tile(v).and_then(|(set, f)| self.gfx.sprites.get(set).and_then(|s| s.flags.get(f).copied())).unwrap_or(0)
    }

    /// Is tile cell (tx, ty) solid (flag `bit` on any layer)? Outside the map counts as solid.
    pub fn cell_solid(&self, m: &crate::cart::TileMap, tx: i64, ty: i64, bit: u32) -> bool {
        if tx < 0 || ty < 0 || tx as usize >= m.w || ty as usize >= m.h {
            return true;
        }
        let i = ty as usize * m.w + tx as usize;
        m.layers.iter().any(|l| l.solid_layer() && (self.tile_flags(m, l.data.get(i).copied().unwrap_or(-1)) >> bit) & 1 == 1)
    }

    /// Draw a map's visible layers (or just `layer`) with its top-left at (x, y); on-screen tiles only.
    pub fn draw_map(&mut self, name: &str, x: f32, y: f32, layer: Option<&mlua::Value>, tint: [u8; 4]) {
        let Some(m) = self.maps.get(name) else { return };
        let Some((tw, th)) = self.tile_size(m) else { return };
        let pick: Vec<usize> = match layer {
            Some(v) => map_layer(m, v).into_iter().collect(),
            None => (0..m.layers.len()).filter(|&i| m.layers[i].visible).collect(),
        };
        let (sw, sh) = (self.gfx.width as f32, self.gfx.height as f32);
        let map_w = m.w as f32 * tw;
        // collect quads first: the map and the renderer live in the same struct
        let mut quads = Vec::new();
        for &li in &pick {
            let l = &m.layers[li];
            // parallax layers follow the camera more slowly (or faster)
            let [px, py] = l.parallax.unwrap_or([1.0, 1.0]);
            let (ox, oy) = ((x - self.gfx.cam_x * px).round(), (y - self.gfx.cam_y * py).round());
            let ty0 = (-oy / th).floor().max(0.0) as usize;
            let ty1 = (((sh - oy) / th).ceil().max(0.0) as usize).min(m.h);
            // repeating layers: every copy of the map that reaches the screen
            let copies: Vec<f32> = if l.repeat_x && map_w > 0.0 {
                let first = (-ox / map_w).floor();
                let last = ((sw - ox) / map_w).floor();
                (first as i64..=last as i64).map(|k| ox + k as f32 * map_w).collect()
            } else {
                vec![ox]
            };
            for cx in copies {
                let tx0 = (-cx / tw).floor().max(0.0) as usize;
                let tx1 = (((sw - cx) / tw).ceil().max(0.0) as usize).min(m.w);
                for ty in ty0..ty1 {
                    for tx in tx0..tx1 {
                        let v = l.data.get(ty * m.w + tx).copied().unwrap_or(-1);
                        let Some((set, f)) = m.tile(v) else { continue };
                        if let Some(t) = self.gfx.sprites.get(set) {
                            if let Some(r) = t.frames.get(t.tile_frame(f, self.time)) {
                                quads.push((*r, cx + tx as f32 * tw, oy + ty as f32 * th));
                            }
                        }
                    }
                }
            }
        }
        for (r, qx, qy) in quads {
            self.gfx.rect_region(r, qx, qy, tw, th, tint, false, false);
        }
    }

    pub fn random(&mut self) -> f64 {
        // xorshift64*
        self.rng ^= self.rng >> 12;
        self.rng ^= self.rng << 25;
        self.rng ^= self.rng >> 27;
        (self.rng.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 11) as f64 / (1u64 << 53) as f64
    }

    /// "#rgb" | "#rrggbb" | "#rrggbbaa" | 0xrrggbb
    pub fn color(&mut self, v: Option<&Value>, fallback: [u8; 4]) -> [u8; 4] {
        match v {
            Some(Value::String(s)) => {
                let s = s.to_string_lossy();
                if let Some(c) = self.colors.get(&s) {
                    return *c;
                }
                let c = parse_hex(&s).unwrap_or(fallback);
                self.colors.insert(s, c);
                c
            }
            Some(Value::Integer(n)) => hex_num(*n as i64),
            Some(Value::Number(n)) => hex_num(*n as i64),
            _ => fallback,
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn path(&self, key: &str) -> PathBuf {
        let safe: String = key.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
        self.save_dir.join(format!("{safe}.json"))
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn save(&self, key: &str, json: &str) {
        let _ = std::fs::create_dir_all(&self.save_dir);
        let _ = std::fs::write(self.path(key), json);
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn load(&self, key: &str) -> Option<String> {
        std::fs::read_to_string(self.path(key)).ok()
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn wipe(&self, key: &str) {
        let _ = std::fs::remove_file(self.path(key));
    }

    // web: the browser's localStorage, under "slate/<game>/<key>"
    #[cfg(target_arch = "wasm32")]
    fn web_key(&self, key: &str) -> String {
        let game = self.save_dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        format!("slate/{game}/{key}")
    }

    #[cfg(target_arch = "wasm32")]
    pub fn save(&self, key: &str, json: &str) {
        crate::web::store_set(&self.web_key(key), json);
    }

    #[cfg(target_arch = "wasm32")]
    pub fn load(&self, key: &str) -> Option<String> {
        crate::web::store_get(&self.web_key(key))
    }

    #[cfg(target_arch = "wasm32")]
    pub fn wipe(&self, key: &str) {
        crate::web::store_remove(&self.web_key(key));
    }
}

/// Layer by index (0-based number) or by name.
pub fn map_layer(m: &crate::cart::TileMap, v: &mlua::Value) -> Option<usize> {
    match v {
        mlua::Value::Integer(i) => (*i >= 0 && (*i as usize) < m.layers.len()).then_some(*i as usize),
        mlua::Value::Number(n) => (*n >= 0.0 && (*n as usize) < m.layers.len()).then_some(*n as usize),
        mlua::Value::String(s) => {
            let s = s.to_string_lossy();
            m.layers.iter().position(|l| l.name == s)
        }
        _ => Some(0),
    }
}

fn hex_num(n: i64) -> [u8; 4] {
    [((n >> 16) & 255) as u8, ((n >> 8) & 255) as u8, (n & 255) as u8, 255]
}

pub fn parse_hex(s: &str) -> Option<[u8; 4]> {
    let h = s.trim_start_matches('#');
    let h: String = if h.len() == 3 { h.chars().flat_map(|c| [c, c]).collect() } else { h.to_string() };
    let byte = |i: usize| u8::from_str_radix(h.get(i..i + 2)?, 16).ok();
    match h.len() {
        6 => Some([byte(0)?, byte(2)?, byte(4)?, 255]),
        8 => Some([byte(0)?, byte(2)?, byte(4)?, byte(6)?]),
        _ => None,
    }
}

fn save_dir(cart: &str) -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("XDG_DATA_HOME"))
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("."));
    let safe: String = cart.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
    base.join("Slate").join(safe)
}

// ------------------------------------------------------------------ input

#[derive(Default)]
pub struct Input {
    pub mx: f32,
    pub my: f32,
    pub inside: bool,
    pub down: bool,
    pub pressed: bool,
    pub released: bool,
    pub right: bool,
    pub wheel: f32,
    pressed_keys: HashSet<KeyCode>,
    pending_press: bool,
    pending_release: bool,
    pending_wheel: f32,
    /// edge events consumed by this frame's updates, replayed for draw() (immediate-mode UI)
    frame_press: bool,
    frame_release: bool,
    frame_wheel: f32,
    /// Test mode: SLATE_CLICKS="frame:x,y;frame:x,y" injects clicks in game coordinates.
    scripted: Vec<(u32, f32, f32)>,
    /// Test mode: SLATE_KEYS="frame:key:frames;..." holds a key for a number of frames.
    scripted_keys: Vec<(u32, String, u32)>,
    script_held: HashSet<String>,
    script_pressed: HashSet<String>,
    frame: u32,
    pub pads: crate::pad::Pads,
}

impl Input {
    /// Read the OS input once per rendered frame.
    pub fn poll(&mut self, view_x: f32, view_y: f32, scale: f32, w: u32, h: u32) {
        self.pads.poll();
        if self.frame == 0 {
            if let Ok(spec) = std::env::var("SLATE_KEYS") {
                self.scripted_keys = spec
                    .split(';')
                    .filter_map(|c| {
                        let mut it = c.split(':');
                        Some((it.next()?.trim().parse().ok()?, it.next()?.trim().to_string(), it.next().unwrap_or("1").trim().parse().ok()?))
                    })
                    .collect();
            }
            if let Ok(spec) = std::env::var("SLATE_CLICKS") {
                self.scripted = spec
                    .split(';')
                    .filter_map(|c| {
                        let (f, xy) = c.split_once(':')?;
                        let (x, y) = xy.split_once(',')?;
                        Some((f.trim().parse().ok()?, x.trim().parse().ok()?, y.trim().parse().ok()?))
                    })
                    .collect();
            }
        }
        self.frame += 1;
        for (start, key, dur) in &self.scripted_keys {
            if *start == self.frame {
                self.script_held.insert(key.clone());
                self.script_pressed.insert(key.clone());
            }
            if start + dur == self.frame {
                self.script_held.remove(key);
            }
        }
        if !self.scripted.is_empty() {
            if let Some(&(_, x, y)) = self.scripted.iter().find(|c| c.0 == self.frame) {
                self.mx = x;
                self.my = y;
                self.inside = true;
                self.pending_press = true;
            }
            self.pressed_keys.extend(get_keys_pressed());
            return;
        }
        let (x, y) = mouse_position();
        self.mx = ((x - view_x) / scale).floor();
        self.my = ((y - view_y) / scale).floor();
        self.inside = self.mx >= 0.0 && self.my >= 0.0 && self.mx < w as f32 && self.my < h as f32;
        self.down = is_mouse_button_down(MouseButton::Left);
        self.right = is_mouse_button_down(MouseButton::Right);
        self.pending_press |= is_mouse_button_pressed(MouseButton::Left);
        self.pending_release |= is_mouse_button_released(MouseButton::Left);
        self.pending_wheel += mouse_wheel().1.signum();
        self.pressed_keys.extend(get_keys_pressed());
    }

    /// Edge-triggered events go to the first fixed update of the frame.
    pub fn begin_tick(&mut self) {
        self.pressed = std::mem::take(&mut self.pending_press);
        self.released = std::mem::take(&mut self.pending_release);
        self.wheel = std::mem::take(&mut self.pending_wheel);
        self.frame_press |= self.pressed;
        self.frame_release |= self.released;
        self.frame_wheel += self.wheel;
    }

    /// Before draw(): make this frame's clicks visible to UI code that runs while drawing.
    pub fn begin_draw(&mut self) {
        self.pressed = std::mem::take(&mut self.frame_press);
        self.released = std::mem::take(&mut self.frame_release);
        self.wheel = std::mem::take(&mut self.frame_wheel);
    }

    pub fn end_draw(&mut self) {
        self.pressed = false;
        self.released = false;
        self.wheel = 0.0;
    }

    pub fn end_tick(&mut self) {
        self.pressed = false;
        self.released = false;
        self.wheel = 0.0;
        self.pressed_keys.clear();
        self.script_pressed.clear();
        self.pads.end_tick();
    }

    pub fn key_down(&self, name: &str) -> bool {
        if self.script_held.contains(name) {
            return true;
        }
        if name.starts_with("pad_") || name.starts_with("lstick_") {
            return self.pads.is_down(name);
        }
        key_codes(name).iter().any(|k| is_key_down(*k))
    }

    pub fn key_pressed(&self, name: &str) -> bool {
        if self.script_pressed.contains(name) {
            return true;
        }
        if name.starts_with("pad_") || name.starts_with("lstick_") {
            return self.pads.is_pressed(name);
        }
        key_codes(name).iter().any(|k| self.pressed_keys.contains(k))
    }
}

/// Key names match the web runtime: "left", "space", "a", "1", "f9"...
fn key_codes(name: &str) -> Vec<KeyCode> {
    use KeyCode::*;
    let k = match name {
        "left" => Left, "right" => Right, "up" => Up, "down" => Down,
        "space" => Space, "enter" => Enter, "escape" => Escape, "tab" => Tab, "backspace" => Backspace,
        "shift" => return vec![LeftShift, RightShift],
        "ctrl" => return vec![LeftControl, RightControl],
        "a" => A, "b" => B, "c" => C, "d" => D, "e" => E, "f" => F, "g" => G, "h" => H, "i" => I,
        "j" => J, "k" => K, "l" => L, "m" => M, "n" => N, "o" => O, "p" => P, "q" => Q, "r" => R,
        "s" => S, "t" => T, "u" => U, "v" => V, "w" => W, "x" => X, "y" => Y, "z" => Z,
        "0" => Key0, "1" => Key1, "2" => Key2, "3" => Key3, "4" => Key4,
        "5" => Key5, "6" => Key6, "7" => Key7, "8" => Key8, "9" => Key9,
        "f1" => F1, "f2" => F2, "f3" => F3, "f4" => F4, "f5" => F5, "f6" => F6,
        "f7" => F7, "f8" => F8, "f9" => F9, "f10" => F10, "f11" => F11, "f12" => F12,
        _ => return vec![],
    };
    vec![k]
}
