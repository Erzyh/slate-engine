// slate-player: runs a .slate cartridge natively (Windows / macOS / Linux, Android later).
//
//   slate-player game.slate            run a cartridge file
//   slate-player game.slate --watch    reload sprites/code when the file changes (editor live mode)
//   (no args, cartridge appended)      exported game
//
// F3 toggles the FPS overlay.
// Testing: SLATE_BENCH=<frames> writes the average CPU frame time to slate-bench.txt and exits.
//          SLATE_SHOT=<file.png> (+ SLATE_SHOT_FRAME=<n> or SLATE_SHOT_SECS=<s>) saves the game image and exits.
// Recording: SLATE_RECORD=<dir> runs exactly one 60 Hz tick per frame (deterministic, independent of
//          real time) and saves frames SLATE_RECORD_FROM..+SLATE_RECORD_FRAMES as <dir>/00000.png..., then exits.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod bitfont;
mod pad;
#[cfg(target_arch = "wasm32")]
mod web;
mod cart;
mod engine;
mod fast;
mod font;
mod gfx;
mod script;

use cart::{Cartridge, Source};
use engine::{parse_hex, Engine, Shared};
use macroquad::prelude::*;
use script::Script;
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::OnceLock;

const STEP: f64 = 1.0 / 60.0;

static CART: OnceLock<Result<(Cartridge, Source), String>> = OnceLock::new();

fn cart() -> &'static Result<(Cartridge, Source), String> {
    CART.get_or_init(cart::load)
}

fn window_conf() -> macroquad::conf::Conf {
    // `--licenses` writes the licenses of the bundled fonts next to the game and quits
    if std::env::args().any(|a| a == "--licenses") {
        let _ = std::fs::write("slate-licenses.txt", bitfont::LICENSES);
        std::process::exit(0);
    }
    let (title, w, h) = match cart() {
        Ok((c, _)) => {
            // open at the largest integer scale that comfortably fits a 1080p screen
            let (cw, ch) = (c.resolution.0.max(1) as i32, c.resolution.1.max(1) as i32);
            let s = (1600 / cw).min(1000 / ch).max(1);
            (c.name.clone(), cw * s, ch * s)
        }
        Err(_) => ("Slate".to_string(), 960, 540),
    };
    macroquad::conf::Conf {
        miniquad_conf: macroquad::miniquad::conf::Conf {
            window_title: title,
            window_width: w,
            window_height: h,
            window_resizable: true,
            fullscreen: cart().as_ref().map(|(c, _)| c.fullscreen).unwrap_or(false),
            high_dpi: false,
            ..Default::default()
        },
        draw_call_vertex_capacity: 40000,
        draw_call_index_capacity: 60000,
        ..Default::default()
    }
}

fn decode_music(c: &Cartridge) -> std::collections::HashMap<String, Vec<u8>> {
    c.music.iter().filter_map(|(k, v)| cart::decode_data_url(v).ok().map(|b| (k.clone(), b))).collect()
}

fn decode_sounds(c: &Cartridge) -> std::collections::HashMap<String, Vec<u8>> {
    c.sounds.iter().filter_map(|(k, v)| cart::decode_data_url(v).ok().map(|b| (k.clone(), b))).collect()
}

fn decode_sprites(c: &Cartridge) -> (Vec<gfx::SpriteSrc>, Vec<String>) {
    let mut errors = vec![];
    let sprites = c
        .sprites
        .iter()
        .map(|s| {
            let mut frames: Vec<cart::Image> = s
                .frames
                .iter()
                .filter_map(|f| cart::decode_frame(f).map_err(|e| errors.push(format!("{}: {e}", s.name))).ok())
                .collect();
            if let Some(sheet) = &s.sheet {
                match cart::decode_frame(sheet) {
                    Ok(img) => frames = cart::split_sheet(&img, s.w, s.h, s.count),
                    Err(e) => errors.push(format!("{}: {e}", s.name)),
                }
            }
            gfx::SpriteSrc { name: s.name.clone(), fps: s.fps, durations: s.durations.clone(), frames, tags: s.tags.clone(), flags: s.flags.clone() }
        })
        .collect();
    (sprites, errors)
}

