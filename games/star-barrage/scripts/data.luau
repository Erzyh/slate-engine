-- STAR BARRAGE - a vertical bullet-hell shooter for Slate.
-- data.luau: namespaces, shared state, palette and all tuning data (stages, enemies, bosses, upgrades).
-- Everything here is a global, so every script sees it (main.luau requires this file first).
-- Game-jam style: simple and quick. For a module style (return a table, local X = require(...)), see Jelly Jump.

Util, FX, Pat, Ship, Foes, Shots, Items, Bg, Stage, Hangar, Hud, Game = {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}

DEV = true                -- F2: skip 10 s / skip boss phase, F3: +5000 scrap, F4: god mode, F6: bosses take no damage

-- shared state (all files see these)
SZ = {}                   -- sprite sizes
P = nil                   -- the player ship + run stats (Ship.newRun)
Run = nil                 -- { stage, loop }
Save = nil                -- persistent: scrap bank, upgrade levels, unlocked stage, hiscore
foes, pshots, eshots, beams, items = {}, {}, {}, {}, {}
bossRef = nil
stageY, stageH, spawnIdx, stageObjs = 0, 0, 1, {}
SCROLL = 42               -- stage scroll speed (px/s)

UI = {
  bg = "#0a0a18e6", bg2 = "#141428f0", line = "#2e3460", hi = "#4a5a9a",
  text = "#e8ecff", dim = "#7a84b0", gold = "#ffd84a", red = "#ff4a6a",
  green = "#5affb0", blue = "#5ab8ff", pink = "#ff5ad8", cyan = "#5af0ff",
}

-- bullet colors: { core, rim }
BULLET = {
  pink = { "#ffe0f6", "#ff3ab8" }, blue = { "#e0f4ff", "#2a8aff" }, gold = { "#fff6d0", "#ffb020" },
  green = { "#e0ffe8", "#20d070" }, red = { "#ffe0e0", "#ff2a2a" }, violet = { "#f0e0ff", "#9a40ff" },
  cyan = { "#e0ffff", "#20d8f0" }, orange = { "#fff0e0", "#ff7a20" }, white = { "#ffffff", "#a8b8e8" },
}

-- ------------------------------------------------------------------ stages
-- map = tile map whose objects are the waves (edit them in the Map tab). Colors theme the background.
STAGES = {
  { name = "Nebula Frontier", map = "stage1", bg = "#05040e", neb = "#8890c0", stars = { "#5a6090", "#9aa8e0", "#ffffff" }, planet = "#9aa0d0", px = 0.72 },
  { name = "Asteroid Belt", map = "stage2", bg = "#080604", neb = "#a08868", stars = { "#6a5a48", "#c8b090", "#fff4e0" }, planet = "#d0a070", px = 0.25, rocks = true },
  { name = "Crimson Expanse", map = "stage3", bg = "#100308", neb = "#d05868", stars = { "#703040", "#e08090", "#ffe0e8" }, planet = "#ff7070", px = 0.7 },
  { name = "Frozen Rings", map = "stage4", bg = "#020812", neb = "#6aa8d8", stars = { "#305070", "#90c8f0", "#ffffff" }, planet = "#a0e0ff", px = 0.3, big = true },
  { name = "The Core", map = "stage5", bg = "#08020e", neb = "#b058d0", stars = { "#502a60", "#d090f0", "#ffe0ff" }, planet = "#ff60c0", px = 0.6, rocks = true },
}

