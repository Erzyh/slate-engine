# The editor

**English** · [한국어](../ko/editor.md)

## A project is a folder

A project is a folder of ordinary files. Keep it in Git, and open the files with other art tools or text editors if you like.

```
my-game/
  slate.json              { "name", "title", "resolution": [320, 180], "background", "main": "scripts/main.luau" }
  scripts/                Luau code. main.luau runs first; the rest load with require("name")
    main.luau
    player.luau
    enemies/beetle.luau   → require("enemies/beetle")
  sprites/                a sprite = one PNG (several frames = a sheet, side by side)
    hero.png
    hero.json             (optional) { "w", "h", "fps", "durations", "tags", "flags", "box", "layers" }
    hero.layers.png       (optional) the editor's layers (rows = layers, columns = frames)
  maps/level1.json        tile map + placed objects
  music/theme.ogg         music("theme")
  sounds/jump.wav         sfx("jump")
```

- Sub-folders are for tidiness. Sprites, maps and sounds are named after their file (`sprites/enemies/beetle.png` → `spr("beetle", ...)`).
- Files deleted in the editor move to `.slate-trash/` inside the project when you save (nothing is deleted right away).
- A `.slate` file = the whole project as one cartridge (examples, sharing, running). Open one with File > Import.
- `slate.json` also keeps the project palette, particle presets and object templates.

## The window

| Area | What it does |
|---|---|
| File list (left) | The project folder. Click to open (script → Code, sprite → Pixel, map → Map). Right click / `+`: new script, sprite, map or folder, import files, rename, delete, "Run first (main)". Unsaved files show a ●. Dropping files on the window imports them. Drag a sprite onto a map to place it |
| Pixel | The pixel editor (below) |
| Map | Paint tile maps, place objects |
| Code | A tab per file, Luau highlighting, completion and help (below), find (`Ctrl+F`). The **console** below shows the game's `log()` output and errors; click an error to jump to its line |
| Play (`Space`) | The game runs in the **Game panel** on the right (turn off View → Play in the Game view for a separate window). Art and map edits show up **without restarting**; `Ctrl+Enter` restarts with new code |
| Game panel | Pause / Step (`F6` / `F7`): stop game time and advance one frame at a time. Hitboxes: every box that went through `Physics` gets a green outline, solid tiles turn red. Stats: frame rate and draw count |
| Game panel capture | Screenshot (`F8`): the current frame as a PNG. Record GIF (`F9`): press again to stop and save a GIF (up to 20 s, scaled up to look sharp). For itch.io pages and posts |
| File | New project, open folder (`Ctrl+O`), save as, import a `.slate`. `Ctrl+S` saves (only changed files are written) |
| Export | Windows game (.exe, one standalone file), web game (.zip for itch.io), cartridge (.slate) |

## Pixel editor

| Feature | Details |
|---|---|
| Tools | Pen `B`, eraser `E`, fill `G` (Shift: that color everywhere), picker `I`, line `L`, rectangle `U`, ellipse `O` (Shift: filled), rectangle select `M`, lasso `Q`, magic wand `W`, hitbox `H` |
| Pen options | Brush size `[` `]`, square or round brush, pixel-perfect, dither, mirror X / Y, light background |
| Selecting | Shift adds, Alt subtracts. The magic wand takes one color's area (turn off Contiguous for that color everywhere). With a selection, painting stays inside it |
| Editing a selection | Drag inside to move, arrow keys move 1 px, corner handles resize (Shift keeps the proportions), the round knob above turns it to any angle (Shift: 15° steps; rotated RotSprite-style so the pixels stay clean), flip / rotate 90°, click outside the sprite to deselect, fill `Alt+Backspace`, clear `Del`, invert `Ctrl+Shift+I`, `Ctrl+C/X/V`, `Ctrl+A`, `Esc` |
| Hitbox | Drag with the Hitbox tool (drag inside to move, handles resize). Fit to pixels = snug around the drawn pixels. In code: `hitbox("hero", x, y)` |
| View | Wheel zooms (around the cursor), Shift+wheel scrolls sideways, drag with the wheel button to pan |
| Layers | Add / duplicate / delete / reorder / merge, visibility, opacity, lock, alpha lock (only painted pixels take paint, for shading) |
| Frames | Add / duplicate / delete / move, onion skin, `,` `.` to step, `Enter` to play |
| Frame time | A duration (ms) per frame; empty = use the FPS. Shift+click to set several at once |
| Tags | Name a range of frames (`idle`, `walk`…). Forward / reverse / ping-pong |
| Image… | Flip, rotate, outline, replace color, adjust colors (hue / saturation / lightness / brightness / contrast), ×2 / ×½, canvas size, trim |
| Sheet… | Export a sprite sheet PNG + JSON (Aseprite format), GIF, import a sheet |
| Import | Sprite → Import Aseprite file: layers, frame durations and tags of `.aseprite` / `.ase` files come in as they are |
| Undo | `Ctrl+Z` / `Ctrl+Shift+Z` |

## Map editor