struct Game {
    eng: Shared,
    script: Option<Script>,
    error: Option<String>,
    bg: Color,
    acc: f64,
    fixed: bool,
    stats: bool,
    /// the window mode currently applied
    fullscreen: bool,
    code: String,
    update_ms: f64,
}

impl Game {
    fn new(c: &Cartridge) -> Game {
        let (sprites, errors) = decode_sprites(c);
        let gfx = gfx::Gfx::new(c.resolution.0, c.resolution.1, &sprites);
        let mut engine = Engine::new(gfx, &c.name);
        engine.set_maps(&c.maps);
        engine.mixer.music_src = decode_music(c);
        engine.mixer.sound_src = decode_sounds(c);
        engine.fullscreen = c.fullscreen;
        let eng = Rc::new(RefCell::new(engine));
        let bg = parse_hex(c.background.as_deref().unwrap_or("#000000")).unwrap_or([0, 0, 0, 255]);
        let mut g = Game {
            eng,
            script: None,
            error: errors.into_iter().next(),
            bg: Color::from_rgba(bg[0], bg[1], bg[2], 255),
            acc: 0.0,
            fixed: std::env::var("SLATE_RECORD").is_ok(),
            stats: std::env::var("SLATE_STATS").is_ok(),
            fullscreen: c.fullscreen,
            code: String::new(),
            update_ms: 0.0,
        };
        g.restart(script::Sources::from_cart(c), c.lang.as_deref());
        g
    }

    fn restart(&mut self, src: script::Sources, lang: Option<&str>) {
        self.code = src.key();
        self.eng.borrow_mut().time = 0.0;
        self.acc = 0.0;
        self.error = None;
        if lang == Some("js") {
            self.script = None;
            self.error = Some("this cartridge uses the legacy JS runtime; convert its code to Luau".into());
            return;
        }
        match Script::compile(&src, self.eng.clone()) {
            Ok(s) => {
                self.error = s.init().err();
                self.script = Some(s);
            }
            Err(e) => {
                self.script = None;
                self.error = Some(e);
            }
        }
    }

    /// Hot reload from the editor: new pixels keep the game state; new code restarts it.
    fn reload(&mut self, c: &Cartridge) {
        let (sprites, _) = decode_sprites(c);
        self.eng.borrow_mut().gfx.build_atlas(&sprites);
        // maps reload with the cartridge (live editing); a running game's mset changes are replaced
        self.eng.borrow_mut().set_maps(&c.maps);
        self.eng.borrow_mut().mixer.music_src = decode_music(c);
        self.eng.borrow_mut().mixer.sound_src = decode_sounds(c);
        let src = script::Sources::from_cart(c);
        if src.key() != self.code {
            self.restart(src, c.lang.as_deref());
        }
    }

