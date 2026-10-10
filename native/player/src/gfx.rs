// Batch renderer on top of macroquad's low-level GL. Same design as the web runtime:
// one atlas texture (sprites + font + a white pixel), quads pushed into a CPU buffer and
// submitted in large chunks, rendered into a low-res target that is scaled up by an integer.

use crate::cart::{Image, Tag};
use crate::font::{FONT_HEIGHT, GLYPHS, LINE_HEIGHT, SPACE_WIDTH};
use macroquad::miniquad::{BlendFactor, BlendState, BlendValue, Equation, PipelineParams};
use macroquad::prelude::*;
use std::collections::HashMap;

const MAX_QUADS: usize = 8000;

#[derive(Clone, Copy, Default)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

pub struct Sprite {
    pub w: f32,
    pub h: f32,
    pub fps: f32,
    pub durations: Vec<f32>,
    pub frames: Vec<Region>,
    pub tags: Vec<Tag>,
    pub flags: Vec<u32>,
    pub hitbox: Option<[f32; 4]>,
    /// per frame: (animation, position in it) for animated tiles
    pub anim_of: Vec<Option<(usize, usize)>>,
    pub tile_anims: Vec<crate::cart::TileAnim>,
}

impl Sprite {
    /// The frame to draw for tile frame f at time t (animated tiles cycle).
    pub fn tile_frame(&self, f: usize, t: f64) -> usize {
        match self.anim_of.get(f).copied().flatten() {
            Some((a, pos)) => {
                let an = &self.tile_anims[a];
                let n = an.frames.len().max(1);
                an.frames[(pos + (t * an.fps as f64).floor() as usize) % n]
            }
            None => f,
        }
    }
}

/// Decoded sprite ready for the atlas.
pub struct SpriteSrc {
    pub name: String,
    pub fps: f32,
    pub durations: Vec<f32>,
    pub frames: Vec<Image>,
    pub tags: Vec<Tag>,
    pub flags: Vec<u32>,
    pub hitbox: Option<[f32; 4]>,
    pub tile_anims: Vec<crate::cart::TileAnim>,
}

/// Frame index for animation time t (seconds), optionally limited to a tag's range.
/// Frames last `durations[i]` ms when given (Aseprite-style), otherwise 1/fps.
pub fn anim_frame(n: usize, fps: f32, durations: &[f32], t: f32, tag: Option<&Tag>) -> usize {
    let (from, to) = match tag {
        Some(tg) => (tg.from.min(n - 1), tg.to.min(n - 1).max(tg.from.min(n - 1))),
        None => (0, n - 1),
    };
    let len = to - from + 1;
    let dir = tag.map(|t| t.dir.as_str()).unwrap_or("forward");
    // frame shown at step k of one cycle
    let order = |k: usize| -> usize {
        match dir {
            "reverse" => to - k,
            "pingpong" => {
                if k < len { from + k } else { to - (k - len + 1) }
            }
            _ => from + k,
        }
    };
    let steps = if dir == "pingpong" { (len * 2).saturating_sub(2).max(1) } else { len };
    if durations.iter().all(|d| *d <= 0.0) {
        let step = (t * fps).max(0.0).floor() as usize;
        return order(step % steps);
    }
    let dur = |f: usize| durations.get(f).copied().filter(|d| *d > 0.0).map(|d| d / 1000.0).unwrap_or(1.0 / fps.max(1.0));
    let cycle: f32 = (0..steps).map(|k| dur(order(k))).sum();
    let mut rest = t.max(0.0) % cycle.max(1e-6);
    for k in 0..steps {
        let f = order(k);
        rest -= dur(f);
        if rest < 0.0 {
            return f;
        }
    }
    order(steps - 1)
}

#[derive(Clone, Copy)]
pub struct Glyph {
    pub region: Region,
    pub width: f32,
}

#[derive(Clone)]
struct Packer {
    x: u32,
    y: u32,
    row: u32,
    size: u32,
}

impl Packer {
    fn alloc(&mut self, w: u32, h: u32) -> Option<Region> {
        if self.x + w + 1 > self.size {
            self.x = 1;
            self.y += self.row + 1;
            self.row = 0;
        }
        if self.y + h + 1 > self.size {
            return None;
        }
        let r = Region { x: self.x, y: self.y, w, h };
        self.x += w + 1;
        self.row = self.row.max(h);
        Some(r)
    }
}

