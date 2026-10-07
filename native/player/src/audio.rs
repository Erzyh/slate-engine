// Tiny synth: renders notes to an in-memory WAV and plays it. Same presets as the web runtime.

use macroquad::audio::{load_sound_from_bytes, play_sound, set_sound_volume, stop_sound, PlaySoundParams, Sound};
use std::collections::HashMap;

const RATE: u32 = 22050;

#[derive(Clone, Copy, PartialEq)]
pub enum Wave {
    Square,
    Sine,
    Triangle,
    Saw,
    Noise,
}

impl Wave {
    pub fn parse(s: &str) -> Wave {
        match s {
            "sine" => Wave::Sine,
            "triangle" => Wave::Triangle,
            "sawtooth" | "saw" => Wave::Saw,
            "noise" => Wave::Noise,
            _ => Wave::Square,
        }
    }
}

#[derive(Clone, Copy)]
pub struct Note {
    pub freq: f32,
    pub start: f32,
    pub dur: f32,
    pub wave: Wave,
    pub vol: f32,
    pub slide: f32,
}

fn note(freq: f32, start: f32, dur: f32, wave: Wave, vol: f32, slide: f32) -> Note {
    Note { freq, start, dur, wave, vol, slide }
}

pub fn preset(name: &str) -> Option<Vec<Note>> {
    use Wave::*;
    Some(match name {
        "click" => vec![note(660.0, 0.0, 0.05, Square, 0.3, 1.5)],
        "coin" => vec![note(988.0, 0.0, 0.06, Square, 0.3, 1.0), note(1319.0, 0.06, 0.12, Square, 0.3, 1.0)],
        "buy" => vec![
            note(523.0, 0.0, 0.06, Triangle, 0.5, 1.0),
            note(784.0, 0.05, 0.1, Triangle, 0.5, 1.0),
            note(1047.0, 0.11, 0.15, Triangle, 0.5, 1.0),
        ],
        "error" => vec![note(150.0, 0.0, 0.15, Saw, 0.3, 0.7)],
        "hit" => vec![note(300.0, 0.0, 0.08, Noise, 0.5, 1.0)],
        "jump" => vec![note(300.0, 0.0, 0.15, Square, 0.3, 2.5)],
        "explode" => vec![note(120.0, 0.0, 0.4, Noise, 0.6, 0.3)],
        "powerup" => (0..4).map(|i| note(440.0 * 1.26f32.powi(i), i as f32 * 0.06, 0.08, Square, 0.3, 1.0)).collect(),
        _ => return None,
    })
}