    fn frame(&mut self) -> f64 {
        if is_key_pressed(KeyCode::F3) {
            self.stats = !self.stats;
        }
        let alt = is_key_down(KeyCode::LeftAlt) || is_key_down(KeyCode::RightAlt);
        if is_key_pressed(KeyCode::F11) || (alt && is_key_pressed(KeyCode::Enter)) {
            let mut e = self.eng.borrow_mut();
            e.fullscreen = !e.fullscreen;
        }
        let want = self.eng.borrow().fullscreen;
        if want != self.fullscreen {
            self.fullscreen = want;
            set_fullscreen(want);
        }
        let t0 = get_time();
        {
            let mut e = self.eng.borrow_mut();
            let (vx, vy, vs, w, h) = (e.gfx.view_x, e.gfx.view_y, e.gfx.view_scale, e.gfx.width, e.gfx.height);
            e.input.poll(vx, vy, vs, w, h);
        }
        if self.error.is_none() {
            self.acc += if self.fixed { STEP } else { (get_frame_time() as f64).min(0.25) };
            let mut steps = 0;
            while self.acc >= STEP && steps < 5 {
                self.eng.borrow_mut().input.begin_tick();
                if let Some(s) = &self.script {
                    if let Err(e) = s.update(STEP) {
                        self.error = Some(e);
                    }
                }
                let mut e = self.eng.borrow_mut();
                e.input.end_tick();
                e.time += STEP;
                self.acc -= STEP;
                steps += 1;
            }
            if steps == 5 {
                self.acc = 0.0;
            }
        }

        self.update_ms = (get_time() - t0) * 1000.0;
        {
            let mut e = self.eng.borrow_mut();
            e.gfx.begin(self.bg);
            e.input.begin_draw();
        }
        if self.error.is_none() {
            if let Some(s) = &self.script {
                if let Err(e) = s.draw() {
                    self.error = Some(e);
                }
            }
        }
        self.eng.borrow_mut().input.end_draw();
        let mut e = self.eng.borrow_mut();
        e.gfx.cam_x = 0.0;
        e.gfx.cam_y = 0.0;
        e.gfx.set_blend(false);
        if let Some(err) = &self.error {
            draw_error(&mut e.gfx, err);
        }
        e.gfx.flush();
        let cpu = get_time() - t0;
        if self.stats {
            let s = format!("{} FPS  {:.2}ms  {} quads", get_fps(), cpu * 1000.0, e.gfx.quads);
            let w = e.gfx.text_width(&s, 1.0);
            e.gfx.fill(0.0, 0.0, w + 4.0, 10.0, [0, 0, 0, 170]);
            e.gfx.text(&s, 2.0, 2.0, [124, 252, 0, 255], 0, 1.0);
        }
        e.gfx.present();
        cpu
    }
}

fn draw_error(g: &mut gfx::Gfx, msg: &str) {
    let cols = ((g.width as f32 - 8.0) / 6.0) as usize;
    let mut lines = vec![];
    let mut line = String::new();
    for word in format!("ERROR: {msg}").split_whitespace() {
        if line.len() + word.len() + 1 > cols && !line.is_empty() {
            lines.push(std::mem::take(&mut line));
        }
        if !line.is_empty() {
            line.push(' ');
        }
        line.push_str(word);
    }
    lines.push(line);
    lines.truncate(6);
    let h = lines.len() as f32 * 10.0 + 6.0;
    let y0 = g.height as f32 - h;
    g.fill(0.0, y0, g.width as f32, h, [122, 16, 32, 238]);
    for (i, l) in lines.iter().enumerate() {
        g.text(l, 4.0, y0 + 4.0 + i as f32 * 10.0, [255; 4], 0, 1.0);
    }
}

