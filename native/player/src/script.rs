// Luau scripting: exposes the Slate API to game code and runs init/update/draw.
//
// Security: Luau ships without file/OS/network libraries.
// Games can only touch the world through the functions registered here.
// Saves go to a per-game folder chosen by the engine.

use crate::engine::{Engine, Shared};
use mlua::prelude::*;
use mlua::{Function, Table, UserData, UserDataFields, Value};


pub struct Script {
    _lua: Lua,
    init: Option<Function>,
    update: Option<Function>,
    draw: Option<Function>,
    /// the standard library's per-tick work (Timer, Tween, Cam shake), run before update;
    /// returning true skips this tick's update (Fx.freeze hit-stop)
    tick: Option<Function>,
    /// the standard library's drawing over the game (Fx screen effects, debug hitboxes)
    post: Option<Function>,
}

struct MouseRef(Shared);

impl UserData for MouseRef {
    fn add_fields<F: UserDataFields<Self>>(f: &mut F) {
        f.add_field_method_get("x", |_, m| Ok(m.0.borrow().input.mx));
        f.add_field_method_get("y", |_, m| Ok(m.0.borrow().input.my));
        f.add_field_method_get("down", |_, m| Ok(m.0.borrow().input.down));
        f.add_field_method_get("pressed", |_, m| Ok(m.0.borrow().input.pressed));
        f.add_field_method_get("released", |_, m| Ok(m.0.borrow().input.released));
        f.add_field_method_get("right", |_, m| Ok(m.0.borrow().input.right));
        f.add_field_method_get("wheel", |_, m| Ok(m.0.borrow().input.wheel));
        f.add_field_method_get("inside", |_, m| Ok(m.0.borrow().input.inside));
    }
}

/// Luau numbers may arrive as Integer or Number depending on the value.
fn as_num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => Some(*n),
        Value::Integer(i) => Some(*i as f64),
        _ => None,
    }
}

/// Big-number formatting for incremental games: 1234 -> "1.23K".
pub fn fmt(n: f64) -> String {
    const SUFFIX: [&str; 12] = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
    if !n.is_finite() {
        return "inf".into();
    }
    if n.abs() < 1000.0 {
        return if n.abs() < 10.0 && n.fract() != 0.0 { format!("{:.1}", n) } else { format!("{}", n.floor() as i64) };
    }
    let tier = ((n.abs().log10() / 3.0).floor() as usize).min(SUFFIX.len() - 1);
    let v = n / 10f64.powi(tier as i32 * 3);
    let num = if v < 10.0 { format!("{:.2}", v) } else if v < 100.0 { format!("{:.1}", v) } else { format!("{}", v.floor() as i64) };
    num + SUFFIX[tier]
}

