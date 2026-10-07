// Screen shaders: the game image (a low-res render target) goes through one fragment shader on
// its way to the window. The built-in one combines every effect of Fx (CRT, color grading,
// distortions...) and costs nothing while all of them are off; games can also bring their own.

use macroquad::prelude::*;
use miniquad::{UniformDesc, UniformType};

pub const VERTEX: &str = r#"#version 100
attribute vec3 position;
attribute vec2 texcoord;
attribute vec4 color0;
varying lowp vec4 color;
varying vec2 uv;
uniform mat4 Model;
uniform mat4 Projection;
void main() {
    gl_Position = Projection * Model * vec4(position, 1);
    color = color0 / 255.0;
    uv = texcoord;
}"#;

/// Shared by the built-in shader and games' own: uniforms and helpers.
pub const PRELUDE: &str = r#"#version 100
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;
uniform sampler2D Texture;
uniform vec4 uA;
uniform vec4 uB;
uniform vec4 uC;
uniform vec4 uD;
uniform vec4 uE;
uniform vec4 uShock;
#define time uE.y
#define resolution uE.zw
float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 tex(vec2 p) { return texture2D(Texture, p).rgb; }
"#;

const BUILTIN: &str = r#"
vec3 hueShift(vec3 c, float h) {
    float a = h * 6.2831853;
    mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    vec3 yiq = toYIQ * c;
    float cs = cos(a);
    float sn = sin(a);
    yiq.yz = vec2(yiq.y * cs - yiq.z * sn, yiq.y * sn + yiq.z * cs);
    return toRGB * yiq;
}

void main() {
    vec2 res = resolution;
    vec2 p = uv;
    // CRT: bulge toward the edges
    if (uA.x > 0.0) {
        vec2 c = p * 2.0 - 1.0;
        c *= 1.0 + uA.x * 0.08 * (c.yx * c.yx);
        p = c * 0.5 + 0.5;
    }
    // wave: rows sway sideways
    if (uC.x > 0.0) p.x += sin(p.y * res.y * 0.12 + time * 4.0) * uC.x / res.x;
    // glitch: random strips jump sideways
    if (uE.x > 0.0) {
        float row = floor(p.y * res.y / 4.0);
        if (rand(vec2(row, floor(time * 20.0))) < uE.x * 0.4) p.x += (rand(vec2(row, time)) - 0.5) * uE.x * 0.15;
    }
    // shockwave: a ring that pushes the image outward
    if (uShock.w > 0.0) {
        vec2 d = (p - uShock.xy) * vec2(res.x / res.y, 1.0);
        float k = 1.0 - clamp(abs(length(d) - uShock.z) / 0.06, 0.0, 1.0);
        p -= normalize(d + 0.00001) * k * uShock.w * 0.03 * vec2(res.y / res.x, 1.0);
    }
    // pixelate: bigger pixels
    if (uB.w > 1.0) {
        vec2 b = uB.w / res;
        p = (floor(p / b) + 0.5) * b;
    }
    vec3 col;
    if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) col = vec3(0.0);
    else if (uA.w > 0.0) {
        // chromatic aberration: red and blue drift apart
        vec2 o = vec2(uA.w / res.x, 0.0);
        col = vec3(tex(p + o).r, tex(p).g, tex(p - o).b);
    } else col = tex(p);
    // bloom: bright neighbors glow
    if (uD.w > 0.0) {
        vec3 g = vec3(0.0);
        for (int i = -2; i <= 2; i++)
            for (int j = -2; j <= 2; j++)
                g += max(tex(p + vec2(float(i), float(j)) * 1.5 / res) - 0.6, 0.0);
        col += g / 25.0 * uD.w * 2.5;
    }
    // color grading
    col = (col - 0.5) * uC.z + 0.5;
    col *= uC.y;
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, uC.w);
    if (uD.x != 0.0) col = hueShift(col, uD.x);
    l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(l), uB.x);
    vec3 sep = vec3(dot(col, vec3(0.393, 0.769, 0.189)), dot(col, vec3(0.349, 0.686, 0.168)), dot(col, vec3(0.272, 0.534, 0.131)));
    col = mix(col, sep, uB.y);
    col = mix(col, 1.0 - col, uB.z);
    if (uD.y > 1.0) col = floor(col * uD.y + 0.5) / uD.y;
    // scanlines (one per game row) and vignette; CRT turns both on a little
    float sl = max(uA.y, uA.x * 0.5);
    // a soft dip between rows (a hard edge would shimmer into moire when the window scale is uneven)
    if (sl > 0.0) col *= 1.0 - sl * 0.4 * (0.5 - 0.5 * cos(fract(p.y * res.y) * 6.2831853));
    float vg = max(uA.z, uA.x * 0.6);
    if (vg > 0.0) {
        vec2 c = p - 0.5;
        col *= 1.0 - vg * dot(c, c) * 1.6;
    }
    if (uD.z > 0.0) col += (rand(uv * res + time) - 0.5) * uD.z * 0.25;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