-- ------------------------------------------------------------------ enemies
-- fire = list of { pattern, every (s), args }. args.ox/oy = muzzle offset. Patterns are in patterns.luau.
-- Stage objects pick an enemy with `type`; props can override hp, speed, move, stopY, hold, dir,
-- and the first gun with shot / rate / color / n.
FOES = {
  drone = { sprite = "drone", hp = 6, score = 100, scrap = 2, r = 9, move = "straight", speed = 70,
    fire = { { "aim", 1.6, { n = 1, speed = 140, color = "red" } } } },
  swirler = { sprite = "swirler", hp = 10, score = 200, scrap = 4, r = 10, move = "sine", speed = 55,
    fire = { { "ring", 2.2, { n = 10, speed = 75, color = "violet", rand = true } } } },
  interceptor = { sprite = "interceptor", hp = 8, score = 250, scrap = 4, r = 9, move = "dive", speed = 80,
    fire = { { "stream", 9, { n = 4, speed = 130, color = "cyan" } } } },
  gunship = { sprite = "gunship", hp = 40, score = 800, scrap = 12, r = 14, move = "stop", speed = 60,
    fire = { { "aim", 1.1, { n = 5, spread = 0.7, speed = 120, color = "gold", ox = -8 } }, { "aim", 1.1, { n = 5, spread = 0.7, speed = 120, color = "gold", ox = 8 } } } },
  bomber = { sprite = "bomber", hp = 60, score = 1200, scrap = 16, r = 16, move = "stop", speed = 50, hold = 8,
    fire = { { "split", 2.2, { n = 1, speed = 70, color = "orange", ring = 10 } }, { "wave", 1.4, { n = 3, spread = 0.8, speed = 100, wave = 0.5, color = "gold" } } } },
  sentinel = { sprite = "sentinel", hp = 90, score = 1800, scrap = 24, r = 16, move = "stop", speed = 45, hold = 10,
    fire = { { "cross", 0.12, { arms = 4, step = 0.13, speed = 100, color = "blue" } } } },
  carrier = { sprite = "carrier", hp = 140, score = 3000, scrap = 40, r = 24, move = "stop", speed = 35, hold = 9,
    fire = { { "spiral", 0.07, { arms = 3, step = 0.29, speed = 90, color = "green" } } } },
  asteroid = { sprite = "asteroid", hp = 30, score = 300, scrap = 6, r = 14, move = "drift", speed = 45, fire = {},
    death = { "ring", { n = 8, speed = 60, color = "gold", size = 1, rand = true } } },
  orbmine = { sprite = "orbmine", hp = 16, score = 200, scrap = 4, r = 10, move = "drift", speed = 35, fire = {},
    death = { "ring", { n = 12, speed = 70, color = "orange", rand = true } } },
}

