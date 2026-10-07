// Gamepads. Desktop: gilrs (XInput / Windows.Gaming.Input). Web: the browser Gamepad API.
// Buttons and stick directions become key names the game can read like keyboard keys
// ("pad_a", "pad_left", "lstick_up"...), so input actions (btn("jump")) cover keyboard and gamepad alike.

use std::collections::HashSet;

const DEADZONE: f32 = 0.25;
const STICK_PRESS: f32 = 0.5;

pub struct Pads {
    #[cfg(not(target_arch = "wasm32"))]
    gilrs: Option<gilrs::Gilrs>,
    down: HashSet<&'static str>,
    /// pressed since the last fixed update (edge-triggered, like keyboard keys)
    pressed: HashSet<&'static str>,
    pub lx: f32,
    pub ly: f32,
    pub rx: f32,
    pub ry: f32,
    pub lt: f32,
    pub rt: f32,
    pub name: Option<String>,
}

#[cfg(not(target_arch = "wasm32"))]
fn button_name(b: gilrs::Button) -> Option<&'static str> {
    use gilrs::Button;
    Some(match b {
        Button::South => "pad_a",
        Button::East => "pad_b",
        Button::West => "pad_x",
        Button::North => "pad_y",
        Button::Start => "pad_start",
        Button::Select => "pad_select",
        Button::LeftTrigger => "pad_lb",
        Button::RightTrigger => "pad_rb",
        Button::LeftTrigger2 => "pad_lt",
        Button::RightTrigger2 => "pad_rt",
        Button::LeftThumb => "pad_l3",
        Button::RightThumb => "pad_r3",
        Button::DPadUp => "pad_up",
        Button::DPadDown => "pad_down",
        Button::DPadLeft => "pad_left",
        Button::DPadRight => "pad_right",
        _ => return None,
    })
}

/// Buttons in the order of the browser's "standard" gamepad mapping.
#[cfg(target_arch = "wasm32")]
const WEB_BUTTONS: [&str; 16] = [
    "pad_a", "pad_b", "pad_x", "pad_y", "pad_lb", "pad_rb", "pad_lt", "pad_rt", "pad_select", "pad_start", "pad_l3", "pad_r3", "pad_up",
    "pad_down", "pad_left", "pad_right",
];

const STICK: [(&str, usize, f32); 4] = [("lstick_left", 0, -1.0), ("lstick_right", 0, 1.0), ("lstick_up", 1, -1.0), ("lstick_down", 1, 1.0)];

impl Default for Pads {
    fn default() -> Self {
        Pads {
            #[cfg(not(target_arch = "wasm32"))]
            gilrs: gilrs::Gilrs::new().ok(),
            down: HashSet::new(),
            pressed: HashSet::new(),
            lx: 0.0,
            ly: 0.0,
            rx: 0.0,
            ry: 0.0,
            lt: 0.0,
            rt: 0.0,
            name: None,
        }
    }
}

fn dead(v: f32) -> f32 {
    if v.abs() < DEADZONE { 0.0 } else { (v - DEADZONE * v.signum()) / (1.0 - DEADZONE) }
}

impl Pads {
    /// Read gamepads once per rendered frame.
    pub fn poll(&mut self) {
        let Some((lx, ly, rx, ry, lt, rt)) = self.read() else { return };
        // stick directions behave like buttons (with their own press edges)
        for (n, axis, sign) in STICK {
            let v = if axis == 0 { lx } else { ly } * sign;
            let was = self.down.contains(n);
            if v > STICK_PRESS && !was {
                self.down.insert(n);
                self.pressed.insert(n);
            } else if v < STICK_PRESS * 0.6 && was {
                self.down.remove(n);
            }
        }
        (self.lx, self.ly, self.rx, self.ry, self.lt, self.rt) = (lx, ly, rx, ry, lt, rt);
    }

    fn set(&mut self, n: &'static str, down: bool) {
        if down && self.down.insert(n) {
            self.pressed.insert(n);
        } else if !down {
            self.down.remove(n);
        }
    }

    /// Update buttons; returns the stick and trigger values.
    #[cfg(not(target_arch = "wasm32"))]
    fn read(&mut self) -> Option<(f32, f32, f32, f32, f32, f32)> {
        use gilrs::{Axis, Button, EventType};
        let g = self.gilrs.as_mut()?;
        let mut events = Vec::new();
        while let Some(ev) = g.next_event() {
            events.push(ev.event);
        }
        let pad = g.gamepads().find(|(_, p)| p.is_connected()).map(|(_, p)| p);
        let name = pad.as_ref().map(|p| p.name().to_string());
        // the first connected pad drives the sticks
        let axes = match &pad {
            Some(p) => (
                dead(p.value(Axis::LeftStickX)),
                -dead(p.value(Axis::LeftStickY)),
                dead(p.value(Axis::RightStickX)),
                -dead(p.value(Axis::RightStickY)),
                p.button_data(Button::LeftTrigger2).map(|d| d.value()).unwrap_or(0.0),
                p.button_data(Button::RightTrigger2).map(|d| d.value()).unwrap_or(0.0),
            ),
            None => (0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
        };
        for ev in events {
            match ev {
                EventType::ButtonPressed(b, _) => {
                    if let Some(n) = button_name(b) {
                        self.set(n, true);
                    }
                }
                EventType::ButtonReleased(b, _) => {
                    if let Some(n) = button_name(b) {
                        self.set(n, false);
                    }
                }
                EventType::Disconnected => self.down.clear(),
                _ => {}
            }
        }
        self.name = name;
        Some(axes)
    }

    #[cfg(target_arch = "wasm32")]
    fn read(&mut self) -> Option<(f32, f32, f32, f32, f32, f32)> {
        let mut s = [0f32; 20];
        let connected = crate::web::pad(&mut s);
        self.name = connected.then(|| "Gamepad".to_string());
        for (i, n) in WEB_BUTTONS.iter().enumerate() {
            self.set(n, s[i] > 0.5);
        }
        Some((dead(s[16]), dead(s[17]), dead(s[18]), dead(s[19]), s[6], s[7]))
    }

    pub fn end_tick(&mut self) {
        self.pressed.clear();
    }

    pub fn is_down(&self, name: &str) -> bool {
        self.down.contains(name)
    }

    pub fn is_pressed(&self, name: &str) -> bool {
        self.pressed.contains(name)
    }
}