- **A tileset is a sprite with several frames** (one frame = one tile). Tile flags (bit 0 = solid, …) are set in the palette and stored in the sprite's `.json`.
- **Map tab**: paint `B`, erase `E` (or right click), fill `G`, rectangle `U`, pick `I`. Shift+drag in the palette for a multi-tile brush. Several layers per map. The wheel zooms, the wheel button pans.
- **Several tilesets**: add one with `+` next to Tiles, or drag a sprite from the file list onto the Tiles panel (same tile size only). The tabs choose what you paint with; tiles already on the map don't change. Right click a tab to remove it from the map.
- **Autotiles**: draw 16 tiles as a 4×4 block (top-left 3×3 = corners, edges and middle of a filled area; right column = top, middle, bottom of a one-tile-wide pillar; bottom row = left, middle, right of a one-tile-high ledge; bottom right = alone). Select the block in the palette with Shift+drag, right click → Make autotile. With Autotile on, painting any of its tiles picks the piece that fits the neighbors.
- **Animated tiles**: select the tiles that make the frames, right click → Make animated tile. They cycle wherever they are placed (water, lava, torches).
- **Background layers**: double click a layer (or right click → Layer settings) → Scroll speed. 0.5 moves at half the camera's speed (a far background), 0 stays put. Repeat sideways tiles it forever. Background layers never collide.
- **Objects (`O`)**: place enemies, items and spawn points. Click = place, drag = move, right click / `Del` = delete. Edit Type, Sprite and Props (`hp=10`). In code: `for _, o in objects("level1", "enemy") do ... end`.
- **Dragging sprites in**: drop a sprite from the file list onto the map to place it as an object (type = the sprite's name).
- **Object templates**: select an object → Save as template; it appears in the Object panel. Click a template and then the map, or drag it onto the map, to place a copy. Changing the template's type or sprite changes every copy; the Props box holds values for that copy only. Detach = make it a normal object.
- **Play from here** (`P`): click where the player should start and the game starts there ([API](api.md#play-from-here)).

## Particle editor

Project → Particles. Start from one of the presets on the left (explosion, sparkle, hit, dust, smoke, fire) and tune it with the sliders; click the preview to burst there. Presets are saved in `slate.json` and used by name: `fx:burst(x, y, "name")`, or `fx:emit(x, y, "name", dt)` for the ones with a Rate.

## Code editor

- Completion: type `Path.` to see that module's functions. Inside `spr("`, `map("`, `sfx("`, `music("`, `Fx.effect("` and `Scene.go("` you get the names of the project's sprites, maps, sounds, effects and scenes.
- Hover a function name for how to call it and what it does.

## Sound

- Sound effects: put a `.wav` / `.ogg` in `sounds/` and call `sfx("name")`.
- **Making sound effects**: right click `sounds` in the file list → *New sound effect*. Pick a preset (coin, laser, explosion, powerup, hit, jump, blip), tune it with the sliders or try Variation / Random → *Save to sounds*. Click a sound in the file list to hear it.
- **Making music**: right click `music` → *New music*. Pick a style, press New melody until you like it, adjust the song and instruments, save.
- Music files: put an `.ogg` / `.wav` in `music/` and call `music("name")`.

## Grid Stamp and plugins

- **Grid Stamp**: snaps "pixel-art style" images (AI generated and the like) onto a real pixel grid: background removal → grid detection (Fourier + Viterbi) → one color per cell → OKLab palette → clean-up. It can also make seamless tiles.
- **Plugins**: optional (Plugins → Install from folder…). They run in a sandboxed iframe and can only reach the hosts they declare.

## Templates

File > **New from template** gives you a working game to change. All three have hand-drawn pixel art and 3–4 script files.

| Template | What's in it |
|---|---|
| `templates/platformer` | Running and jumping (coyote time, jump buffer, hold for higher jumps), slimes you stomp, coins, spikes, a goal flag, 3 hearts, a parallax background. Tune the feel with the numbers at the top of `player.luau` |
| `templates/topdown` | 8-way movement, a sword swing, chasing bats (2 hits), gems to collect, water / wall / tree collision |
| `templates/shmup` | A vertical shooter. Auto fire, a small hitbox, waves that get harder, a saved high score (`save` / `load`) |

## Examples

Open them from the Examples menu.

| Project | What's in it |
|---|---|
| `games/jelly` | **Jelly Jump**: a platformer. All pixel art designed by hand. The jelly squashes, stretches and wobbles from a single sprite in code; the beetle has a 2-frame walk (`Anim`). 7 module-style scripts. Dev keys: F2 flag, F8 autopilot |
| `games/star-barrage` | **Star Barrage**: a vertical bullet-hell shooter. 5 stages + an endless loop, 10 bosses (31 phases), 17 bullet patterns, 16 permanent upgrades, a 10-track soundtrack (Slate Synth). Stages = objects on the maps `stage1`–`5`. Dev keys F2 / F3 / F4 / F6 (see `scripts/data.luau`) |

## Exporting a web game (itch.io)

The web build is the same player as the exe, compiled to WebAssembly, so it plays exactly the same.

- Export > **Web game for itch.io (.zip)**
- On itch.io: new project > Kind of project = **HTML** > upload the zip > tick "This file will be played in the browser" > make the viewport a whole multiple of the resolution (960×540 for 320×180).
- The first screen waits for one click or key press (browsers don't allow sound before that).
- Saves (`save`) stay in the browser.
- On phones and tablets the game shows an on-screen d-pad and A / B / START buttons.
- Works in current Chrome, Edge, Firefox and Safari (18.4 and later).