-- ------------------------------------------------------------------ bosses
-- Each phase has its own health bar and time limit. Clearing a phase without getting hit or
-- bombing = CAPTURE BONUS. move: hover / center / chase / dash / circle / figure8.
PI = math.pi
BOSSES = {
  warden = { sprite = "midboss", title = "WARDEN", r = 28, phases = {
    { name = "Opening Salvo", hp = 260, move = "hover", fire = {
      { "ring", 0.9, { n = 16, speed = 75, color = "pink", spin = 0.2 } },
      { "aim", 1.2, { n = 3, spread = 0.3, speed = 140, color = "blue" } } } },
    { name = "Crimson Fan", hp = 300, move = "dash", fire = {
      { "fan", 0.25, { n = 5, spread = 1.2, speed = 110, color = "red", sweep = 0.35, swing = 0.6, size = 1, rice = true } },
      { "split", 2.0, { n = 1, speed = 70, color = "pink", ring = 14, t = 1.0 } } } },
  } },
  ironclad = { sprite = "ironclad", title = "IRONCLAD", r = 36, final = true, phases = {
    { name = "Broadside", hp = 380, move = "hover", fire = {
      { "fan", 0.5, { n = 7, spread = 1.4, speed = 100, color = "gold", ox = -30, oy = 0 } },
      { "fan", 0.5, { n = 7, spread = 1.4, speed = 100, color = "gold", ox = 30, oy = 0 } },
      { "aim", 1.0, { n = 1, speed = 180, size = 3, color = "red" } } } },
    { name = "Turret Storm", hp = 400, move = "center", fire = {
      { "spiral", 0.07, { arms = 3, step = 0.27, speed = 95, color = "blue" } },
      { "stream", 1.4, { n = 6, speed = 120, color = "red" } } } },
    { name = "Last Stand", hp = 420, move = "chase", fire = {
      { "curve", 0.6, { n = 18, speed = 85, color = "green", turn = 0.7, alt = true } },
      { "split", 1.6, { n = 3, spread = 0.8, speed = 70, color = "gold", ring = 10 } } } },
  } },
  golem = { sprite = "golem", title = "ROCK GOLEM", r = 30, phases = {
    { name = "Rock Slide", hp = 300, move = "hover", fire = {
      { "rain", 0.25, { n = 3, speed = 70, color = "gold", size = 2 } },
      { "aim", 1.0, { n = 5, spread = 0.5, speed = 130, color = "blue" } } } },
    { name = "Crystal Burst", hp = 320, move = "center", fire = {
      { "petal", 1.1, { n = 12, layers = 3, speed = 60, gap = 20, color = "blue" } },
      { "bounce", 1.8, { n = 10, speed = 100, color = "green", spin = 0.3 } } } },
  } },
  hive = { sprite = "boss", title = "HIVE MOTHER", r = 40, final = true, phases = {
    { name = "Twin Helix", hp = 420, move = "hover", fire = {
      { "spiral", 0.06, { arms = 2, step = 0.37, speed = 95, color = "pink", ox = -26 } },
      { "spiral", 0.06, { arms = 2, step = -0.37, speed = 95, color = "blue", ox = 26 } },
      { "aim", 1.5, { n = 5, spread = 0.5, speed = 170, size = 3, color = "gold" } } } },
    { name = "Bloom Barrage", hp = 440, move = "center", fire = {
      { "flower", 0.8, { n = 24, speed = 30, acc = 60, color = "violet" } },
      { "aim", 1.0, { n = 7, spread = 0.9, speed = 120, color = "green" } } } },
    { name = "Swarm", hp = 460, move = "circle", fire = {
      { "freeze", 1.6, { n = 20, speed = 150, color = "pink", color2 = "red", t = 1.0 } },
      { "spray", 0.3, { n = 3, spread = 1.2, speed = 70, color = "gold", size = 1 } } } },
  } },
  twinfang = { sprite = "twinfang", title = "TWIN FANG", r = 28, phases = {
    { name = "Fang Cross", hp = 330, move = "dash", fire = {
      { "cross", 0.08, { arms = 4, step = 0.11, speed = 120, color = "red" } },
      { "aim", 1.4, { n = 3, spread = 0.25, speed = 170, color = "gold", size = 3 } } } },
    { name = "Bite", hp = 360, move = "chase", fire = {
      { "beam", 2.6, { n = 2, spread = 0.6, width = 10, warn = 0.9, life = 0.8, color = "red" } },
      { "ring", 0.7, { n = 14, speed = 90, color = "pink", rand = true } } } },
  } },
  seraph = { sprite = "seraph", title = "SERAPH", r = 34, final = true, phases = {
    { name = "Halo", hp = 420, move = "hover", fire = {
      { "ring", 0.35, { n = 20, speed = 70, color = "gold", spin = 0.11 } },
      { "stream", 1.5, { n = 7, speed = 140, color = "blue" } } } },
    { name = "Wings of Light", hp = 440, move = "center", fire = {
      { "beam", 3.0, { n = 5, spread = 1.6, aimed = false, angle = PI / 2, width = 8, warn = 1.0, life = 1.0, color = "gold", turn = 0.25, alt = true } },
      { "spray", 0.12, { n = 1, spread = 1.5, speed = 80, color = "white", size = 1 } } } },
    { name = "Judgement", hp = 460, move = "figure8", fire = {
      { "vortex", 0.05, { arms = 3, step = 0.31, speed = 170, turn = 1.3, decel = 100, min = 50, color = "pink" } },
      { "split", 1.6, { n = 2, spread = 0.9, speed = 60, color = "gold", ring = 16 } } } },
    { name = "Rapture", hp = 500, move = "center", fire = {
      { "web", 0.07, { arms = 5, step = 0.13, speed = 85, color = "gold", color2 = "blue" } },
      { "freeze", 2.0, { n = 24, speed = 150, color = "white", color2 = "pink", t = 1.1 } } } },
  } },
  kraken = { sprite = "kraken", title = "KRAKEN", r = 30, phases = {
    { name = "Ink Cloud", hp = 320, move = "hover", fire = {
      { "spray", 0.12, { n = 2, spread = 1.3, speed = 50, color = "violet", size = 3 } },
      { "aim", 1.1, { n = 3, spread = 0.4, speed = 150, color = "cyan" } } } },
    { name = "Tentacles", hp = 340, move = "center", fire = {
      { "wave", 0.3, { n = 8, spread = 2.4, speed = 90, wave = 0.7, wf = 4, color = "cyan", rice = true } },
      { "stream", 1.6, { n = 8, speed = 110, color = "orange" } } } },
    { name = "Maelstrom", hp = 360, move = "circle", fire = {
      { "vortex", 0.06, { arms = 4, step = 0.23, speed = 150, turn = 1.8, decel = 80, color = "cyan" } } } },
  } },
  leviathan = { sprite = "leviathan", title = "LEVIATHAN", r = 36, final = true, phases = {
    { name = "Tidal Breath", hp = 440, move = "hover", fire = {
      { "fan", 0.09, { n = 3, spread = 0.3, speed = 150, color = "cyan", sweep = 0.12, swing = 1.0, rice = true } },
      { "ring", 1.0, { n = 18, speed = 70, color = "blue", rand = true } } } },
    { name = "Frost Bloom", hp = 460, move = "center", fire = {
      { "flower", 0.6, { n = 28, speed = 20, acc = 55, color = "white", size = 2, spin = 0.17 } },
      { "aim", 0.9, { n = 1, speed = 200, color = "cyan", size = 3 } } } },
    { name = "Abyssal Coil", hp = 480, move = "dash", fire = {
      { "curve", 0.45, { n = 22, speed = 80, turn = 0.9, alt = true, color = "cyan" } },
      { "beam", 3.2, { n = 3, spread = 0.9, width = 12, color = "blue" } } } },
    { name = "Wrath of the Deep", hp = 520, move = "chase", fire = {
      { "spiral", 0.05, { arms = 5, step = 0.21, speed = 110, color = "cyan" } },
      { "bounce", 1.4, { n = 14, speed = 100, color = "white", bounces = 1, spin = 0.2 } } } },
  } },
  eye = { sprite = "eye", title = "ALL-SEEING EYE", r = 30, phases = {
    { name = "Gaze", hp = 340, move = "center", fire = {
      { "beam", 2.2, { n = 1, width = 14, warn = 0.8, life = 1.2, color = "red" } },
      { "ring", 0.6, { n = 12, speed = 90, color = "red", spin = 0.13 } } } },
    { name = "Pupil", hp = 360, move = "hover", fire = {
      { "freeze", 1.3, { n = 18, speed = 160, color = "pink", color2 = "red" } },
      { "petal", 1.6, { n = 8, layers = 4, speed = 50, color = "violet" } } } },
    { name = "Blink", hp = 380, move = "dash", fire = {
      { "split", 0.9, { n = 3, spread = 1.2, speed = 80, color = "red", ring = 10, ringSpeed = 100 } },
      { "cross", 0.07, { arms = 3, step = -0.17, speed = 110, color = "gold" } } } },
  } },
  overmind = { sprite = "overmind", title = "OVERMIND", r = 40, final = true, phases = {
    { name = "Synapse", hp = 460, move = "hover", fire = {
      { "web", 0.08, { arms = 4, step = 0.15, speed = 90, color = "orange", color2 = "violet" } },
      { "aim", 1.2, { n = 5, spread = 0.6, speed = 160, color = "gold", size = 3 } } } },
    { name = "Neural Storm", hp = 480, move = "center", fire = {
      { "beam", 2.4, { n = 4, spread = 2.2, aimed = false, angle = PI / 2, width = 8, turn = 0.35, alt = true, color = "violet" } },
      { "rain", 0.2, { n = 2, speed = 80, color = "orange" } } } },
    { name = "Thought Spiral", hp = 500, move = "figure8", fire = {
      { "vortex", 0.045, { arms = 5, step = 0.19, speed = 170, turn = 1.4, decel = 110, min = 45, color = "pink" } },
      { "freeze", 2.2, { n = 20, color = "white", color2 = "gold" } } } },
    { name = "Psychic Bloom", hp = 520, move = "center", fire = {
      { "flower", 0.5, { n = 30, speed = 25, acc = 60, color = "violet", spin = 0.13 } },
      { "petal", 1.4, { n = 12, layers = 3, color = "orange" } },
      { "stream", 1.8, { n = 8, speed = 130, color = "gold" } } } },
    { name = "Singularity", hp = 600, move = "center", fire = {
      { "spiral", 0.04, { arms = 6, step = 0.13, speed = 100, color = "red" } },
      { "curve", 0.9, { n = 24, speed = 90, turn = 1.0, alt = true, color = "violet" } },
      { "split", 2.4, { n = 2, spread = 1.4, color = "gold", ring = 16 } } } },
  } },
}