impl Script {
    pub fn compile(src: &Sources, eng: Shared) -> Result<Script, String> {
        let lua = Lua::new();
        register(&lua, &eng).map_err(|e| e.to_string())?;
        crate::fast::set_engine(eng.clone());
        unsafe {
            let g = lua.globals();
            g.set("spr", lua.create_c_function(crate::fast::spr).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            g.set("rect", lua.create_c_function(crate::fast::rect).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        }
        // Not lua.sandbox(true): its "safe env" makes Luau cache global field paths at load time,
        // which would freeze live values like `mouse.x`. Isolation comes from what we expose:
        // Luau has no io/os/file access, and the few escape hatches below are removed.
        let g = lua.globals();
        for name in ["getfenv", "setfenv", "loadstring", "require", "dofile", "loadfile"] {
            g.set(name, Value::Nil).map_err(|e| e.to_string())?;
        }
        // the standard library (Anim, ...), then the main script; other scripts load with require()
        lua.load(include_str!("std.luau")).set_name("@slate/std.luau").exec().map_err(clean_error)?;
        let require = make_require(&lua, src).map_err(|e| e.to_string())?;
        g.set("require", require.clone()).map_err(|e| e.to_string())?;
        require.call::<Value>(src.main.clone()).map_err(clean_error)?;
        let g = lua.globals();
        let get = |n: &str| g.get::<Option<Function>>(n).ok().flatten();
        Ok(Script { init: get("init"), update: get("update"), draw: get("draw"), tick: get("__slate_tick"), post: get("__slate_post"), _lua: lua })
    }

    pub fn init(&self) -> Result<(), String> {
        call(&self.init, ())
    }

    pub fn update(&self, dt: f64) -> Result<(), String> {
        let skip = match &self.tick {
            Some(f) => f.call::<Option<bool>>(dt).map_err(clean_error)?.unwrap_or(false),
            None => false,
        };
        if skip {
            return Ok(());
        }
        call(&self.update, dt)
    }

    pub fn draw(&self) -> Result<(), String> {
        call(&self.draw, ())?;
        call(&self.post, ())
    }
}

fn call(f: &Option<Function>, args: impl IntoLuaMulti) -> Result<(), String> {
    match f {
        Some(f) => f.call::<()>(args).map_err(clean_error),
        None => Ok(()),
    }
}

/// Game code: one or more Luau files. `main` runs first; the others load with require("name").
pub struct Sources {
    pub main: String,
    pub files: std::collections::BTreeMap<String, String>,
}

impl Sources {
    pub fn from_cart(c: &crate::cart::Cartridge) -> Sources {
        if c.scripts.is_empty() {
            // older single-file cartridges
            let mut files = std::collections::BTreeMap::new();
            files.insert("main".to_string(), c.code.clone());
            return Sources { main: "main".into(), files };
        }
        Sources { main: c.main.clone().unwrap_or_else(|| "scripts/main.luau".into()), files: c.scripts.clone() }
    }

    /// Identity of the code, to tell whether a reload needs a restart.
    pub fn key(&self) -> String {
        let mut k = self.main.clone();
        for (p, s) in &self.files {
            k.push('\0');
            k.push_str(p);
            k.push('\0');
            k.push_str(s);
        }
        k
    }
}

/// "enemies/beetle", "./util", "../lib/vec" -> a path in `files` ("scripts/enemies/beetle.luau").
fn resolve(files: &std::collections::BTreeMap<String, String>, from: &str, name: &str) -> Option<String> {
    let name = name.trim().replace('\\', "/");
    let base_dir = from.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let joined = if name.starts_with("./") || name.starts_with("../") { format!("{base_dir}/{name}") } else { name.clone() };
    let mut parts: Vec<&str> = vec![];
    for p in joined.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(p),
        }
    }
    let path = parts.join("/");
    let cands = [path.clone(), format!("{path}.luau"), format!("{path}.lua"), format!("scripts/{path}"), format!("scripts/{path}.luau")];
    cands.into_iter().find(|c| files.contains_key(c))
}

/// require(name): runs a project script once and returns (and caches) what it returns.
fn make_require(lua: &Lua, src: &Sources) -> LuaResult<Function> {
    let files = std::rc::Rc::new(src.files.clone());
    let loaded = lua.create_table()?;
    let loading = lua.create_table()?;
    lua.create_function(move |lua, name: String| {
        let caller = lua
            .inspect_stack(1)
            .and_then(|d| d.source().source.map(|s| s.trim_start_matches('@').to_string()))
            .unwrap_or_default();
        let Some(path) = resolve(&files, &caller, &name) else {
            return Err(LuaError::RuntimeError(format!("require: no script \"{name}\" (looked in scripts/)")));
        };
        let cached: Value = loaded.get(path.as_str())?;
        if !cached.is_nil() {
            return Ok(cached);
        }
        if loading.get::<bool>(path.as_str()).unwrap_or(false) {
            return Err(LuaError::RuntimeError(format!("require: \"{path}\" requires itself (circular require)")));
        }
        loading.set(path.as_str(), true)?;
        let chunk_name = if path == "main" { "main".to_string() } else { format!("@{path}") };
        let out: mlua::MultiValue = lua.load(files[&path].as_str()).set_name(chunk_name).call(())?;
        loading.set(path.as_str(), Value::Nil)?;
        let v = out.into_iter().next().filter(|v| !v.is_nil()).unwrap_or(Value::Boolean(true));
        loaded.set(path.as_str(), v.clone())?;
        Ok(v)
    })
}

/// Keep the first line plus the script location; drop Rust-side traceback noise.
fn clean_error(e: LuaError) -> String {
    let s = e.to_string();
    let mut lines = s.lines().filter(|l| !l.trim().is_empty() && !l.contains("[C]"));
    let first = lines.next().unwrap_or("error").replace("[string \"main\"]", "line");
    first.replace("runtime error: ", "")
}

