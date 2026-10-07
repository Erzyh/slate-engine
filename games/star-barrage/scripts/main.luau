-- main.luau: game states (title / hangar / play / pause / clear / over), the HUD and the engine callbacks.
-- It runs first and loads the other scripts (they fill in the global tables made in data.luau).
require("data")
require("util")
require("fx")
require("patterns")
require("ship")
require("foes")
require("world")
require("hangar")

local state, stateT = "title", 0
local banner = nil
local clearInfo = nil

-- ================================================================== HUD

function Hud.banner(title, sub, color, life)
  banner = { title = title, sub = sub or "", c = color or UI.gold, life = life or 2.4, max = life or 2.4 }
end

local function drawBanner()
  if not banner then return end
  local a = math.min(1, banner.life * 2, (banner.max - banner.life) * 4)
  local y = H / 2 - 40
  rect(0, y, W, 44, Util.alpha("#05040e", a * 0.3))
  rect(0, y, W, 1, Util.alpha(banner.c, a))
  rect(0, y + 43, W, 1, Util.alpha(banner.c, a))
  text(banner.title, W / 2, y + 8, Util.alpha(banner.c, a), { align = "center", scale = 2 })
  if banner.sub ~= "" then text(banner.sub, W / 2, y + 30, Util.alpha(UI.text, a), { align = "center" }) end
end

-- 7x6 pixel heart
local HEART = { { 1, 2, 4, 5 }, { 0, 6 }, { 0, 6 }, { 1, 5 }, { 2, 4 }, { 3, 3 } }
local function heart(x, y, c)
  for r, span in HEART do
    if #span == 4 then
      rect(x + span[1], y + r - 1, 2, 1, c)
      rect(x + span[3], y + r - 1, 2, 1, c)
    else
      rect(x + span[1], y + r - 1, span[2] - span[1] + 1, 1, c)
    end
  end
end

