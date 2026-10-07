# Game code API

**English** · [한국어](../ko/api.md)

```lua
-- scripts/main.luau
local player = require("player")      -- the table scripts/player.luau returns

function init() player.spawn(40, 100) end
function update(dt) player.update(dt) end
function draw()
  cls("#1d1b2a")
  player.draw()
  text(`GOLD {fmt(12345)}`, 4, 4, "#ffcc66")
end
```

- `require("name")`: a path from `scripts/` (`"enemies/beetle"`) or relative to the current file (`"./helper"`, `"../lib/vec"`). Each file runs once and its result is cached (modules can share state). Circular requires are an error.
- Errors name the file and line: `scripts/player.luau:42: ...`.
- Two styles to look at: **modules** (every file returns a table) → `games/jelly`; **globals** (jam style, shared tables in globals) → `games/star-barrage`.

## At a glance

| Area | API |
|---|---|
| Drawing | `cls(c)` `spr(name, x, y, {frame, anim, at, scale, sx, sy, rot, ox, oy, flipX, flipY, alpha, tint, add})` `rect` `rectline` `line` `circ` `text(s, x, y, c, {align, scale, outline})` `textw` `camera(x, y)` `blend("add")` `sprite(name)` → `{w, h, frames, fps, tags, durations, box}` |
| Animation | `spr(..., {anim = "walk"})` loops a tag (frame durations included). For finer control, `Anim` (below) |
| Tile maps | `map(name, x, y, {layer, tint})` `mget(name, tx, ty, layer)` `mset(name, tx, ty, tile, layer)` `mapinfo(name)` `fget(tileset, tile, bit)` `msolid(name, px, py, bit)` |
| Hitboxes | `hitbox(name, x, y, {flipX, ox, oy})` → `{x, y, w, h}`: the box drawn with the pixel editor's Hitbox tool, placed where `spr(name, x, y)` draws (the whole sprite if it has none). `sprite(name).box` |
| Path finding | `Path.find` `Path.toward` `Path.chase` `Path.dist` (below) |
| Screen effects | `Fx.flash` `Fx.fade` `Fx.freeze` `Fx.tint`, shaders `Fx.effect` `Fx.shockwave` `Fx.glitch` `Fx.shader` (below) |
| Text effects | `Text.draw(s, x, y, c, {wave, shake, rainbow, typing...})`, `{wave}...{/}` inside the text (below) |
| Testing | `playtest()` → `{map, x, y}`: only set when the game was started with the editor's "Play from here" (below) |
| Objects | `objects(map, type?)` → `{id, type, sprite, x, y, props, ...props}` (x, y = bottom center, in map pixels) |
| Input | `btn(action)` `btnp(action)` `axis("x")` `bind(action, keys)` `pad()` (below), `key(name)` `keyp(name)` `mouse.x/.y/.down/.pressed/.released/.wheel` `hit(x, y, w, h)` |
| Fonts | `font("erx")` switches to the Korean pixel font (below), `text(s, x, y, c, {font = "erx_b"})`, `wrap(s, width)` → lines (wraps between words), `texth()` line height |
| Volume | `volume("music" \| "sfx", v)` overall volume 0–1 (for a settings screen) |
| Window | `fullscreen()` state, `fullscreen(true/false)` to switch. Players can always press F11 / Alt+Enter. `"fullscreen": true` in `slate.json` starts in fullscreen |
| Utilities | `t()` `now()` `rnd` `irnd` `pick` `clamp` `lerp` `fmt(big number → 1.23K)` `W` `H` `log(...)` |
| Saving | `save(key, value)` `load(key, fallback)` `wipe(key)` → `%APPDATA%\Slate\<game name>\` |
| Sound effects | `sfx(name, volume?)`: a file from `sounds/`, else a built-in preset (`click` `coin` `buy` `error` `hit` `jump` `explode` `powerup`). `beep(freq, dur, wave, vol, slide)` |
| Music | `music(name, {volume, loop, fade})` crossfades, `music()` / `music(nil, {fade})` stops, `musicname()` |
| Modules | `require(path)` |

## Animation (`Anim`)

Frames, tags and frame durations are set in the editor; code only changes the state.

```lua
local hero = Anim.new("hero", "idle")
hero:play("run")                                    -- already running "run"? it keeps going (doesn't restart)
hero:play("attack", { loop = false, onEnd = function() hero:play("idle") end })
hero:update(dt)
hero:draw(x, y, { flipX = facing < 0, ox = 0.5, oy = 1 })
-- hero.frame, hero.tag, hero.done, hero.speed (playback speed)
```

## Input actions and gamepads

Keyboard and gamepad (XInput) are read with the same names. The default actions:

| Action | Keyboard | Gamepad |
|---|---|---|
| `left` `right` `up` `down` | Arrows, WASD | D-pad, left stick |
| `a` `b` `x` `y` | Z/Space/J, X/K, C/L, V/I | A, B, X, Y |
| `start` `select` | Enter/Esc, Tab | Start, Back |

```lua
if btnp("a") then jump() end                        -- keyboard Z or pad A
local vx = axis("x") * speed                        -- -1..1, the analog stick as it is
bind("dash", { "c", "shift", "pad_rb" })            -- your own action (default ones can be rebound too)
```

Pad names: `pad_a/b/x/y/start/select/lb/rb/lt/rt/l3/r3/up/down/left/right`, `lstick_left/right/up/down`. `axis("rx"/"ry"/"lt"/"rt")` gives the right stick and the triggers.

On phones and tablets the web build shows an on-screen d-pad and A, B and START buttons. They act as a gamepad, so `btn("left")` and `btn("a")` just work (no code changes).

## Standard library

Global modules available everywhere. The engine updates `Timer`, `Tween` and `Cam` every frame before `update`.

```lua
Timer.after(0.5, function() sfx("coin") end)
Timer.every(1, spawnEnemy, 10)                      -- every second, 10 times
Tween.to(box, 0.4, { y = 20 }, { ease = "outBack", onDone = function() ... end })

Scene.add("title", { enter = function() end, update = function(dt) if btnp("a") then Scene.go("play", nil, { fade = 0.3 }) end end, draw = function() cls("#000") end })
Scene.go("title")                                   -- without your own update/draw, Scene runs them

Cam.follow(p.x, p.y, dt, { bounds = "level1" })     -- follows smoothly and never shows outside the map
Cam.shake(3, 0.2)
Cam.apply()  map("level1", 0, 0)  spr("hero", p.x, p.y)  Cam.reset()  -- the HUD goes after reset

local hit = Physics.move(p, p.vx * dt, p.vy * dt, "level1", { oneway = 1 })  -- tile collision (flag 0 = wall, 1 = jump-through)
if hit.down then p.vy = 0 end
Physics.grounded(p, "level1")  Physics.overlap(a, b)  -- boxes are {x, y, w, h}

local fx = Particles.new()
fx:burst(x, y, 20, { colors = { "#ffcc66", "#ff6644" }, speed = 90, life = 0.5, gravity = 200 })
fx:burst(x, y, "explosion")          -- a preset made in Project → Particles
fx:emit(x, y, "smoke", dt)           -- keep emitting (the preset's Rate = per second): torches, smoke
fx:update(dt)  fx:draw()
```

## Dialog and UI

```lua
-- dialog: typewriter text, name tag, portrait, choices. Long text wraps between words and pages on
Dialog.say("Long time no see! Welcome to the village.", { name = "Elder", portrait = "elder" })
Dialog.say({ "First page", "Second page" }, { onDone = function() ... end })
Dialog.ask("Go to the forest?", { "Let's go", "Later" }, function(i) ... end)

function update(dt)
  if Dialog.active() then return end     -- the game waits during a dialog
  ...
end
function draw()
  ...
  Dialog.draw()                          -- last (it draws in screen coordinates)
end
```

- Next page: Z / Space / pad A / click. Choices: up and down, or the mouse. Its look is `Dialog.style` (`font`, `lines`, `speed`, colors, `sound`).

```lua
-- menus: keyboard, gamepad and mouse. Sliders and toggles too
local menu = UI.menu({ "New game", { label = "Music", value = 1, min = 0, max = 1, onChange = function(v) volume("music", v) end }, "Quit" })
local pick = menu:update()          -- the chosen item's number (nil if none)
menu:draw(W / 2, 80)

-- pause screen (Enter / Esc / pad Start): resume, music and sound volume, fullscreen
if UI.pause.update() then return end  -- first thing in update
UI.pause.draw()                       -- last thing in draw

UI.button("OK", x, y, w, h)           -- true when clicked
UI.bar(x, y, w, h, hp, maxHp, "#b13e53")
UI.toast("Saved")                     -- a short notice, drawn by UI.draw()
```

- While paused, `Timer`, `Tween`, camera shake and dialogs stop. The texts can be changed (`UI.pause.title = "Paused"`, `UI.pause.menu.items[1].label = "Resume"`).
- All three templates already have a pause screen.

## Path finding (`Path`)

Finds the way around walls (tile flag bit 0, the same walls as `Physics`).

```lua
-- an enemy chases the player: this one line makes it go around walls
Path.chase(enemy, player.x, player.y, 40, dt, "level1")   -- enemy = {x, y, w, h}, 40 px per second

local dx, dy, dist = Path.toward("level1", ex, ey, px, py) -- the direction to move now (nil = no way)
local pts = Path.find("level1", ex, ey, px, py)           -- waypoints { {x, y}, ... } or nil
local tiles = Path.dist("level1", ex, ey, px, py)         -- walking distance in tiles, nil if unreachable
```

- Options: `{ bit = 0, diagonal = true }`. With `diagonal = false` it only moves up, down, left and right (turn-based games, roguelikes).
- When the target is in sight it goes straight there. When it isn't, a distance map is flooded out from the target once and **shared by everything chasing that target** (100 enemies cost one flood). Each one walks down the map toward the farthest cell it can still see, so movement is smooth and diagonal, not a staircase.
- `Path.find` runs A* and joins the points that can see each other, giving a few straight segments.
- When the map changes (`mset`, editor edits) everything is recalculated automatically.

## Screen effects (`Fx`)

Applied to the whole screen after `draw()` (the HUD included).

```lua
Fx.flash("#ffffff", 0.1)        -- a flash (hits, explosions)
Fx.freeze(0.06)                 -- hit-stop: the game holds still for a moment. The heart of good game feel
Fx.fade("#000000", 0.5, function() Scene.go("next") end)  -- fade to a color and stay; Fx.fade(nil, 0.5) fades back
Fx.tint("#1a2a6c", 0.35)        -- tint the screen (night, underwater). Fx.tint() turns it off
```

### Shader effects

GPU shaders that change the whole screen. Smooth at any window size, and free while all of them are off.

```lua
Fx.effect("crt", 1)                       -- on. 0 or nil turns it off
Fx.effect("grayscale", 1, 0.5)            -- fading in over 0.5 s
Fx.effect({ vignette = 0.6, bloom = 0.5 })
Fx.shockwave(x, y)                        -- a ring of distortion from that point (map coordinates, camera included). { speed, size, strength }
Fx.glitch(0.3)                            -- digital glitching for a moment
Fx.reset()                                -- all off
```

| Effect | Value | What it does |
|---|---|---|
| `crt` | 0–1 | Old TV: curved screen + scanlines + dark corners |
| `scanlines` `vignette` | 0–1 | Just the scanlines / just the dark corners |
| `aberration` | pixels (1–3) | Red and blue drift apart |
| `bloom` | 0–1 | Bright parts glow |
| `grayscale` `sepia` `invert` | 0–1 | Black and white / sepia / inverted |
| `brightness` `contrast` `saturation` | 1 = unchanged | |
| `hue` | 0–1 | Rotates the colors |
| `posterize` | levels (e.g. 4) | Fewer color steps |
| `pixelate` | pixel size (e.g. 4) | Mosaic |
| `wave` | pixels | The screen sways like water |
| `noise` | 0–1 | Film grain |

Your own shader works too (GLSL ES 1.0; write just `main()`). You get `uv`, `Texture`, `time`, `resolution`, `tex(uv)` and `rand(p)`. `Fx.shader(nil)` goes back.

```lua
Fx.shader([[
void main() {
  vec3 c = tex(uv);
  gl_FragColor = vec4(c * (0.8 + 0.2 * sin(time * 3.0)), 1.0);
}
]])
```

## Text effects (`Text`)

```lua
Text.draw("GAME OVER", W / 2, 40, "#ffffff", { align = "center", wave = 2 })
Text.draw("{shake}Scary!{/} There's a {rainbow}rainbow{/}", 8, 8, "#ffffff")
local done = Text.draw(story, 8, 60, "#ffffff", { typing = 30, start = shownAt })  -- letter by letter (start = t() when it began)
```

- Effects: `wave`, `shake`, `rainbow`, `bounce`, `blink`. As options for the whole string, or for part of it with `{wave}...{/}`. A number sets the strength: `{wave=4}` `{shake=2}`.
- Colors: `{#ff0044}red{/}` or `{color=#ff0044}`.
- More options: `scale`, `font`, `outline`, `align`. With `typing`, new letters rise into place (`pop = false` turns that off).
- `Dialog.say` understands the same markup: `Dialog.say("{shake}Help!{/} Get me out")`.
- `Text.width(s)`, `Text.len(s)` (letters without the markup), `Text.strip(s)`.

## Play from here

In the Map tab press **Play from here** (or `P` over the map) and click where to start: the game starts on that map at that spot.

- The map's `player` / `start` / `spawn` / `hero` object is moved to the click before the game starts. Games that create the player from that object need no code changes.
- To skip the title screen, check `playtest()`. The templates already do.

```lua
Scene.go(if playtest() then "play" else "title")
local pt = playtest()     -- { map = "level1", x = 120, y = 64 } or nil
```

## Fonts

- The default is an English pixel font (`pico`); Korean and other characters are drawn with ERXPIXEL automatically.
- `font("erx")`: everything in ERXPIXEL A (`erx_b` = B, `erx_gl` = extended glyphs). 12 px.
- ERXPIXEL is under the **SIL Open Font License 1.1**: you can ship and sell games with it. `game.exe --licenses` writes the full license text to `slate-licenses.txt`.

## Tile maps and objects (code)

- Tile flags are the `flags` of the tileset sprite (bit 0 = solid, …), read with `msolid(map, px, py, bit)` and `fget(tileset, tile, bit)`.
- When a map uses several tilesets, `mget` values are `tileset index × 4096 + frame` (the first tileset is just the frame number). `fget(map name, mget value, bit)` looks in the right tileset. `mapinfo(name).tilesets` lists them in order.
- Objects placed on a map: `for _, o in objects("level1", "enemy") do ... end` (x, y = bottom center, in map pixels).
- Objects placed from a template come with the template's type, sprite and props filled in; `o.template` has the template's name.
- Background layers (scroll speed other than 1) are never walls for `msolid`, `Physics` or `Path`.