fn register(lua: &Lua, eng: &Shared) -> LuaResult<()> {
    let g = lua.globals();
    let (w, h) = {
        let e = eng.borrow();
        (e.gfx.width, e.gfx.height)
    };
    g.set("W", w)?;
    g.set("H", h)?;
    g.set("mouse", MouseRef(eng.clone()))?;

    macro_rules! func {
        ($name:literal, |$e:ident, $lua:ident, $args:tt : $t:ty| $body:expr) => {{
            let eng = eng.clone();
            g.set($name, lua.create_function(move |$lua, $args: $t| {
                #[allow(unused_mut)]
                let mut $e = eng.borrow_mut();
                $body
            })?)?;
        }};
    }

    // ---------------------------------------------------------------- drawing
    func!("cls", |e, _l, c: Option<Value>| {
        let c = e.color(c.as_ref(), [0, 0, 0, 255]);
        e.gfx.clear(macroquad::color::Color::from_rgba(c[0], c[1], c[2], 255));
        Ok(())
    });
    func!("camera", |e, _l, (x, y): (Option<f32>, Option<f32>)| {
        e.gfx.cam_x = x.unwrap_or(0.0).round();
        e.gfx.cam_y = y.unwrap_or(0.0).round();
        Ok(())
    });
    func!("blend", |e, _l, mode: Option<String>| {
        e.gfx.set_blend(mode.as_deref() == Some("add"));
        Ok(())
    });
    func!("sprite", |e, l, name: LuaString| {
        match e.gfx.sprites.get(&*name.to_str()?) {
            Some(s) => {
                let t = l.create_table()?;
                t.set("w", s.w)?;
                t.set("h", s.h)?;
                t.set("frames", s.frames.len())?;
                t.set("fps", s.fps)?;
                // tags = { name = { from, to, dir } } (frames are 0-based, like spr's frame option)
                let tags = l.create_table()?;
                for tg in &s.tags {
                    let x = l.create_table()?;
                    x.set("from", tg.from)?;
                    x.set("to", tg.to)?;
                    x.set("dir", if tg.dir.is_empty() { "forward" } else { tg.dir.as_str() })?;
                    tags.set(tg.name.as_str(), x)?;
                }
                t.set("tags", tags)?;
                t.set("durations", l.create_sequence_from(s.durations.iter().copied())?)?;
                if let Some([x, y, w, h]) = s.hitbox {
                    let b = l.create_table()?;
                    b.set("x", x)?;
                    b.set("y", y)?;
                    b.set("w", w)?;
                    b.set("h", h)?;
                    t.set("box", b)?;
                }
                Ok(Value::Table(t))
            }
            None => Ok(Value::Nil),
        }
    });
    // spr and rect are registered as raw C functions (see fast.rs)
    func!("rectline", |e, _l, (x, y, w, h, c): (f32, f32, f32, f32, Option<Value>)| {
        let c = e.color(c.as_ref(), [255; 4]);
        e.gfx.fill(x, y, w, 1.0, c);
        e.gfx.fill(x, y + h - 1.0, w, 1.0, c);
        e.gfx.fill(x, y + 1.0, 1.0, h - 2.0, c);
        e.gfx.fill(x + w - 1.0, y + 1.0, 1.0, h - 2.0, c);
        Ok(())
    });
    func!("line", |e, _l, (x0, y0, x1, y1, c): (f32, f32, f32, f32, Option<Value>)| {
        let c = e.color(c.as_ref(), [255; 4]);
        let (mut x0, mut y0, x1, y1) = (x0.round() as i32, y0.round() as i32, x1.round() as i32, y1.round() as i32);
        let (dx, dy) = ((x1 - x0).abs(), -(y1 - y0).abs());
        let (sx, sy) = (if x0 < x1 { 1 } else { -1 }, if y0 < y1 { 1 } else { -1 });
        let mut err = dx + dy;
        for _ in 0..4096 {
            e.gfx.fill(x0 as f32, y0 as f32, 1.0, 1.0, c);
            if x0 == x1 && y0 == y1 {
                break;
            }
            let e2 = 2 * err;
            if e2 >= dy {
                err += dy;
                x0 += sx;
            }
            if e2 <= dx {
                err += dx;
                y0 += sy;
            }
        }
        Ok(())
    });
    func!("circ", |e, _l, (cx, cy, r, c, fill): (f32, f32, f32, Option<Value>, Option<bool>)| {
        let c = e.color(c.as_ref(), [255; 4]);
        let r = r.round();
        let mut y = -r;
        while y <= r {
            let half = (r * r - y * y + r * 0.8).max(0.0).sqrt().round();
            if fill.unwrap_or(true) {
                e.gfx.fill(cx - half, cy + y, half * 2.0 + 1.0, 1.0, c);
            } else {
                e.gfx.fill(cx - half, cy + y, 1.0, 1.0, c);
                e.gfx.fill(cx + half, cy + y, 1.0, 1.0, c);
            }
            y += 1.0;
        }
        Ok(())
    });
    func!("text", |e, l, (s, x, y, c, o): (Value, f32, f32, Option<Value>, Option<Table>)| {
        let s = l.coerce_string(s)?.map(|s| s.to_string_lossy()).unwrap_or_else(|| "nil".into());
        let c = e.color(c.as_ref(), [255; 4]);
        e.text(&s, x, y, c, o.as_ref())
    });
    func!("textw", |e, l, (s, scale, font): (Value, Option<f32>, Option<String>)| {
        let s = l.coerce_string(s)?.map(|s| s.to_string_lossy()).unwrap_or_default();
        let f = match font {
            Some(n) => crate::bitfont::id_of(&n).ok_or_else(|| LuaError::RuntimeError(format!("textw: no font \"{n}\"")))?,
            None => e.gfx.font,
        };
        Ok(e.gfx.text_width_in(f, &s, scale.unwrap_or(1.0)))
    });
    // font(name) sets the default font for text(): "pico" (classic 5x7), "erx" (12 px, Hangul), "erx_b", "erx_gl".
    // Returns the previous one. With "pico", characters it lacks (Hangul...) still show, from "erx".
    // wrap(s, width, scale?, font?) -> { lines } that fit the width (breaks at spaces, then inside words)
    func!("wrap", |e, l, (s, width, scale, font): (Value, f32, Option<f32>, Option<String>)| {
        let s = l.coerce_string(s)?.map(|s| s.to_string_lossy()).unwrap_or_default();
        let f = match font {
            Some(n) => crate::bitfont::id_of(&n).ok_or_else(|| LuaError::RuntimeError(format!("wrap: no font \"{n}\"")))?,
            None => e.gfx.font,
        };
        Ok(e.gfx.wrap_in(f, &s, width, scale.unwrap_or(1.0)))
    });
    // texth(scale?, font?) -> height of one line of text
    func!("texth", |e, _l, (scale, font): (Option<f32>, Option<String>)| {
        let f = match font {
            Some(n) => crate::bitfont::id_of(&n).ok_or_else(|| LuaError::RuntimeError(format!("texth: no font \"{n}\"")))?,
            None => e.gfx.font,
        };
        Ok(e.gfx.line_height(f) * scale.unwrap_or(1.0))
    });
    // volume("music" | "sfx", v?) -> master volume 0..1 (sets it when v is given)
    func!("volume", |e, _l, (kind, v): (String, Option<f32>)| {
        let g = match kind.as_str() {
            "music" => &mut e.mixer.music_gain,
            "sfx" => &mut e.mixer.sfx_gain,
            _ => return Err(LuaError::RuntimeError(format!("volume: \"{kind}\" (music, sfx)"))),
        };
        if let Some(v) = v {
            *g = v.clamp(0.0, 1.0);
        }
        Ok(*g)
    });
    func!("font", |e, _l, name: Option<String>| {
        let prev = crate::bitfont::NAMES[e.gfx.font as usize].to_string();
        if let Some(n) = name {
            e.gfx.font = crate::bitfont::id_of(&n).ok_or_else(|| LuaError::RuntimeError(format!("font: no font \"{n}\" (pico, erx, erx_b, erx_gl)")))?;
        }
        Ok(prev)
    });

    // ---------------------------------------------------------------- input
    func!("key", |e, _l, k: String| Ok(e.input.key_down(&k)));
    func!("keyp", |e, _l, k: String| Ok(e.input.key_pressed(&k)));
    // input actions: btn("a") is true while any key / pad button bound to "a" is held
    func!("btn", |e, _l, a: String| {
        let keys = e.bindings.get(&a).ok_or_else(|| LuaError::RuntimeError(format!("btn: no action \"{a}\" (bind it first)")))?;
        Ok(keys.iter().any(|k| e.input.key_down(k)))
    });
    func!("btnp", |e, _l, a: String| {
        let keys = e.bindings.get(&a).ok_or_else(|| LuaError::RuntimeError(format!("btnp: no action \"{a}\" (bind it first)")))?;
        Ok(keys.iter().any(|k| e.input.key_pressed(k)))
    });
    // bind("jump", { "z", "space", "pad_a" }) - replaces the keys of an action (or makes a new one)
    func!("bind", |e, _l, (a, keys): (String, Vec<String>)| {
        e.bindings.insert(a, keys);
        Ok(())
    });
    // axis("x") / axis("y"): -1..1 from the move actions and the left stick; "rx" "ry" "lt" "rt": raw pad values
    func!("axis", |e, _l, name: String| {
        let held = |e: &Engine, a: &str| e.bindings.get(a).map(|ks| ks.iter().any(|k| !k.starts_with("lstick_") && e.input.key_down(k))).unwrap_or(false);
        let eng: &Engine = &e;
        let digital = |neg: &str, pos: &str| (held(eng, pos) as i32 - held(eng, neg) as i32) as f32;
        let p = &eng.input.pads;
        Ok(match name.as_str() {
            "x" => (digital("left", "right") + p.lx).clamp(-1.0, 1.0),
            "y" => (digital("up", "down") + p.ly).clamp(-1.0, 1.0),
            "rx" => p.rx,
            "ry" => p.ry,
            "lt" => p.lt,
            "rt" => p.rt,
            _ => return Err(LuaError::RuntimeError(format!("axis: \"{name}\" (x, y, rx, ry, lt, rt)"))),
        })
    });
    // pad() -> name of the connected gamepad, or nil
    func!("pad", |e, _l, (): ()| Ok(e.input.pads.name.clone()));
    // fullscreen() -> is it fullscreen; fullscreen(true / false) switches (players can also press F11 / Alt+Enter)
    func!("fullscreen", |e, _l, on: Option<bool>| {
        if let Some(on) = on {
            e.fullscreen = on;
        }
        Ok(e.fullscreen)
    });
    func!("hit", |e, _l, (x, y, w, h): (f32, f32, f32, f32)| {
        let (mx, my) = (e.input.mx, e.input.my);
        let (cx, cy) = (e.gfx.cam_x, e.gfx.cam_y);
        Ok(e.input.inside && mx >= x - cx && my >= y - cy && mx < x + w - cx && my < y + h - cy)
    });

    // ---------------------------------------------------------------- tile maps
    func!("map", |e, _l, (name, x, y, o): (String, Option<f32>, Option<f32>, Option<Table>)| {
        let (layer, tint): (Option<Value>, Option<Value>) = match &o {
            Some(t) => (t.get::<Option<Value>>("layer")?, t.get::<Option<Value>>("tint")?),
            None => (None, None),
        };
        let tint = e.color(tint.as_ref(), [255; 4]);
        e.draw_map(&name, x.unwrap_or(0.0), y.unwrap_or(0.0), layer.as_ref(), tint);
        Ok(())
    });
    func!("mget", |e, _l, (name, tx, ty, layer): (String, f64, f64, Option<Value>)| {
        let Some(m) = e.maps.get(&name) else { return Ok(-1) };
        let li = layer.as_ref().map(|v| crate::engine::map_layer(m, v)).unwrap_or(Some(0));
        let (tx, ty) = (tx.floor(), ty.floor());
        if tx < 0.0 || ty < 0.0 || tx as usize >= m.w || ty as usize >= m.h {
            return Ok(-1);
        }
        Ok(li.and_then(|i| m.layers[i].data.get(ty as usize * m.w + tx as usize).copied()).unwrap_or(-1))
    });
    func!("mset", |e, _l, (name, tx, ty, tile, layer): (String, f64, f64, i32, Option<Value>)| {
        let Some(m) = e.maps.get_mut(&name) else { return Ok(()) };
        let li = layer.as_ref().map(|v| crate::engine::map_layer(m, v)).unwrap_or(Some(0));
        let (tx, ty) = (tx.floor(), ty.floor());
        if tx < 0.0 || ty < 0.0 || tx as usize >= m.w || ty as usize >= m.h {
            return Ok(());
        }
        let w = m.w;
        if let Some(i) = li {
            if let Some(c) = m.layers[i].data.get_mut(ty as usize * w + tx as usize) {
                *c = tile;
            }
        }
        e.map_version += 1;
        Ok(())
    });
    // objects placed in the editor; props are also copied to the top level for convenience
    func!("objects", |e, l, (name, kind): (String, Option<String>)| {
        let out = l.create_table()?;
        let Some(m) = e.maps.get(&name) else { return Ok(out) };
        let mut i = 1;
        for o in &m.objects {
            if let Some(k) = &kind {
                if o.get("type").and_then(|v| v.as_str()) != Some(k.as_str()) {
                    continue;
                }
            }
            let mut flat = o.clone();
            if let (Some(obj), Some(props)) = (flat.as_object_mut(), o.get("props").and_then(|p| p.as_object())) {
                for (k, v) in props {
                    obj.entry(k.clone()).or_insert(v.clone());
                }
            }
            out.raw_set(i, l.to_value(&flat)?)?;
            i += 1;
        }
        Ok(out)
    });
    func!("mapinfo", |e, l, name: String| {
        let Some(m) = e.maps.get(&name) else { return Ok(Value::Nil) };
        let t = l.create_table()?;
        t.set("w", m.w)?;
        t.set("h", m.h)?;
        let (tw, th) = e.tile_size(m).unwrap_or((0.0, 0.0));
        t.set("tw", tw)?;
        t.set("th", th)?;
        let sets: Vec<String> = if m.tilesets.is_empty() { vec![m.tileset.clone()] } else { m.tilesets.clone() };
        t.set("tilesets", l.create_sequence_from(sets)?)?;
        Ok(Value::Table(t))
    });
    // fget(tileset, frame, bit), or fget(map, tile value from mget, bit) for maps with several tilesets
    func!("fget", |e, _l, (sprite, frame, bit): (String, i64, Option<u32>)| {
        let f = match e.maps.get(&sprite) {
            Some(m) => e.tile_flags(m, frame as i32),
            None => e.gfx.sprites.get(&sprite).and_then(|s| s.flags.get(frame.max(0) as usize).copied()).unwrap_or(0),
        };
        Ok((f >> bit.unwrap_or(0)) & 1 == 1)
    });
    func!("msolid", |e, _l, (name, px, py, bit): (String, f32, f32, Option<u32>)| {
        let Some(m) = e.maps.get(&name) else { return Ok(false) };
        let Some((tw, th)) = e.tile_size(m) else { return Ok(false) };
        let (tx, ty) = ((px / tw).floor(), (py / th).floor());
        if tx < 0.0 || ty < 0.0 || tx as usize >= m.w || ty as usize >= m.h {
            return Ok(false);
        }
        Ok(e.cell_solid(m, tx as i64, ty as i64, bit.unwrap_or(0)))
    });

    // ---------------------------------------------------------------- path finding (Path in std.luau)
    let query = |o: &Option<Table>| -> mlua::Result<(u32, bool)> {
        Ok(match o {
            Some(t) => (t.get::<Option<u32>>("bit")?.unwrap_or(0), t.get::<Option<bool>>("diagonal")?.unwrap_or(true)),
            None => (0, true),
        })
    };
    func!("__path_find", |e, l, (map, x0, y0, x1, y1, o): (String, f32, f32, f32, f32, Option<Table>)| {
        let (bit, diagonal) = query(&o)?;
        match crate::path::find(&mut e, &crate::path::Query { map: &map, bit, diagonal }, x0, y0, x1, y1) {
            Some(pts) => {
                let t = l.create_table()?;
                for (i, (x, y)) in pts.into_iter().enumerate() {
                    let p = l.create_table()?;
                    p.set("x", x)?;
                    p.set("y", y)?;
                    t.raw_set(i + 1, p)?;
                }
                Ok(Value::Table(t))
            }
            None => Ok(Value::Nil),
        }
    });
    func!("__path_toward", |e, _l, (map, x, y, tx, ty, o): (String, f32, f32, f32, f32, Option<Table>)| {
        let (bit, diagonal) = query(&o)?;
        Ok(match crate::path::toward(&mut e, &crate::path::Query { map: &map, bit, diagonal }, x, y, tx, ty) {
            Some((dx, dy, d)) => (Some(dx), Some(dy), Some(d)),
            None => (None, None, None),
        })
    });
    func!("__path_dist", |e, _l, (map, x, y, tx, ty, o): (String, f32, f32, f32, f32, Option<Table>)| {
        let (bit, diagonal) = query(&o)?;
        Ok(crate::path::dist(&mut e, &crate::path::Query { map: &map, bit, diagonal }, x, y, tx, ty))
    });

    // ---------------------------------------------------------------- hitboxes, playtest, debug
    // hitbox(name, x, y, { flipX, ox, oy }) -> { x, y, w, h }: the sprite's hitbox where spr() would
    // draw it (the whole sprite when it has none)
    func!("hitbox", |e, l, (name, x, y, o): (String, f32, f32, Option<Table>)| {
        let Some(s) = e.gfx.sprites.get(&name) else { return Ok(Value::Nil) };
        let (flip, ox, oy) = match &o {
            Some(t) => (t.get::<Option<bool>>("flipX")?.unwrap_or(false), t.get::<Option<f32>>("ox")?.unwrap_or(0.0), t.get::<Option<f32>>("oy")?.unwrap_or(0.0)),
            None => (false, 0.0, 0.0),
        };
        let [bx, by, bw, bh] = s.hitbox.unwrap_or([0.0, 0.0, s.w, s.h]);
        let bx = if flip { s.w - bx - bw } else { bx };
        let t = l.create_table()?;
        t.set("x", x - ox * s.w + bx)?;
        t.set("y", y - oy * s.h + by)?;
        t.set("w", bw)?;
        t.set("h", bh)?;
        Ok(Value::Table(t))
    });
    func!("playtest", |e, l, (): ()| match &e.playtest {
        Some(v) => l.to_value(v),
        None => Ok(Value::Nil),
    });
    func!("__debug_boxes", |e, _l, (): ()| Ok(e.debug_boxes));
    func!("__screen", |e, l, name: String| match e.screens.get(&name) {
        Some(v) => l.to_value(v),
        None => Ok(Value::Nil),
    });
    func!("__particle_preset", |e, l, name: String| match e.particles.get(&name) {
        Some(v) => l.to_value(v),
        None => Ok(Value::Nil),
    });

    // ---------------------------------------------------------------- screen shaders (Fx in std.luau)
    // 21 numbers in the shader's layout: crt scan vignette aberration | gray sepia invert pixelate |
    // wave bright contrast saturation | hue posterize noise bloom | glitch | shock x y radius strength
    func!("__postfx", |e, _l, v: Vec<f32>| {
        let g = |i: usize| v.get(i).copied().unwrap_or(0.0);
        let q = |i: usize| [g(i), g(i + 1), g(i + 2), g(i + 3)];
        e.gfx.post.params = crate::post::Params { a: q(0), b: q(4), c: q(8), d: q(12), glitch: g(16), shock: q(17) };
        Ok(())
    });
    func!("__shader", |e, _l, src: Option<String>| e.gfx.post.set_custom(src.as_deref()).map_err(mlua::Error::runtime));

    // ---------------------------------------------------------------- utils
    func!("t", |e, _l, (): ()| Ok(e.time));
    func!("now", |_e, _l, (): ()| {
        Ok(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0))
    });
    func!("rnd", |e, _l, (a, b): (Option<f64>, Option<f64>)| {
        let r = e.random();
        Ok(match (a, b) {
            (Some(a), Some(b)) => a + r * (b - a),
            (Some(a), None) => r * a,
            _ => r,
        })
    });
    func!("irnd", |e, _l, (a, b): (f64, f64)| Ok((a + e.random() * (b - a + 1.0)).floor()));
    func!("pick", |e, _l, t: Table| {
        let n = t.raw_len();
        if n == 0 {
            return Ok(Value::Nil);
        }
        let i = (e.random() * n as f64).floor() as usize + 1;
        t.raw_get::<Value>(i.min(n))
    });
    g.set("clamp", lua.create_function(|_, (v, lo, hi): (f64, f64, f64)| Ok(v.max(lo).min(hi)))?)?;
    g.set("lerp", lua.create_function(|_, (a, b, t): (f64, f64, f64)| Ok(a + (b - a) * t))?)?;
    g.set("fmt", lua.create_function(|_, n: f64| Ok(fmt(n)))?)?;
    func!("log", |e, l, args: mlua::Variadic<Value>| {
        let parts: Vec<String> = args
            .into_iter()
            .map(|v| match v {
                Value::Nil => "nil".into(),
                Value::Boolean(b) => b.to_string(),
                v => {
                    let kind = v.type_name();
                    l.coerce_string(v).ok().flatten().map(|s| s.to_string_lossy()).unwrap_or_else(|| format!("<{kind}>"))
                }
            })
            .collect();
        let line = parts.join(" ");
        println!("{line}");
        // test mode: SLATE_LOGFILE collects log() output
        if let Ok(path) = std::env::var("SLATE_LOGFILE") {
            use std::io::Write;
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                let _ = writeln!(f, "{line}");
            }
        }
        e.last_log = Some(line);
        Ok(())
    });

    // ---------------------------------------------------------------- save
    func!("save", |e, l, (k, v): (String, Value)| {
        let json: serde_json::Value = l.from_value(v)?;
        e.save(&k, &json.to_string());
        Ok(())
    });
    func!("load", |e, l, (k, fallback): (String, Value)| {
        match e.load(&k).and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()) {
            Some(j) => l.to_value(&j),
            None => Ok(fallback),
        }
    });
    func!("wipe", |e, _l, k: String| {
        e.wipe(&k);
        Ok(())
    });

    // ---------------------------------------------------------------- sound
    // sfx(name, volume?) plays a sound file from the project's sounds/ folder, or a built-in preset
    func!("sfx", |e, _l, (name, volume): (String, Option<f32>)| {
        if e.mixer.sound_src.contains_key(&name) {
            e.mixer.sound_queue.push((name, volume.unwrap_or(1.0).clamp(0.0, 1.0)));
        } else if let Some(notes) = crate::audio::preset(&name) {
            e.mixer.queue.push((name, notes));
        }
        Ok(())
    });
    // music(name, {volume = 1, loop = true, fade = 0.5}) crossfades to a cartridge track;
    // music() / music(nil, {fade = 2}) stops. musicname() returns what is playing.
    func!("music", |e, _l, (name, o): (Option<String>, Option<Table>)| {
        let (mut volume, mut looped, mut fade) = (1.0f32, true, 0.5f32);
        if let Some(t) = &o {
            volume = t.get::<Option<f32>>("volume")?.unwrap_or(1.0).clamp(0.0, 1.0);
            looped = t.get::<Option<bool>>("loop")?.unwrap_or(true);
            fade = t.get::<Option<f32>>("fade")?.unwrap_or(0.5);
        }
        if let Some(n) = &name {
            if !e.mixer.music_src.contains_key(n) {
                return Err(mlua::Error::RuntimeError(format!("music: no track named '{n}' in this cartridge")));
            }
        }
        e.mixer.music_cmd = Some(crate::audio::MusicCmd { name, volume, looped, fade });
        Ok(())
    });
    func!("musicname", |e, _l, (): ()| Ok(e.mixer.music_cmd.as_ref().map(|c| c.name.clone()).unwrap_or_else(|| e.mixer.music_name().map(String::from))));
    func!("beep", |e, _l, (f, d, w, v, s): (Option<f32>, Option<f32>, Option<String>, Option<f32>, Option<f32>)| {
        let n = crate::audio::Note {
            freq: f.unwrap_or(440.0),
            start: 0.0,
            dur: d.unwrap_or(0.1),
            wave: crate::audio::Wave::parse(w.as_deref().unwrap_or("square")),
            vol: v.unwrap_or(0.5),
            slide: s.unwrap_or(1.0),
        };
        let key = format!("beep:{}:{}:{:?}:{}:{}", n.freq, n.dur, w, n.vol, n.slide);
        e.mixer.queue.push((key, vec![n]));
        Ok(())
    });


    Ok(())
}