local function drawHud()
  rect(0, 0, W, 22, "#05040ecc")
  rect(0, 22, W, 1, UI.line)
  rect(0, 22, math.floor(W * Stage.progress()), 1, UI.blue)
  text("SCORE", 6, 3, UI.dim)
  text(string.format("%09d", math.floor(P.score)), 6, 12, UI.text)
  text("HI", W - 6, 3, UI.dim, { align = "right" })
  text(string.format("%09d", math.floor(math.max(Save.hiscore, P.score))), W - 6, 12, UI.gold, { align = "right" })
  text(`SCRAP {Save.scrap}`, W / 2, 3, UI.cyan, { align = "center" })
  text(`GRAZE {P.graze}`, W / 2, 12, UI.blue, { align = "center" })

  local b = bossRef
  if b and not b.entering then
    local ph = b.def.phases[b.phase]
    local bw = W - 24
    text(b.def.title, 12, 27, UI.pink)
    text(string.format("%02d", math.max(0, math.ceil(b.ptime - b.pt))), W - 12, 27, if b.ptime - b.pt < 10 then UI.red else UI.dim, { align = "right" })
    -- remaining phases as pips
    for i = 1, #b.def.phases do
      rect(W - 40 - (#b.def.phases - i) * 6, 28, 4, 5, if i >= b.phase then UI.pink else "#3a1830")
    end
    rect(12, 36, bw, 4, "#200818")
    local f = math.max(0, b.hp) / b.max
    rect(12, 36, math.floor(bw * f), 4, "#ff3a8a")
    rect(12, 36, math.floor(bw * f), 1, "#ffffff88")
    if ph then text(ph.name, 12, 43, Util.alpha(UI.text, 0.7)) end
  end

  rect(0, H - 18, W, 18, "#05040ecc")
  rect(0, H - 19, W, 1, UI.line)
  -- lives = ships left including the one you are flying
  local ships = math.max(0, P.lives + 1)
  for i = 1, math.min(7, ships) do heart(5 + (i - 1) * 9, H - 12, if ships == 1 then UI.red else "#ff5a7a") end
  if ships > 7 then text(`+{ships - 7}`, 68, H - 13, UI.text) end
  for i = 1, math.min(6, P.bombs) do
    local bx = 82 + (i - 1) * 10
    circ(bx, H - 9, 4, UI.green, true)
    text("B", bx, H - 12, "#05040e", { align = "center" })
  end
  if Ship.lv("shield") > 0 then
    circ(146, H - 9, 5, if P.shield then UI.cyan else "#1a3040", not P.shield)
    if P.shield then circ(146, H - 9, 2, "#ffffff", true) end
  end
  text("PWR", W - 66, H - 13, UI.dim)
  for i = 1, 4 do
    local px = W - 46 + (i - 1) * 10
    rect(px, H - 14, 8, 9, if i <= P.power then UI.red else "#2a1020")
  end
end

-- ================================================================== music

local MUSIC_VOLUME = 0.7

-- background music (tracks in music/, made by tools/make_music.py). nil fades out.
function Game.bgm(name, o)
  o = o or {}
  if name == nil then
    music(nil, { fade = o.fade or 1 })
    return
  end
  music(name, { volume = (o.volume or 1) * MUSIC_VOLUME, loop = o.loop ~= false, fade = o.fade or 0.6 })
end

-- duck the current track (pause) or bring it back
local function duck(on)
  local m = musicname()
  if m then music(m, { volume = (if on then 0.3 else 1) * MUSIC_VOLUME, fade = 0.2 }) end
end

-- ================================================================== states

function Game.title()
  state, stateT = "title", 0
  Run = nil
  Bg.init()
  Game.bgm("title")
end

function Game.play(n)
  state, stateT = "play", 0
  Stage.start(n)
end

function Game.over()
  if state == "over" then return end
  state, stateT = "over", 0
  Game.bgm("gameover", { loop = false, fade = 0.3 })
  local salvage = math.floor((20 + 60 * Stage.progress()) * Run.stage * Run.loop)
  Ship.addScrap(salvage)
  clearInfo = { salvage = salvage }
  Save.hiscore = math.max(Save.hiscore, math.floor(P.score))
  Save.bestStage = math.max(Save.bestStage, (Run.loop - 1) * 5 + Run.stage)
  Hangar.store()
end

function Game.stageClear()
  state, stateT = "clear", 0
  Game.bgm("clear", { loop = false, fade = 0 })
  local bonus = (100 + 60 * Run.stage) * Run.loop
  Ship.addScrap(bonus)
  P.score += (P.lives * 50000 + P.bombs * 20000) * Run.loop
  local nextStage, nextLoop = Run.stage + 1, Run.loop
  if nextStage > #STAGES then nextStage, nextLoop = 1, Run.loop + 1 end
  Run.nextStage, Run.nextLoop = nextStage, nextLoop
  if Run.loop == 1 then Save.unlocked = math.max(Save.unlocked, math.min(#STAGES, Run.stage + 1)) end
  Save.maxLoop = math.max(Save.maxLoop, nextLoop)
  Save.hiscore = math.max(Save.hiscore, math.floor(P.score))
  Save.bestStage = math.max(Save.bestStage, (Run.loop - 1) * 5 + Run.stage)
  clearInfo = { bonus = bonus, loopUp = nextLoop > Run.loop }
  Hangar.store()
end

-- ================================================================== callbacks

function init()
  for _, n in { "player", "nebula", "planet", "asteroid" } do SZ[n] = sprite(n) end
  Hangar.load()
  Bg.init()
  Game.title()
end

function update(dt)
  stateT += dt
  if banner then
    banner.life -= dt
    if banner.life <= 0 then banner = nil end
  end
  if state == "title" then
    Bg.update(dt, 30)
    stageY += 30 * dt
    if keyp("enter") or keyp("z") or keyp("space") or mouse.pressed then
      state = "hangar"
      Hangar.open(false)
    end
    return
  end
  if state == "hangar" then
    Bg.update(dt, 20)
    FX.update(dt)
    Hangar.update(dt)
    return
  end
  if state == "pause" then
    if keyp("escape") or keyp("p") or keyp("z") then
      state = "play"
      duck(false)
    end
    if keyp("q") then Game.over() end
    return
  end
  if state == "over" or state == "clear" then
    Bg.update(dt, 20)
    FX.update(dt)
    Items.update(dt)
    if stateT > 1.2 and (keyp("enter") or keyp("z") or mouse.pressed) then
      if state == "over" then
        Run = nil
        state = "hangar"
        Hangar.open(false)
      else
        state = "hangar"
        Hangar.open(true)
      end
    end
    return
  end
  -- play
  if keyp("escape") or keyp("p") then
    state = "pause"
    duck(true)
    return
  end
  if DEV and keyp("f2") then Stage.skip() end
  if DEV and keyp("f3") then Save.scrap += 5000 end
  if DEV and keyp("f6") then Game.bossLock = not Game.bossLock end   -- dev: bosses take no damage (trailer footage)
  if DEV and keyp("f4") then
    P.god = not P.god
    Hud.banner(if P.god then "GOD MODE" else "GOD MODE OFF", "", UI.green, 1)
  end
  if FX.stop > 0 then
    FX.stop -= dt
    return
  end
  Stage.update(dt)
  Ship.update(dt)
  Foes.update(dt)
  Shots.update(dt)
  Pat.update(dt)
  Items.update(dt)
  FX.update(dt)
end

local function drawWorld()
  local sx, sy = rnd(-FX.shake, FX.shake), rnd(-FX.shake, FX.shake)
  camera(sx, sy)
  FX.drawBack()
  Items.draw()
  Foes.draw()
  Shots.draw()
  Ship.draw()
  camera()
  drawBanner()
  camera(sx, sy)
  Pat.draw()
  FX.drawFront()
  camera()
  FX.drawScreen()
end

function draw()
  if state == "hangar" then
    Hangar.draw()
    FX.drawFront()
    return
  end
  local st = if Run then Stage.current() else STAGES[1]
  Bg.draw(st, stageY)
  if state == "title" then
    local bob = math.sin(stateT * 1.5) * 3
    text("STAR", W / 2 + 2, 110 + bob + 2, "#1a0830", { align = "center", scale = 5 })
    text("STAR", W / 2, 110 + bob, UI.blue, { align = "center", scale = 5, outline = "#0a1840" })
    text("BARRAGE", W / 2 + 2, 150 + bob + 2, "#1a0830", { align = "center", scale = 4 })
    text("BARRAGE", W / 2, 150 + bob, UI.pink, { align = "center", scale = 4, outline = "#300820" })
    spr("player", W / 2, 250, { ox = 0.5, oy = 0.5, scale = 2 })
    blend("add")
    circ(W / 2, 280, 8 + math.sin(stateT * 30) * 2, "#4aa8ff88", true)
    blend()
    text("PRESS Z", W / 2, 310, if math.sin(stateT * 4) > 0 then UI.text else UI.dim, { align = "center" })
    text(string.format("HI %09d", Save.hiscore), W / 2, 326, UI.gold, { align = "center" })
    text(`SCRAP {Save.scrap}   BEST STAGE {Save.bestStage}`, W / 2, 338, UI.cyan, { align = "center" })
    local lines = { "ARROWS  move", "SHIFT  focus + hitbox", "X  bomb (clears bullets)", "ESC  pause" }
    for i, l in lines do text(l, W / 2, 370 + (i - 1) * 11, UI.dim, { align = "center" }) end
    text("5 stages  10 bosses  16 upgrades  endless loops", W / 2, H - 16, "#4a5080", { align = "center" })
    return
  end
  drawWorld()
  drawHud()
  if state == "pause" then
    rect(0, 0, W, H, "#05040ecc")
    text("PAUSED", W / 2, H / 2 - 30, UI.text, { align = "center", scale = 2 })
    text("Z / ESC  resume", W / 2, H / 2, UI.dim, { align = "center" })
    text("Q  retire (keeps scrap)", W / 2, H / 2 + 12, UI.dim, { align = "center" })
  elseif state == "over" or state == "clear" then
    local a = math.min(1, stateT * 2)
    local y = H / 2 - 70
    rect(0, y, W, 140, Util.alpha("#05040e", a * 0.88))
    rect(0, y, W, 1, Util.alpha(UI.line, a))
    rect(0, y + 139, W, 1, Util.alpha(UI.line, a))
    local over = state == "over"
    text(if over then "GAME OVER" else "STAGE CLEAR", W / 2, y + 12, Util.alpha(if over then UI.red else UI.gold, a), { align = "center", scale = 2 })
    text(string.format("SCORE  %09d", math.floor(P.score)), W / 2, y + 40, Util.alpha(UI.text, a), { align = "center" })
    text(`GRAZE  {P.graze}`, W / 2, y + 54, Util.alpha(UI.blue, a), { align = "center" })
    text(`SCRAP THIS RUN  {P.scrap}`, W / 2, y + 68, Util.alpha(UI.cyan, a), { align = "center" })
    if not over and clearInfo then
      text(`CLEAR BONUS  +{clearInfo.bonus}`, W / 2, y + 82, Util.alpha(UI.cyan, a), { align = "center" })
      if clearInfo.loopUp then text(`LOOP {Run.nextLoop}: enemies grow stronger`, W / 2, y + 96, Util.alpha(UI.pink, a), { align = "center" }) end
    elseif over then
      text(`SALVAGE  +{clearInfo.salvage}`, W / 2, y + 96, Util.alpha(UI.cyan, a), { align = "center" })
      text(`reached stage {Run.stage}` .. (if Run.loop > 1 then ` (loop {Run.loop})` else ""), W / 2, y + 82, Util.alpha(UI.dim, a), { align = "center" })
    end
    if stateT > 1.2 then text("PRESS Z  -> HANGAR", W / 2, y + 118, UI.dim, { align = "center" }) end
  end
end