pub struct Gfx {
    pub width: u32,
    pub height: u32,
    /// how the game image fills the window: 0 pixel (whole-number scale), 1 fit (any scale, keeps the
    /// aspect), 2 expand (whole-number scale; the game image grows to fill the window: W / H change)
    pub scale_mode: u8,
    /// the cartridge's resolution (expand never goes below it)
    pub base: (u32, u32),
    atlas: Texture2D,
    atlas_size: f32,
    pub sprites: HashMap<String, Sprite>,
    glyphs: Vec<Option<Glyph>>,
    white: Region,
    verts: Vec<Vertex>,
    indices: Vec<u16>,
    additive: bool,
    add_material: Material,
    /// normal alpha blending that keeps the target opaque (alpha: one, one-minus-src-alpha)
    normal_material: Material,
    target: RenderTarget,
    pub cam_x: f32,
    pub cam_y: f32,
    /// Where the game image sits on screen, for mapping the mouse.
    pub view_x: f32,
    pub view_y: f32,
    pub view_scale: f32,
    pub quads: usize,
    /// Bumped whenever the atlas is rebuilt (invalidates cached regions).
    pub generation: u32,
    /// Default font for text(): 0 = classic 5x7, 1..=3 = ERXPIXEL (bitfont.rs)
    pub font: u8,
    /// Bitmap-font glyphs uploaded to the atlas so far: (font, char) -> (region, x, y, advance)
    dyn_glyphs: HashMap<(u8, u32), Option<(Region, i8, i8, u8)>>,
    /// Free space of the atlas, for glyphs added while the game runs
    packer: Packer,
    /// screen shaders (Fx effects, a game's own shader) applied when the frame is shown
    pub post: crate::post::Post,
}

const VERTEX: &str = r#"#version 100
attribute vec3 position;
attribute vec2 texcoord;
attribute vec4 color0;
varying lowp vec2 uv;
varying lowp vec4 color;
uniform mat4 Model;
uniform mat4 Projection;
void main() {
    gl_Position = Projection * Model * vec4(position, 1);
    color = color0 / 255.0;
    uv = texcoord;
}"#;

const FRAGMENT: &str = r#"#version 100
varying lowp vec4 color;
varying lowp vec2 uv;
uniform sampler2D Texture;
void main() {
    gl_FragColor = color * texture2D(Texture, uv);
}"#;

impl Gfx {
    pub fn new(width: u32, height: u32, sprites: &[SpriteSrc]) -> Gfx {
        // Both materials blend the alpha channel separately so the low-res target stays opaque:
        // translucent shapes must darken/tint what is below, not punch holes in the frame.
        let material = |color: BlendState, alpha: BlendState| {
            load_material(
                ShaderSource::Glsl { vertex: VERTEX, fragment: FRAGMENT },
                MaterialParams {
                    pipeline_params: PipelineParams { color_blend: Some(color), alpha_blend: Some(alpha), ..Default::default() },
                    ..Default::default()
                },
            )
            .expect("material")
        };
        let add_material = material(
            BlendState::new(Equation::Add, BlendFactor::Value(BlendValue::SourceAlpha), BlendFactor::One),
            BlendState::new(Equation::Add, BlendFactor::Zero, BlendFactor::One),
        );
        let normal_material = material(
            BlendState::new(Equation::Add, BlendFactor::Value(BlendValue::SourceAlpha), BlendFactor::OneMinusValue(BlendValue::SourceAlpha)),
            BlendState::new(Equation::Add, BlendFactor::One, BlendFactor::OneMinusValue(BlendValue::SourceAlpha)),
        );
        let target = render_target(width, height);
        target.texture.set_filter(FilterMode::Nearest);
        let mut g = Gfx {
            width,
            height,
            scale_mode: 0,
            base: (width, height),
            atlas: Texture2D::empty(),
            atlas_size: 1.0,
            sprites: HashMap::new(),
            glyphs: vec![None; 128],
            white: Region::default(),
            verts: Vec::with_capacity(MAX_QUADS * 4),
            indices: Vec::with_capacity(MAX_QUADS * 6),
            additive: false,
            add_material,
            normal_material,
            target,
            cam_x: 0.0,
            cam_y: 0.0,
            view_x: 0.0,
            view_y: 0.0,
            view_scale: 1.0,
            quads: 0,
            generation: 0,
            font: 0,
            dyn_glyphs: HashMap::new(),
            packer: Packer { x: 1, y: 1, row: 0, size: 1 },
            post: crate::post::Post::new(),
        };
        g.build_atlas(sprites);
        g
    }