#[macroquad::main(window_conf)]
async fn main() {
    let (c, source) = match cart() {
        Ok(v) => v,
        Err(e) => {
            loop {
                clear_background(Color::from_rgba(29, 27, 42, 255));
                draw_text(e, 20.0, 40.0, 24.0, WHITE);
                next_frame().await;
            }
        }
    };
    let mut game = Game::new(c);
    let watch = match source {
        Source::File(p) if std::env::args().any(|a| a == "--watch") => Some(p.clone()),
        _ => None,
    };
    let mut stamp = watch.as_deref().and_then(cart::mtime);
    let bench: Option<u32> = std::env::var("SLATE_BENCH").ok().and_then(|v| v.parse().ok());
    let (mut frames, mut cpu_total, mut upd_total) = (0u32, 0.0f64, 0.0f64);
    let shot = std::env::var("SLATE_SHOT").ok();
    let shot_frame: u32 = std::env::var("SLATE_SHOT_FRAME").ok().and_then(|v| v.parse().ok()).unwrap_or(60);
    // seconds instead of frames (frame rate varies when vsync is off)
    let shot_secs: Option<f64> = std::env::var("SLATE_SHOT_SECS").ok().and_then(|v| v.parse().ok());
    let mut shot_count = 0u32;
    let mut frame_start = get_time();

    let record = std::env::var("SLATE_RECORD").ok();
    let rec_from: u32 = std::env::var("SLATE_RECORD_FROM").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let rec_frames: u32 = std::env::var("SLATE_RECORD_FRAMES").ok().and_then(|v| v.parse().ok()).unwrap_or(600);
    let mut rec_count = 0u32;
    if let Some(d) = &record {
        let _ = std::fs::create_dir_all(d);
    }
    let errlog = std::env::var("SLATE_ERRLOG").ok();
    let mut err_written: Option<String> = None;
    loop {
        let cpu = game.frame();
        // SLATE_ERRLOG always holds the current script error (empty once it is fixed by a hot reload);
        // the editor shows it, tests read it
        if let Some(path) = &errlog {
            if game.error != err_written && (game.error.is_some() || err_written.is_some()) {
                let _ = std::fs::write(path, game.error.as_deref().unwrap_or(""));
                err_written = game.error.clone();
            }
        }
        // the editor's game view: live sprite / map edits in, errors out
        #[cfg(target_arch = "wasm32")]
        {
            if let Some(new) = web::poll_cart().and_then(|b| cart::parse(&b).ok()) {
                game.reload(&new);
            }
            if game.error != err_written {
                web::report_error(game.error.as_deref().unwrap_or(""));
                err_written = game.error.clone();
            }
        }
        game.eng.borrow_mut().mixer.play_queued().await;

        if let Some(n) = bench {
            frames += 1;
            if frames > 30 {
                cpu_total += cpu;
                upd_total += game.update_ms;
            }
            if frames == n + 30 {
                let msg = format!(
                    "bench: {:.3} ms/frame CPU (update {:.3} + draw) over {n} frames",
                    cpu_total * 1000.0 / n as f64,
                    upd_total / n as f64
                );
                println!("{msg}");
                let _ = std::fs::write("slate-bench.txt", msg);
                std::process::exit(0);
            }
        }
        if let Some(dir) = &record {
            if rec_count >= rec_from {
                game.eng.borrow().gfx.screenshot(&format!("{dir}/{:05}.png", rec_count - rec_from));
            }
            rec_count += 1;
            if rec_count >= rec_from + rec_frames {
                std::process::exit(0);
            }
        }
        if let Some(path) = &shot {
            shot_count += 1;
            if shot_secs.map(|t| get_time() >= t).unwrap_or(shot_count == shot_frame) {
                game.eng.borrow().gfx.screenshot(path);
                std::process::exit(0);
            }
        }
        if let Some(p) = &watch {
            if frames % 20 == 0 {
                let m = cart::mtime(p);
                if std::env::var("SLATE_DEBUG").is_ok() { eprintln!("watch {:?} vs {:?}", m, stamp); }
                if m != stamp {
                    stamp = m;
                    if let Ok(new) = std::fs::read(p).map_err(|e| e.to_string()).and_then(|b| cart::parse(&b)) {
                        if std::env::var("SLATE_DEBUG").is_ok() { eprintln!("reloaded"); }
                        game.reload(&new);
                    }
                }
            }
            frames = frames.wrapping_add(1);
        }
        next_frame().await;
        // Cap at ~250 fps when vsync is unavailable (hidden/minimized windows) to save CPU/battery.
        // Measured over the whole frame, so with vsync this never sleeps.
        let period = get_time() - frame_start;
        if period < 0.004 && bench.is_none() && shot.is_none() && record.is_none() && cfg!(not(target_arch = "wasm32")) {
            std::thread::sleep(std::time::Duration::from_secs_f64(0.004 - period));
        }
        frame_start = get_time();
    }
}
