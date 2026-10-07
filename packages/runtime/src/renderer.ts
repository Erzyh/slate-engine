// WebGL2 batch renderer.
// Everything (sprites, font, a white pixel for shapes) lives in one atlas texture, so a whole
// frame is usually a single draw call. The game renders into a low-res framebuffer at the
// cartridge resolution, which is then scaled up with nearest-neighbor to the canvas.

const MAX_QUADS = 16384;
const FLOATS_PER_VERT = 5; // x, y, u, v, rgba(packed)
const ATLAS_SIZE = 2048;

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

const VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_col;
uniform vec2 u_res;
out vec2 v_uv;
out vec4 v_col;
void main() {
  vec2 p = a_pos / u_res * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  v_uv = a_uv;
  v_col = a_col;
}`;

const FS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
in vec4 v_col;
out vec4 o;
void main() {
  vec4 c = texture(u_tex, v_uv) * v_col;
  if (c.a <= 0.0) discard;
  o = c;
}`;

const BLIT_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
uniform vec4 u_rect; // x, y, w, h in clip space
void main() {
  v_uv = vec2(a_pos.x, 1.0 - a_pos.y);
  vec2 p = u_rect.xy + a_pos * u_rect.zw;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
}`;

const BLIT_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 o;
void main() { o = texture(u_tex, v_uv); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link error");
  return p;
}

/** Simple shelf packer. */
class Packer {
  x = 1;
  y = 1;
  rowH = 0;
  constructor(public size: number) {}
  alloc(w: number, h: number): Region | null {
    if (this.x + w + 1 > this.size) {
      this.x = 1;
      this.y += this.rowH + 1;
      this.rowH = 0;
    }
    if (this.y + h + 1 > this.size || w + 2 > this.size) return null;
    const r = { x: this.x, y: this.y, w, h };
    this.x += w + 1;
    this.rowH = Math.max(this.rowH, h);
    return r;
  }
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private blitProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private blitVao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private verts = new Float32Array(MAX_QUADS * 4 * FLOATS_PER_VERT);
  private u32 = new Uint32Array(this.verts.buffer);
  private quads = 0;
  private atlas: WebGLTexture;
  private packer = new Packer(ATLAS_SIZE);
  private fbo: WebGLFramebuffer;
  private fboTex: WebGLTexture;
  private uRes: WebGLUniformLocation;
  private uRect: WebGLUniformLocation;
  private additive = false;
  readonly white: Region;
  drawCalls = 0;
  /** Where the game image sits on the canvas (CSS pixels), for mapping the mouse. */
  view = { x: 0, y: 0, scale: 1 };

  constructor(public canvas: HTMLCanvasElement, public width: number, public height: number) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.prog = compile(gl, VS, FS);
    this.blitProg = compile(gl, BLIT_VS, BLIT_FS);
    this.uRes = gl.getUniformLocation(this.prog, "u_res")!;
    this.uRect = gl.getUniformLocation(this.blitProg, "u_rect")!;

    // quad batch
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.verts.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_VERT * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, stride, 16);
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let i = 0, v = 0; i < idx.length; i += 6, v += 4) {
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i);
    }
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    // blit quad
    this.blitVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.blitVao);
    const bq = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, bq);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // atlas
    this.atlas = this.texture(ATLAS_SIZE, ATLAS_SIZE);
    this.white = this.upload(new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1));

    // game framebuffer
    this.fboTex = this.texture(width, height);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private texture(w: number, h: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Put an image into the atlas. Pass `into` to overwrite an existing region of the same size. */
  upload(img: ImageData, into?: Region): Region {
    const gl = this.gl;
    let r = into && into.w === img.width && into.h === img.height ? into : null;
    if (!r) {
      r = this.packer.alloc(img.width, img.height);
      if (!r) throw new Error("sprite atlas is full");
    }
    this.flush();
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, img.width, img.height, gl.RGBA, gl.UNSIGNED_BYTE, img);
    return r;
  }

  begin(clear: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(((clear >>> 24) & 255) / 255, ((clear >>> 16) & 255) / 255, ((clear >>> 8) & 255) / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    this.setBlend(false);
    this.drawCalls = 0;
  }

  clear(rgba: number) {
    this.flush();
    const gl = this.gl;
    gl.clearColor(((rgba >>> 24) & 255) / 255, ((rgba >>> 16) & 255) / 255, ((rgba >>> 8) & 255) / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  setBlend(additive: boolean) {
    if (additive === this.additive && this.drawCalls > 0) return;
    this.flush();
    this.additive = additive;
    const gl = this.gl;
    if (additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Queue a textured quad. (x0,y0)..(x3,y3) are the corners clockwise from top-left.
   * rgba is 0xRRGGBBAA.
   */
  quad(r: Region, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
    rgba: number, flipX = false, flipY = false) {
    if (this.quads >= MAX_QUADS) this.flush();
    let u0 = r.x / ATLAS_SIZE, v0 = r.y / ATLAS_SIZE, u1 = (r.x + r.w) / ATLAS_SIZE, v1 = (r.y + r.h) / ATLAS_SIZE;
    if (flipX) [u0, u1] = [u1, u0];
    if (flipY) [v0, v1] = [v1, v0];
    // vertex color is read as bytes in memory order r,g,b,a (little endian => reverse)
    const col = ((rgba & 255) << 24) | (((rgba >>> 8) & 255) << 16) | (((rgba >>> 16) & 255) << 8) | ((rgba >>> 24) & 255);
    const v = this.verts, u = this.u32;
    let o = this.quads * 4 * FLOATS_PER_VERT;
    v[o] = x0; v[o + 1] = y0; v[o + 2] = u0; v[o + 3] = v0; u[o + 4] = col; o += 5;
    v[o] = x1; v[o + 1] = y1; v[o + 2] = u1; v[o + 3] = v0; u[o + 4] = col; o += 5;
    v[o] = x2; v[o + 1] = y2; v[o + 2] = u1; v[o + 3] = v1; u[o + 4] = col; o += 5;
    v[o] = x3; v[o + 1] = y3; v[o + 2] = u0; v[o + 3] = v1; u[o + 4] = col;
    this.quads++;
  }

  /** Axis-aligned fast path. */
  rect(r: Region, x: number, y: number, w: number, h: number, rgba: number, flipX = false, flipY = false) {
    this.quad(r, x, y, x + w, y, x + w, y + h, x, y + h, rgba, flipX, flipY);
  }

  flush() {
    if (this.quads === 0) return;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniform2f(this.uRes, this.width, this.height);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.verts, 0, this.quads * 4 * FLOATS_PER_VERT);
    gl.drawElements(gl.TRIANGLES, this.quads * 6, gl.UNSIGNED_SHORT, 0);
    this.quads = 0;
    this.drawCalls++;
  }

  /** Scale the game framebuffer onto the canvas: largest integer scale that fits, centered. */
  present(letterbox = 0x000000ff) {
    this.flush();
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const fit = Math.min(cw / this.width, ch / this.height);
    const scale = fit >= 1 ? Math.floor(fit) : fit;
    const w = this.width * scale, h = this.height * scale;
    const x = Math.floor((cw - w) / 2), y = Math.floor((ch - h) / 2);
    this.view = { x: x / dpr, y: y / dpr, scale: scale / dpr };

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.BLEND);
    gl.clearColor(((letterbox >>> 24) & 255) / 255, ((letterbox >>> 16) & 255) / 255, ((letterbox >>> 8) & 255) / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.blitProg);
    gl.uniform4f(this.uRect, (x / cw) * 2 - 1, (y / ch) * 2 - 1, (w / cw) * 2, (h / ch) * 2);
    gl.bindVertexArray(this.blitVao);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }
}