impl Engine {
    fn text(&mut self, s: &str, x: f32, y: f32, c: [u8; 4], o: Option<&Table>) -> LuaResult<()> {
        let (mut align, mut scale, mut shadow, mut outline) = (0u8, 1.0f32, None, None);
        let mut font = self.gfx.font;
        if let Some(o) = o {
            for pair in o.pairs::<LuaString, Value>() {
                let (k, v) = pair?;
                match &*k.as_bytes() {
                    b"align" => {
                        align = match v.as_string().map(|s| s.to_string_lossy()).as_deref() {
                            Some("center") => 1,
                            Some("right") => 2,
                            _ => 0,
                        }
                    }
                    b"scale" => scale = as_num(&v).unwrap_or(1.0) as f32,
                    b"font" => {
                        let n = v.as_string().map(|s| s.to_string_lossy()).unwrap_or_default();
                        font = crate::bitfont::id_of(&n).ok_or_else(|| LuaError::RuntimeError(format!("text: no font \"{n}\"")))?;
                    }
                    b"shadow" => shadow = Some(self.color(Some(&v), [0, 0, 0, 255])),
                    b"outline" => outline = Some(self.color(Some(&v), [0, 0, 0, 255])),
                    _ => {}
                }
            }
        }
        if let Some(oc) = outline {
            for (dx, dy) in [(-1.0, 0.0), (1.0, 0.0), (0.0, -1.0), (0.0, 1.0), (-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
                self.gfx.text_in(font, s, x + dx * scale, y + dy * scale, oc, align, scale);
            }
        }
        if let Some(sc) = shadow {
            self.gfx.text_in(font, s, x + scale, y + scale, sc, align, scale);
        }
        self.gfx.text_in(font, s, x, y, c, align, scale);
        Ok(())
    }
}
