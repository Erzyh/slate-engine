// Built-in bitmap fonts with full Hangul (and Latin, kana, CJK, symbols): ERXPIXEL A / B / GL,
// 12 px pixel fonts (SIL Open Font License 1.1, see fonts/LICENSE-*.txt). Made from the TTFs by
// tools/pixel_font.py; decompressed on first use. Glyphs are uploaded to the sprite atlas lazily
// (gfx.rs), so only the characters a game actually prints take space.

use std::collections::HashMap;
use std::sync::OnceLock;

pub struct GlyphBits {
    pub x: i8,
    pub y: i8,
    pub w: u8,
    pub h: u8,
    pub adv: u8,
    offset: usize,
}

pub struct BitFont {
    /// line cell height and ascent (pixels from the cell top to the baseline)
    pub cell: u8,
    pub asc: u8,
    glyphs: HashMap<u32, GlyphBits>,
    bits: Vec<u8>,
}

impl BitFont {
    fn parse(z: &[u8]) -> BitFont {
        let raw = miniz_oxide::inflate::decompress_to_vec_zlib(z).expect("bad font data");
        assert_eq!(&raw[0..4], b"SLFT");
        let (cell, asc) = (raw[6], raw[7]);
        let n = u32::from_le_bytes(raw[8..12].try_into().unwrap()) as usize;
        let mut glyphs = HashMap::with_capacity(n);
        let mut offset = 0usize;
        for i in 0..n {
            let e = &raw[12 + i * 9..12 + i * 9 + 9];
            let cp = u32::from_le_bytes(e[0..4].try_into().unwrap());
            let (w, h) = (e[6], e[7]);
            glyphs.insert(cp, GlyphBits { x: e[4] as i8, y: e[5] as i8, w, h, adv: e[8], offset });
            offset += (w as usize).div_ceil(8) * h as usize;
        }
        let bits = raw[12 + n * 9..].to_vec();
        BitFont { cell, asc, glyphs, bits }
    }

    pub fn glyph(&self, ch: char) -> Option<&GlyphBits> {
        self.glyphs.get(&(ch as u32))
    }

    /// RGBA pixels (white on transparent) of a glyph.
    pub fn rgba(&self, g: &GlyphBits) -> Vec<u8> {
        let (w, h) = (g.w as usize, g.h as usize);
        let stride = w.div_ceil(8);
        let mut out = vec![0u8; w * h * 4];
        for r in 0..h {
            for c in 0..w {
                if self.bits[g.offset + r * stride + c / 8] & (0x80 >> (c % 8)) != 0 {
                    out[(r * w + c) * 4..(r * w + c) * 4 + 4].copy_from_slice(&[255; 4]);
                }
            }
        }
        out
    }
}

/// Font ids: 0 is the classic 5x7 font in font.rs; these are 1..=3.
pub const NAMES: [&str; 4] = ["pico", "erx", "erx_b", "erx_gl"];

static A: OnceLock<BitFont> = OnceLock::new();
static B: OnceLock<BitFont> = OnceLock::new();
static GL: OnceLock<BitFont> = OnceLock::new();

pub fn get(id: u8) -> Option<&'static BitFont> {
    match id {
        1 => Some(A.get_or_init(|| BitFont::parse(include_bytes!("../fonts/erx_a.sfnt.z")))),
        2 => Some(B.get_or_init(|| BitFont::parse(include_bytes!("../fonts/erx_b.sfnt.z")))),
        3 => Some(GL.get_or_init(|| BitFont::parse(include_bytes!("../fonts/erx_gl.sfnt.z")))),
        _ => None,
    }
}

pub fn id_of(name: &str) -> Option<u8> {
    match name {
        "pico" | "default" => Some(0),
        "erx" | "erx_a" | "korean" => Some(1),
        "erx_b" => Some(2),
        "erx_gl" => Some(3),
        _ => None,
    }
}

/// The font licenses, kept inside every player and exported game (OFL 1.1 asks for this);
/// `slate-player --licenses` prints them.
pub const LICENSES: &str = concat!(
    "Slate player
============

",
    include_str!("../../../LICENSE"),
    "

",
    include_str!("../THIRD_PARTY.txt"),
    "

ERXPIXEL fonts
==============

",
    include_str!("../fonts/LICENSE-ERXPIXEL_A.txt"),
    "\n\n",
    include_str!("../fonts/LICENSE-ERXPIXEL_B.txt"),
    "\n\n",
    include_str!("../fonts/LICENSE-ERXPIXEL_GL.txt"),
);
