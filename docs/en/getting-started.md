# Your first game in 10 minutes

**English** · [한국어](../ko/getting-started.md)

A guide for day one of a game jam, assuming nobody on the team has used Slate before.

## 1. Start from a template

1. Install Slate and run it ([Releases](https://github.com/Erzyh/slate-engine/releases)).
2. Choose **File > New from template > Platformer** and give it a name.
3. **File > Save project as…** and pick a folder. That folder is the project (keep it in Git).
4. Press **Space** (Play): the game runs in the Game panel on the right. Arrow keys move, Z jumps.

There are three templates.

| Template | Good for |
|---|---|
| Platformer | Side-scrolling action, puzzle platformers |
| Top-down | Zelda-like adventures, roguelikes, top-down shooters |
| Shooter | Vertical shooters, bullet hell, endless survival |

## 2. Change the art (Pixel tab)

- Click `sprites/hero` in the file list on the left.
- Draw with the pen (`B`), eraser (`E`), fill (`G`) and color picker (`I`).
- You can draw **while the game is running**: every stroke shows up in the game right away (no restart).
- Animation: add frames in the timeline below, give each frame a duration (ms), and name ranges of frames with tags (`idle`, `run`…). Code plays them by tag name.

```lua
local anim = Anim.new("hero", "idle")
anim:play("run")          -- switch tags
anim:update(dt)
anim:draw(x, y, { flipX = facingLeft })
```

## 3. Change the level (Map tab)

- Click `maps/level1` and paint with tiles picked from the palette.
- Place coins, enemies, the start point and the goal with the **object tool (`O`)**. The Type is the name code looks for (`objects("level1", "coin")`).
- Which tiles are walls is set with **tile flags**: flag 0 = solid, 1 = a platform you can jump up through, 2 = spikes (in the templates).

## 4. Change the code (Code tab)

- Change a number at the top of `scripts/player.luau`: `JUMP = 285` → `400`.
- **Ctrl+Enter** restarts the game with the new code.
- Errors show up in the console below, like `scripts/player.luau:42: ...`; click one to jump to that line.
- `log(value)` prints to the console.

Splitting files: make `scripts/enemies/bat.luau`, end it with `return Bat`, and load it with `local Bat = require("enemies/bat")`.

## 5. Sound

- Sound effects: right click `sounds` in the file list → **New sound effect** → pick a preset, tweak it, save → `sfx("name")`.
- Music: right click `music` → **New music** to make a track, or put an `.ogg` file in `music/` → `music("name")`.

## 6. Hand it in

| Where | How |
|---|---|
| itch.io (play in the browser) | Export > **Web game for itch.io (.zip)** → upload the zip on itch.io with Kind = HTML |
| Windows executable | Export > **Windows game (.exe)** → just send the one exe |
| Share the source | Put the project folder in Git, or Export > Cartridge (.slate) |

## Working as a team

- Make the project folder a Git repository. Art, maps and code are all separate files, so conflicts are rare.
- Split the work by files: artists in `sprites/`, level designers in `maps/`, programmers in `scripts/`.
- Don't have several people edit one big image at the same time (PNGs can't be merged).

## Cheat sheet

| To do this | Code |
|---|---|
| Input | `btn("a")` held, `btnp("a")` pressed now, `axis("x")` -1..1 (keyboard and gamepad alike) |
| Drawing | `cls(c)` `spr(name, x, y, opts)` `map(name, x, y)` `text(s, x, y, c)` `rect` `circ` `line` |
| Collision | `Physics.move(box, dx, dy, map)` `Physics.grounded(box, map)` `Physics.overlap(a, b)` |
| Camera | `Cam.follow(x, y, dt, { bounds = map })` `Cam.shake(3, 0.2)` `Cam.apply()` … `Cam.reset()` |
| Time | `Timer.after(1, fn)` `Timer.every(0.5, fn)` `Tween.to(obj, 0.3, { y = 10 }, { ease = "outBack" })` |
| Screens | `Scene.add("title", { enter, update, draw })` `Scene.go("play", nil, { fade = 0.3 })` |
| Effects | `local fx = Particles.new()` `fx:burst(x, y, "explosion")` `Fx.flash()` `Fx.effect("crt", 1)` |
| Sound | `sfx("jump")` `music("theme", { fade = 1 })` |
| Saving | `save("best", 1200)` `load("best", 0)` |
| Korean text | `font("erx")`, then `text("안녕", x, y, c)` |
| Dialog | `Dialog.say("Hi!", { name = "Elder" })` `Dialog.ask("Go?", { "Yes", "No" }, fn)` `Dialog.draw()` |
| Menus | `UI.menu(items)` `UI.pause.update()` / `UI.pause.draw()` `UI.toast("Saved!")` |
| Enemies chasing | `Path.chase(enemy, player.x, player.y, 40, dt, "level1")` |

The whole API is in [Game code API](api.md).