    /// (Re)build the atlas from all sprite frames plus the font.
    pub fn build_atlas(&mut self, sprites: &[SpriteSrc]) {
        let total: u64 = sprites.iter().flat_map(|s| &s.frames).map(|i| ((i.w + 1) * (i.h + 1)) as u64).sum();
        let mut size = 512u32;
        // spare room for bitmap-font glyphs (Hangul etc.) uploaded while the game runs
        while (size as u64 * size as u64) < total * 2 + 64 * 64 + 384 * 384 {
            size *= 2;
        }
        let size = size.min(8192);
        let mut pixels = vec![0u8; (size * size * 4) as usize];
        let mut packer = Packer { x: 1, y: 1, row: 0, size };
        let mut blit = |img: &Image, packer: &mut Packer| -> Region {
            let r = packer.alloc(img.w, img.h).expect("sprite atlas is full");
            for y in 0..img.h {
                let src = (y * img.w * 4) as usize;
                let dst = (((r.y + y) * size + r.x) * 4) as usize;
                pixels[dst..dst + (img.w * 4) as usize].copy_from_slice(&img.rgba[src..src + (img.w * 4) as usize]);
            }
            r
        };
        self.white = blit(&Image { w: 1, h: 1, rgba: vec![255; 4] }, &mut packer);
        for (ch, rows) in GLYPHS {
            let w = rows[0].len() as u32;
            let mut rgba = vec![0u8; (w * FONT_HEIGHT as u32 * 4) as usize];
            for (y, row) in rows.iter().enumerate() {
                for (x, c) in row.bytes().enumerate() {
                    if c == b'#' {
                        let o = (y * w as usize + x) * 4;
                        rgba[o..o + 4].copy_from_slice(&[255, 255, 255, 255]);
                    }
                }
            }
            let region = blit(&Image { w, h: FONT_HEIGHT as u32, rgba }, &mut packer);
            self.glyphs[*ch as usize] = Some(Glyph { region, width: w as f32 });
        }
        self.sprites.clear();
        for s in sprites {
            let regions: Vec<Region> = s.frames.iter().map(|f| blit(f, &mut packer)).collect();
            let (w, h) = s.frames.first().map(|f| (f.w as f32, f.h as f32)).unwrap_or((0.0, 0.0));
            let mut anim_of = vec![None; regions.len()];
            for (a, an) in s.tile_anims.iter().enumerate() {
                for (pos, &f) in an.frames.iter().enumerate() {
                    if let Some(slot) = anim_of.get_mut(f) {
                        *slot = Some((a, pos));
                    }
                }
            }
            let tile_anims = s.tile_anims.iter().map(|a| crate::cart::TileAnim { frames: a.frames.iter().copied().filter(|&f| f < regions.len()).collect(), fps: a.fps }).collect();
            self.sprites.insert(s.name.clone(), Sprite { w, h, fps: s.fps, durations: s.durations.clone(), frames: regions, tags: s.tags.clone(), flags: s.flags.clone(), hitbox: s.hitbox, anim_of, tile_anims });
        }
        self.atlas = Texture2D::from_rgba8(size as u16, size as u16, &pixels);
        self.atlas.set_filter(FilterMode::Nearest);
        self.atlas_size = size as f32;
        self.generation += 1;
        self.packer = packer;
        self.dyn_glyphs.clear();
    }

    /// A bitmap-font glyph in the atlas (uploaded on first use). None = no such glyph or atlas full.
    fn bit_glyph(&mut self, font: u8, ch: char) -> Option<(Region, i8, i8, u8)> {
        if let Some(g) = self.dyn_glyphs.get(&(font, ch as u32)) {
            return *g;
        }
        let f = crate::bitfont::get(font)?;
        let out = f.glyph(ch).map(|g| {
            if g.w == 0 || g.h == 0 {
                return (Region::default(), 0, 0, g.adv);
            }
            match self.packer.alloc(g.w as u32, g.h as u32) {
                Some(r) => {
                    let img = macroquad::texture::Image { bytes: f.rgba(g), width: g.w as u16, height: g.h as u16 };
                    self.atlas.update_part(&img, r.x as i32, r.y as i32, g.w as i32, g.h as i32);
                    (r, g.x, g.y, g.adv)
                }
                None => (Region::default(), 0, 0, g.adv),
            }
        });
        self.dyn_glyphs.insert((font, ch as u32), out);
        out
    }