-- ------------------------------------------------------------------ upgrades (bought in the hangar, kept forever)
-- cost of level L (0-based) = cost * grow^L
UPGRADES = {
  { id = "dmg", name = "Cannon Damage", desc = "+12% damage for every weapon", max = 10, cost = 40, grow = 1.45 },
  { id = "rate", name = "Fire Rate", desc = "+8% fire rate", max = 8, cost = 50, grow = 1.5 },
  { id = "wide", name = "Spread Shot", desc = "extra angled bolts (narrow when focused)", max = 4, cost = 120, grow = 1.8 },
  { id = "missile", name = "Homing Missiles", desc = "missiles that seek enemies", max = 5, cost = 160, grow = 1.7 },
  { id = "option", name = "Option Drones", desc = "+1 drone that fires with you", max = 4, cost = 260, grow = 1.9 },
  { id = "laser", name = "Focus Laser", desc = "focus (Shift) fires a piercing laser", max = 5, cost = 250, grow = 1.7 },
  { id = "power", name = "Starting Power", desc = "start each run at a higher power", max = 3, cost = 180, grow = 2 },
  { id = "life", name = "Extra Life", desc = "+1 ship per run", max = 3, cost = 400, grow = 2.2 },
  { id = "bomb", name = "Bomb Stock", desc = "+1 bomb per run", max = 3, cost = 250, grow = 2 },
  { id = "bombdmg", name = "Bomb Power", desc = "+30% bomb damage and duration", max = 5, cost = 150, grow = 1.6 },
  { id = "shield", name = "Shield", desc = "absorbs one hit, then recharges", max = 3, cost = 500, grow = 2.2 },
  { id = "magnet", name = "Magnet", desc = "pick up items from further away", max = 5, cost = 50, grow = 1.5 },
  { id = "graze", name = "Graze Master", desc = "grazing bullets gives more scrap", max = 5, cost = 100, grow = 1.6 },
  { id = "scrap", name = "Salvage", desc = "+15% scrap from everything", max = 5, cost = 200, grow = 1.7 },
  { id = "speed", name = "Thrusters", desc = "+8% movement speed", max = 3, cost = 60, grow = 1.7 },
  { id = "hitbox", name = "Micro Hull", desc = "smaller hitbox", max = 2, cost = 600, grow = 2.5 },
}