"#;

/// Effect values, in the shader's uniform layout. All zero = "off" (plus the neutral color ones).
#[derive(Clone, Copy, PartialEq)]
pub struct Params {
    /// crt, scanlines, vignette, aberration
    pub a: [f32; 4],
    /// grayscale, sepia, invert, pixelate
    pub b: [f32; 4],
    /// wave, brightness, contrast, saturation
    pub c: [f32; 4],
    /// hue, posterize, noise, bloom
    pub d: [f32; 4],
    /// glitch
    pub glitch: f32,
    /// shockwave: center (0..1), radius, strength
    pub shock: [f32; 4],
}

impl Default for Params {
    fn default() -> Self {
        Params { a: [0.0; 4], b: [0.0; 4], c: [0.0, 1.0, 1.0, 1.0], d: [0.0; 4], glitch: 0.0, shock: [0.0; 4] }
    }
}

pub struct Post {
    builtin: Material,
    custom: Option<Material>,
    pub params: Params,
}

fn uniforms() -> Vec<UniformDesc> {
    ["uA", "uB", "uC", "uD", "uE", "uShock"].iter().map(|n| UniformDesc::new(n, UniformType::Float4)).collect()
}

fn compile(fragment: &str) -> Result<Material, String> {
    load_material(
        ShaderSource::Glsl { vertex: VERTEX, fragment },
        MaterialParams { uniforms: uniforms(), ..Default::default() },
    )
    .map_err(|e| format!("{e:?}"))
}

impl Post {
    pub fn new() -> Post {
        let builtin = compile(&format!("{PRELUDE}{BUILTIN}")).expect("post shader");
        Post { builtin, custom: None, params: Params::default() }
    }

    /// A game's own fragment shader (its main() after the prelude); None goes back to the built-in.
    pub fn set_custom(&mut self, src: Option<&str>) -> Result<(), String> {
        self.custom = match src {
            Some(s) => Some(compile(&format!("{PRELUDE}{s}")).map_err(|e| format!("shader: {e}"))?),
            None => None,
        };
        Ok(())
    }

    /// The material to draw the game image with, uniforms set; None = plain copy.
    pub fn material(&self, w: f32, h: f32) -> Option<&Material> {
        let p = &self.params;
        let on = self.custom.is_some() || *p != Params::default();
        if !on {
            return None;
        }
        let m = self.custom.as_ref().unwrap_or(&self.builtin);
        m.set_uniform("uA", p.a);
        m.set_uniform("uB", p.b);
        m.set_uniform("uC", p.c);
        m.set_uniform("uD", p.d);
        m.set_uniform("uE", [p.glitch, get_time() as f32, w, h]);
        m.set_uniform("uShock", p.shock);
        Some(m)
    }
}