    /// Break s into lines no wider than `width`: at spaces when possible (also for Korean, which
    /// breaks between words), inside a word only when it doesn't fit on a line by itself.
    pub fn wrap_in(&self, font: u8, s: &str, width: f32, scale: f32) -> Vec<String> {
        let mut out = Vec::new();
        for para in s.split('\n') {
            let mut line = String::new();
            for word in para.split(' ') {
                let candidate = if line.is_empty() { word.to_string() } else { format!("{line} {word}") };
                if self.text_width_in(font, &candidate, scale) <= width {
                    line = candidate;
                    continue;
                }
                if !line.is_empty() {
                    out.push(std::mem::take(&mut line));
                }
                // a word longer than the line: break it between characters
                for ch in word.chars() {
                    let mut next = line.clone();
                    next.push(ch);
                    if !line.is_empty() && self.text_width_in(font, &next, scale) > width {
                        out.push(std::mem::take(&mut line));
                        line.push(ch);
                    } else {
                        line = next;
                    }
                }
            }
            out.push(line);
        }
        out
    }

    pub fn line_height(&self, font: u8) -> f32 {
        crate::bitfont::get(font).map(|f| f.cell as f32 + 1.0).unwrap_or(LINE_HEIGHT)
    }

    // ------------------------------------------------------------ frame

    pub fn begin(&mut self, clear: Color) {
        set_camera(&Camera2D {
            zoom: vec2(2.0 / self.width as f32, 2.0 / self.height as f32),
            target: vec2(self.width as f32 / 2.0, self.height as f32 / 2.0),
            render_target: Some(self.target.clone()),
            ..Default::default()
        });
        clear_background(clear);
        self.cam_x = 0.0;
        self.cam_y = 0.0;
        self.quads = 0;
        // present() switched back to the default material: re-apply ours
        self.additive = false;
        gl_use_material(&self.normal_material);
    }

    pub fn clear(&mut self, c: Color) {
        self.flush();
        clear_background(c);
    }

    pub fn set_blend(&mut self, additive: bool) {
        if additive == self.additive {
            return;
        }
        self.flush();
        self.additive = additive;
        gl_use_material(if additive { &self.add_material } else { &self.normal_material });
    }

    pub fn flush(&mut self) {
        if self.verts.is_empty() {
            return;
        }
        let gl = unsafe { get_internal_gl() }.quad_gl;
        gl.texture(Some(&self.atlas));
        gl.draw_mode(DrawMode::Triangles);
        gl.geometry(&self.verts, &self.indices);
        self.verts.clear();
        self.indices.clear();
    }

