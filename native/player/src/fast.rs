// Hot-path API functions (spr, rect) implemented directly on the Luau C stack.
//
// Going through mlua's safe conversions costs a registry reference per string/table value,
// which dominated frame time with thousands of sprites. These read arguments straight off the
// stack instead. Everything else in the API uses the safe layer in script.rs.

use crate::engine::{parse_hex, Shared};
use crate::cart::Tag;
use crate::gfx::{anim_frame, Region};
use mlua::ffi::{self, lua_State};
use std::cell::RefCell;
use std::ffi::c_int;

thread_local! {
    static ENGINE: RefCell<Option<Shared>> = const { RefCell::new(None) };
}

pub fn set_engine(e: Shared) {
    ENGINE.with(|slot| *slot.borrow_mut() = Some(e));
}

/// Last looked-up sprite: games draw the same sprite many times in a row.
#[derive(Default)]
pub struct SprCache {
    name: Vec<u8>,
    generation: u32,
    w: f32,
    h: f32,
    fps: f32,
    durations: Vec<f32>,
    frames: Vec<Region>,
    tags: Vec<Tag>,
}

unsafe fn bytes<'a>(l: *mut lua_State, idx: c_int) -> &'a [u8] {
    let mut len = 0usize;
    let p = ffi::lua_tolstring(l, idx, &mut len);
    if p.is_null() { &[] } else { std::slice::from_raw_parts(p as *const u8, len) }
}

unsafe fn color_at(l: *mut lua_State, idx: c_int, fallback: [u8; 4], cache: &mut std::collections::HashMap<Vec<u8>, [u8; 4]>) -> [u8; 4] {
    match ffi::lua_type(l, idx) {
        ffi::LUA_TSTRING => {
            let b = bytes(l, idx);
            if let Some(c) = cache.get(b) {
                return *c;
            }
            let c = std::str::from_utf8(b).ok().and_then(parse_hex).unwrap_or(fallback);
            cache.insert(b.to_vec(), c);
            c
        }
        ffi::LUA_TNUMBER => {
            let n = ffi::lua_tonumber(l, idx) as i64;
            [((n >> 16) & 255) as u8, ((n >> 8) & 255) as u8, (n & 255) as u8, 255]
        }
        _ => fallback,
    }
}

/// spr(name, x, y, opts?)
pub unsafe extern "C-unwind" fn spr(l: *mut lua_State) -> c_int {
    ENGINE.with(|slot| {
        let slot = slot.borrow();
        let Some(eng) = slot.as_ref() else { return 0 };
        let mut e = eng.borrow_mut();
        let e = &mut *e;
        if ffi::lua_type(l, 1) != ffi::LUA_TSTRING {
            return 0;
        }
        let name = bytes(l, 1);
        let x = ffi::lua_tonumber(l, 2) as f32;
        let y = ffi::lua_tonumber(l, 3) as f32;

        let cache = &mut e.spr_cache;
        if cache.name != name || cache.generation != e.gfx.generation {
            let Some(s) = std::str::from_utf8(name).ok().and_then(|n| e.gfx.sprites.get(n)) else { return 0 };
            cache.name.clear();
            cache.name.extend_from_slice(name);
            cache.generation = e.gfx.generation;
            cache.w = s.w;
            cache.h = s.h;
            cache.fps = s.fps;
            cache.durations.clone_from(&s.durations);
            cache.frames.clone_from(&s.frames);
            cache.tags.clone_from(&s.tags);
        }
        let n = cache.frames.len();
        if n == 0 {
            return 0;
        }
        let (sw, sh, fps) = (cache.w, cache.h, cache.fps);

        let mut at: Option<f32> = None;
        let mut tag: Option<usize> = None;
        let (mut frame, mut anim, mut scale, mut sx, mut sy, mut rot) = (0i64, false, 1.0f32, 1.0f32, 1.0f32, 0.0f32);
        let (mut ox, mut oy, mut fx, mut fy, mut alpha, mut add) = (0.0f32, 0.0f32, false, false, 1.0f32, false);
        let mut tint = [255u8; 4];
        if ffi::lua_type(l, 4) == ffi::LUA_TTABLE {
            ffi::lua_pushnil(l);
            while ffi::lua_next(l, 4) != 0 {
                // key at -2, value at -1; only read string keys (lua_tolstring would mutate numbers)
                if ffi::lua_type(l, -2) == ffi::LUA_TSTRING {
                    let num = || ffi::lua_tonumber(l, -1) as f32;
                    let flag = || ffi::lua_toboolean(l, -1) != 0;
                    match bytes(l, -2) {
                        b"frame" => frame = num() as i64,
                        b"anim" => {
                            if ffi::lua_type(l, -1) == ffi::LUA_TSTRING {
                                let want = bytes(l, -1);
                                tag = e.spr_cache.tags.iter().position(|t| t.name.as_bytes() == want);
                                anim = true;
                            } else {
                                anim = flag();
                            }
                        }
                        b"at" => at = Some(num()),
                        b"scale" => scale = num(),
                        b"sx" => sx = num(),
                        b"sy" => sy = num(),
                        b"rot" => rot = num(),
                        b"ox" => ox = num(),
                        b"oy" => oy = num(),
                        b"flipX" => fx = flag(),
                        b"flipY" => fy = flag(),
                        b"alpha" => alpha = num(),
                        b"add" => add = flag(),
                        b"tint" => tint = color_at(l, -1, [255; 4], &mut e.color_cache),
                        _ => {}
                    }
                }
                ffi::lua_pop(l, 1);
            }
        }
        let f = if anim {
            let t = at.unwrap_or(e.time as f32);
            anim_frame(n, fps, &e.spr_cache.durations, t, tag.map(|i| &e.spr_cache.tags[i]))
        } else {
            frame.rem_euclid(n as i64) as usize
        };
        let region = e.spr_cache.frames[f];
        let (w, h) = (sw * sx * scale, sh * sy * scale);
        tint[3] = (tint[3] as f32 * alpha.clamp(0.0, 1.0)).round() as u8;
        let g = &mut e.gfx;
        if add {
            g.set_blend(true);
        }
        let (ox, oy) = (ox * w, oy * h);
        if rot == 0.0 {
            let px = (x - ox - g.cam_x).round();
            let py = (y - oy - g.cam_y).round();
            g.rect_region(region, px, py, w, h, tint, fx, fy);
        } else {
            let (c, s) = (rot.cos(), rot.sin());
            let (px, py) = (x - g.cam_x, y - g.cam_y);
            let pt = |lx: f32, ly: f32| (px + lx * c - ly * s, py + lx * s + ly * c);
            g.quad(region, [pt(-ox, -oy), pt(w - ox, -oy), pt(w - ox, h - oy), pt(-ox, h - oy)], tint, fx, fy);
        }
        if add {
            g.set_blend(false);
        }
        0
    })
}

/// rect(x, y, w, h, color?)
pub unsafe extern "C-unwind" fn rect(l: *mut lua_State) -> c_int {
    ENGINE.with(|slot| {
        let slot = slot.borrow();
        let Some(eng) = slot.as_ref() else { return 0 };
        let mut e = eng.borrow_mut();
        let e = &mut *e;
        let n = |i| ffi::lua_tonumber(l, i) as f32;
        let c = color_at(l, 5, [255; 4], &mut e.color_cache);
        e.gfx.fill(n(1), n(2), n(3), n(4), c);
        0
    })
}