/// Render notes to 16-bit mono WAV bytes.
pub fn render(notes: &[Note]) -> Vec<u8> {
    let len = notes.iter().map(|n| n.start + n.dur).fold(0.0, f32::max);
    let count = (len * RATE as f32) as usize + 1;
    let mut buf = vec![0f32; count];
    let mut seed: u32 = 0x1234_5678;
    for n in notes {
        let start = (n.start * RATE as f32) as usize;
        let samples = (n.dur * RATE as f32) as usize;
        let mut phase = 0f32;
        let mut noise = 0f32;
        for i in 0..samples {
            let t = i as f32 / samples as f32;
            let f = n.freq * n.slide.powf(t);
            phase = (phase + f / RATE as f32).fract();
            let s = match n.wave {
                Wave::Square => if phase < 0.5 { 1.0 } else { -1.0 },
                Wave::Sine => (phase * std::f32::consts::TAU).sin(),
                Wave::Triangle => 1.0 - 4.0 * (phase - 0.5).abs(),
                Wave::Saw => 2.0 * phase - 1.0,
                Wave::Noise => {
                    // resample noise at the note frequency for a pitched crunch
                    if i % ((RATE as f32 / f.max(20.0) / 4.0) as usize).max(1) == 0 {
                        seed ^= seed << 13;
                        seed ^= seed >> 17;
                        seed ^= seed << 5;
                        noise = (seed as f32 / u32::MAX as f32) * 2.0 - 1.0;
                    }
                    noise
                }
            };
            // exponential decay envelope, short attack to avoid clicks
            let env = n.vol * (1.0 - t).powi(2) * (i as f32 / 40.0).min(1.0);
            if let Some(v) = buf.get_mut(start + i) {
                *v += s * env * 0.25;
            }
        }
    }
    let data: Vec<u8> = buf.iter().flat_map(|v| ((v.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
    let mut wav = Vec::with_capacity(44 + data.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&RATE.to_le_bytes());
    wav.extend_from_slice(&(RATE * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
    wav.extend_from_slice(&data);
    wav
}

/// A music request from the script: play `name` (None = stop) with a crossfade.
pub struct MusicCmd {
    pub name: Option<String>,
    pub volume: f32,
    pub looped: bool,
    pub fade: f32,
}

struct Playing {
    name: String,
    sound: Sound,
    vol: f32,
    target: f32,
    rate: f32,
}

/// Decoded music kept in memory (a minute of music is ~20 MB decoded, so only a few stay loaded).
const MUSIC_CACHE: usize = 3;

/// Sounds requested by the script during a frame are played afterwards (loading is async).
#[derive(Default)]
pub struct Mixer {
    pub queue: Vec<(String, Vec<Note>)>,
    cache: HashMap<String, Sound>,
    /// encoded music from the cartridge (OGG / WAV bytes)
    pub music_src: HashMap<String, Vec<u8>>,
    /// sound effect files from the cartridge (name -> WAV / OGG bytes) and the ones to play this frame
    pub sound_src: HashMap<String, Vec<u8>>,
    pub sound_queue: Vec<(String, f32)>,
    sound_cache: HashMap<String, Sound>,
    pub music_cmd: Option<MusicCmd>,
    loaded: Vec<(String, Sound)>,
    current: Option<Playing>,
    fading: Vec<(String, Sound, f32, f32)>,
    /// master volumes (0..1) for music and sound effects: volume("music", v) / volume("sfx", v)
    pub music_gain: f32,
    pub sfx_gain: f32,
    applied_music_gain: f32,
}

impl Mixer {
    pub fn new() -> Mixer {
        Mixer { music_gain: 1.0, sfx_gain: 1.0, applied_music_gain: 1.0, ..Default::default() }
    }

    pub async fn play_queued(&mut self) {
        for (key, notes) in std::mem::take(&mut self.queue) {
            if !self.cache.contains_key(&key) {
                match load_sound_from_bytes(&render(&notes)).await {
                    Ok(s) => {
                        self.cache.insert(key.clone(), s);
                    }
                    Err(_) => continue,
                }
            }
            if let Some(s) = self.cache.get(&key) {
                play_sound(s, PlaySoundParams { looped: false, volume: self.sfx_gain });
            }
        }
        for (name, volume) in std::mem::take(&mut self.sound_queue) {
            if !self.sound_cache.contains_key(&name) {
                let Some(bytes) = self.sound_src.get(&name) else { continue };
                match load_sound_from_bytes(bytes).await {
                    Ok(s) => {
                        self.sound_cache.insert(name.clone(), s);
                    }
                    Err(_) => continue,
                }
            }
            if let Some(s) = self.sound_cache.get(&name) {
                play_sound(s, PlaySoundParams { looped: false, volume: volume * self.sfx_gain });
            }
        }
        if let Some(cmd) = self.music_cmd.take() {
            self.apply_music(cmd).await;
        }
        self.update_fades(macroquad::time::get_frame_time().min(0.1));
    }

    async fn load_music(&mut self, name: &str) -> Option<Sound> {
        if let Some(i) = self.loaded.iter().position(|(n, _)| n == name) {
            let entry = self.loaded.remove(i);
            let s = entry.1.clone();
            self.loaded.push(entry);
            return Some(s);
        }
        let bytes = self.music_src.get(name)?;
        let sound = load_sound_from_bytes(bytes).await.ok()?;
        self.loaded.push((name.to_string(), sound.clone()));
        // forget the least recently used tracks that are not playing
        while self.loaded.len() > MUSIC_CACHE {
            let busy = |n: &str| self.current.as_ref().map(|p| p.name == n).unwrap_or(false) || self.fading.iter().any(|f| f.0 == n);
            match self.loaded.iter().position(|(n, _)| !busy(n) && n != name) {
                Some(i) => {
                    self.loaded.remove(i);
                }
                None => break,
            }
        }
        Some(sound)
    }

    async fn apply_music(&mut self, cmd: MusicCmd) {
        let fade = cmd.fade.max(0.0);
        if let (Some(p), Some(n)) = (&mut self.current, &cmd.name) {
            if &p.name == n {
                // same track: only the volume changes
                p.target = cmd.volume;
                p.rate = if fade > 0.0 { (p.target - p.vol).abs() / fade } else { f32::MAX };
                return;
            }
        }
        if let Some(p) = self.current.take() {
            if fade > 0.0 {
                self.fading.push((p.name, p.sound, p.vol, p.vol / fade));
            } else {
                stop_sound(&p.sound);
            }
        }
        let Some(name) = cmd.name else { return };
        // restarting a track that is still fading out: cut the old copy
        if let Some(i) = self.fading.iter().position(|f| f.0 == name) {
            let f = self.fading.remove(i);
            stop_sound(&f.1);
        }
        if let Some(sound) = self.load_music(&name).await {
            let start = if fade > 0.0 { 0.0 } else { cmd.volume };
            play_sound(&sound, PlaySoundParams { looped: cmd.looped, volume: start * self.music_gain });
            let rate = if fade > 0.0 { cmd.volume / fade } else { f32::MAX };
            self.current = Some(Playing { name, sound, vol: start, target: cmd.volume, rate });
        }
    }

    fn update_fades(&mut self, dt: f32) {
        let g = self.music_gain;
        let gain_changed = g != self.applied_music_gain;
        self.applied_music_gain = g;
        if let Some(p) = &mut self.current {
            if p.vol != p.target || gain_changed {
                let step = p.rate * dt;
                p.vol = if p.vol < p.target { (p.vol + step).min(p.target) } else { (p.vol - step).max(p.target) };
                set_sound_volume(&p.sound, p.vol * g);
            }
        }
        for f in &mut self.fading {
            f.2 -= f.3 * dt;
            if f.2 <= 0.0 {
                stop_sound(&f.1);
            } else {
                set_sound_volume(&f.1, f.2 * g);
            }
        }
        self.fading.retain(|f| f.2 > 0.0);
    }

    /// Name of the music playing now (not counting tracks fading out).
    pub fn music_name(&self) -> Option<&str> {
        self.current.as_ref().map(|p| p.name.as_str())
    }
}