    /// Corners clockwise from top-left.
    #[allow(clippy::too_many_arguments)]
    pub fn quad(&mut self, r: Region, p: [(f32, f32); 4], color: [u8; 4], flip_x: bool, flip_y: bool) {
        if self.verts.len() >= MAX_QUADS * 4 {
            self.flush();
        }
        let s = self.atlas_size;
        let (mut u0, mut v0, mut u1, mut v1) =
            (r.x as f32 / s, r.y as f32 / s, (r.x + r.w) as f32 / s, (r.y + r.h) as f32 / s);
        if flip_x {
            std::mem::swap(&mut u0, &mut u1);
        }
        if flip_y {
            std::mem::swap(&mut v0, &mut v1);
        }
        let base = self.verts.len() as u16;
        let uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)];
        for i in 0..4 {
            self.verts.push(Vertex {
                position: vec3(p[i].0, p[i].1, 0.0),
                uv: vec2(uv[i].0, uv[i].1),
                color,
                normal: Vec4::ZERO,
            });
        }
        self.indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
        self.quads += 1;
    }

    pub fn rect_region(&mut self, r: Region, x: f32, y: f32, w: f32, h: f32, color: [u8; 4], fx: bool, fy: bool) {
        self.quad(r, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], color, fx, fy);
    }

    pub fn fill(&mut self, x: f32, y: f32, w: f32, h: f32, color: [u8; 4]) {
        let (x, y) = ((x - self.cam_x).round(), (y - self.cam_y).round());
        self.rect_region(self.white, x, y, w.round(), h.round(), color, false, false);
    }

    // ------------------------------------------------------------ text

    /// Width of one character: (pixels, is it the classic font with its 1 px gap?)
    fn advance(&self, font: u8, ch: char) -> (f32, bool) {
        if font == 0 {
            if let Some(g) = self.glyph(ch) {
                return (g.width + 1.0, true);
            }
            if ch == ' ' || ch.is_ascii() {
                return (SPACE_WIDTH + 1.0, true);
            }
            // other characters (Hangul...) come from ERXPIXEL A
            return (crate::bitfont::get(1).and_then(|f| f.glyph(ch).map(|g| g.adv as f32)).unwrap_or(6.0), false);
        }
        let f = crate::bitfont::get(font);
        (f.and_then(|f| f.glyph(ch).map(|g| g.adv as f32)).unwrap_or(f.map(|f| f.cell as f32 / 2.0).unwrap_or(6.0)), false)
    }

    pub fn text_width(&self, s: &str, scale: f32) -> f32 {
        self.text_width_in(self.font, s, scale)
    }

    pub fn text_width_in(&self, font: u8, s: &str, scale: f32) -> f32 {
        let mut best: f32 = 0.0;
        let (mut w, mut gap) = (0.0, false);
        for ch in s.chars() {
            if ch == '\n' {
                best = best.max(if gap { w - scale } else { w });
                w = 0.0;
                continue;
            }
            let (a, g) = self.advance(font, ch);
            w += a * scale;
            gap = g;
        }
        // the classic font adds 1 px after every glyph; don't count the last one
        let w = best.max(if gap { w - scale } else { w });
        if s.is_empty() { 0.0 } else { w }
    }

    fn glyph(&self, ch: char) -> Option<Glyph> {
        self.glyphs.get(ch as usize).copied().flatten()
    }

    /// align: 0 left, 1 center, 2 right
    pub fn text(&mut self, s: &str, x: f32, y: f32, color: [u8; 4], align: u8, scale: f32) {
        self.text_in(self.font, s, x, y, color, align, scale)
    }

    /// With the classic font, a line that also has ERXPIXEL characters (Hangul...) is laid out on a
    /// 14 px line: the tall glyphs' tops sit at y and the classic letters drop to share their baseline.
    /// How far the classic letters drop on such a line (0 when the line has none).
    pub fn line_drop(&self, font: u8, line: &str) -> f32 {
        if font == 0 && line.chars().any(|ch| !ch.is_ascii() && self.glyph(ch).is_none()) {
            crate::bitfont::get(1).map(|f| f.asc as f32).unwrap_or(12.0) - FONT_HEIGHT as f32
        } else {
            0.0
        }
    }

    /// The height of the drawn text: from the top of the line box to its bottom, line by line.
    pub fn text_height(&self, font: u8, s: &str, scale: f32) -> f32 {
        let lines: Vec<&str> = s.split('\n').collect();
        let mut h = 0.0;
        for (i, line) in lines.iter().enumerate() {
            if i + 1 < lines.len() {
                h += self.line_advance(font, line);
            } else if font != 0 || self.line_drop(font, line) > 0.0 {
                h += crate::bitfont::get(font.max(1)).map(|f| f.cell as f32).unwrap_or(14.0);
            } else {
                h += FONT_HEIGHT as f32;
            }
        }
        h * scale
    }

    fn line_advance(&self, font: u8, line: &str) -> f32 {
        if font == 0 && self.line_drop(font, line) > 0.0 {
            crate::bitfont::get(1).map(|f| f.cell as f32 + 1.0).unwrap_or(LINE_HEIGHT)
        } else {
            self.line_height(font)
        }
    }

    pub fn text_in(&mut self, font: u8, s: &str, x: f32, y: f32, color: [u8; 4], align: u8, scale: f32) {
        let mut cy = (y - self.cam_y).round();
        for line in s.split('\n') {
            let lw = self.text_width_in(font, line, scale);
            let off = match align {
                1 => lw / 2.0,
                2 => lw,
                _ => 0.0,
            };
            let drop = (self.line_drop(font, line) * scale).round();
            let mut cx = (x - self.cam_x - off).round();
            for ch in line.chars() {
                let (adv, _) = self.advance(font, ch);
                if font == 0 {
                    if let Some(g) = self.glyph(ch) {
                        self.rect_region(g.region, cx, cy + drop, g.width * scale, FONT_HEIGHT as f32 * scale, color, false, false);
                    } else if !ch.is_ascii() {
                        // fallback glyph, on the same baseline as the classic letters
                        if let Some((r, gx, gy, _)) = self.bit_glyph(1, ch) {
                            let top = cy + drop + (FONT_HEIGHT as f32 - crate::bitfont::get(1).map(|f| f.asc as f32).unwrap_or(12.0)) * scale;
                            if r.w > 0 {
                                self.rect_region(r, cx + gx as f32 * scale, top + gy as f32 * scale, r.w as f32 * scale, r.h as f32 * scale, color, false, false);
                            }
                        }
                    }
                } else if let Some((r, gx, gy, _)) = self.bit_glyph(font, ch) {
                    if r.w > 0 {
                        self.rect_region(r, cx + gx as f32 * scale, cy + gy as f32 * scale, r.w as f32 * scale, r.h as f32 * scale, color, false, false);
                    }
                }
                cx += adv * scale;
            }
            cy += self.line_advance(font, line) * scale;
        }
    }

    // ------------------------------------------------------------ present

    /// Scale the game image onto the window: largest integer scale that fits, centered.
    pub fn present(&mut self) {
        self.flush();
        gl_use_default_material();
        set_default_camera();
        clear_background(BLACK);
        let (sw, sh) = (screen_width(), screen_height());
        let (w, h) = (self.width as f32, self.height as f32);
        let fit = (sw / w).min(sh / h);
        let scale = match self.scale_mode {
            1 => fit,
            2 => {
                // whole-number scale from the base size; the image is as big as the window at that scale
                let (bw, bh) = (self.base.0 as f32, self.base.1 as f32);
                let k = (sw / bw).min(sh / bh);
                // whole numbers from 3x up (crisp); below that, exactly fit (small screens, phones)
                if k >= 3.0 { k.floor() } else { k }
            }
            _ => {
                if fit >= 1.0 { fit.floor() } else { fit }
            }
        };
        let (dw, dh) = (w * scale, h * scale);
        let (x, y) = (((sw - dw) / 2.0).floor(), ((sh - dh) / 2.0).floor());
        self.view_x = x;
        self.view_y = y;
        self.view_scale = scale;
        let shader = self.post.material(w, h).cloned();
        if let Some(m) = &shader {
            gl_use_material(m);
        }
        draw_texture_ex(
            &self.target.texture,
            x,
            y,
            WHITE,
            // positive y zoom in begin() stores the target top-down, so no flip is needed
            DrawTextureParams { dest_size: Some(vec2(dw, dh)), ..Default::default() },
        );
        if shader.is_some() {
            gl_use_default_material();
        }
    }

    /// expand mode: the game image size that fills the window at a whole-number scale (None = keep).
    pub fn wanted_size(&self) -> Option<(u32, u32)> {
        if self.scale_mode != 2 {
            return None;
        }
        let (sw, sh) = (screen_width(), screen_height());
        if sw < 8.0 || sh < 8.0 {
            return None;
        }
        let (bw, bh) = (self.base.0 as f32, self.base.1 as f32);
        let k = (sw / bw).min(sh / bh);
        let k = if k >= 3.0 { k.floor() } else { k };
        let size = (((sw / k - 0.01).ceil() as u32).max(self.base.0), ((sh / k - 0.01).ceil() as u32).max(self.base.1));
        (size != (self.width, self.height)).then_some(size)
    }

    /// A new game image size (expand mode).
    pub fn resize(&mut self, w: u32, h: u32) {
        self.width = w;
        self.height = h;
        self.target = render_target(w, h);
        self.target.texture.set_filter(FilterMode::Nearest);
    }

    /// The game image (render target) as RGBA rows, top to bottom.
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub fn frame_rgba(&self) -> (u32, u32, Vec<u8>) {
        let img = self.target.texture.get_texture_data();
        (img.width as u32, img.height as u32, img.bytes)
    }

    /// Save the game image (render target) as PNG. Used by automated tests.
    pub fn screenshot(&self, path: &str) {
        let img = self.target.texture.get_texture_data();
        let (w, h) = (img.width as u32, img.height as u32);
        let rows = img.bytes;
        let Ok(file) = std::fs::File::create(path) else { return };
        let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        if let Ok(mut wr) = enc.write_header() {
            let _ = wr.write_image_data(&rows);
        }
    }
}
