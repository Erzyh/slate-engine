-- hangar.luau: persistent save, the upgrade shop and stage select (between runs and between stages).

local SAVE_KEY = "star-barrage"
local sel = 1
local pick = 1             -- stage chosen in the menu
local flash = {}           -- upgrade id -> flash timer
local ROW_Y, ROW_H = 44, 19
local STAGE_ROW = #UPGRADES + 1
local LAUNCH_ROW = #UPGRADES + 2

function Hangar.load()
  Save = load(SAVE_KEY, nil)
  if type(Save) ~= "table" then Save = {} end
  Save.scrap = Save.scrap or 0
  Save.up = if type(Save.up) == "table" then Save.up else {}
  Save.unlocked = Save.unlocked or 1
  Save.hiscore = Save.hiscore or 0
  Save.bestStage = Save.bestStage or 0
  Save.maxLoop = Save.maxLoop or 1
  Save.runs = Save.runs or 0
end

function Hangar.store()
  save(SAVE_KEY, Save)
end

function Hangar.cost(u)
  return math.floor(u.cost * u.grow ^ (Save.up[u.id] or 0))
end

local function buy(u)
  local lv = Save.up[u.id] or 0
  if lv >= u.max then
    sfx("error")
    return
  end
  local c = Hangar.cost(u)
  if Save.scrap < c then
    sfx("error")
    flash[u.id] = -0.4
    return
  end
  Save.scrap -= c
  Save.up[u.id] = lv + 1
  flash[u.id] = 0.5
  sfx("powerup")
  if P and Run then
    -- bought mid-run: weapons update right away
    P.st = Ship.stats()
    P.r = P.st.r
    if u.id == "shield" and lv == 0 then P.shield = true end
  end
  Hangar.store()
end

function Hangar.open(inRun)
  Game.bgm("title")
  Hangar.inRun = inRun
  if not inRun then pick = math.clamp(pick, 1, Save.unlocked) end
  sel = LAUNCH_ROW
  Hangar.store()
end

-- which stage the launch button starts
function Hangar.nextStage()
  if Hangar.inRun then return Run.nextStage end
  return pick
end

local function launch()
  sfx("powerup")
  if Hangar.inRun then
    Run.loop = Run.nextLoop
    Game.play(Run.nextStage)
  else
    Run = { stage = pick, loop = 1 }
    Ship.newRun()
    Save.runs += 1
    Game.play(pick)
  end
end

function Hangar.update(dt)
  for id, v in flash do
    flash[id] = if v > 0 then math.max(0, v - dt) else math.min(0, v + dt)
  end
  if DEV and keyp("f3") then Save.scrap += 5000 end
  if keyp("up") or keyp("w") then sel = if sel == 1 then LAUNCH_ROW else sel - 1 end
  if keyp("down") or keyp("s") then sel = if sel == LAUNCH_ROW then 1 else sel + 1 end
  if sel == STAGE_ROW and not Hangar.inRun then
    if keyp("left") or keyp("a") then pick = math.max(1, pick - 1) end
    if keyp("right") or keyp("d") then pick = math.min(Save.unlocked, pick + 1) end
  end
  if keyp("z") or keyp("space") then
    if sel <= #UPGRADES then buy(UPGRADES[sel])
    elseif sel == LAUNCH_ROW then launch() end
  end
  if keyp("enter") then launch() end
  if (keyp("escape") or keyp("x")) and not Hangar.inRun then Game.title() end
end

local function pips(x, y, lv, max)
  for i = 1, max do
    local px = x + (i - 1) * 5
    rect(px, y, 4, 5, if i <= lv then UI.cyan else "#1a2040")
  end
end

function Hangar.draw()
  local st = STAGES[Hangar.nextStage()]
  cls("#05040e")
  -- header
  rect(0, 0, W, 36, "#0a0a20")
  rect(0, 36, W, 1, UI.line)
  text("HANGAR", 8, 6, UI.text, { scale = 2 })
  text(if Hangar.inRun then `RUN SCORE {fmt(P.score)}` else `RUNS {Save.runs}`, 8, 24, UI.dim)
  text("SCRAP", W - 8, 6, UI.dim, { align = "right" })
  text(fmt(Save.scrap), W - 8, 16, UI.cyan, { align = "right", scale = 2 })

  -- upgrade rows
  for i, u in UPGRADES do
    local y = ROW_Y + (i - 1) * ROW_H
    local lv = Save.up[u.id] or 0
    local maxed = lv >= u.max
    local c = Hangar.cost(u)
    local afford = not maxed and Save.scrap >= c
    local over = hit(4, y, W - 8, ROW_H - 2)
    if over then sel = i end
    local f = flash[u.id] or 0
    local bg = if sel == i then "#1c2450" else "#0c0e22"
    if f > 0 then bg = Util.alpha("#5af0ff", f) elseif f < 0 then bg = Util.alpha("#ff4a6a", -f) end
    rect(4, y, W - 8, ROW_H - 2, bg)
    if sel == i then rectline(4, y, W - 8, ROW_H - 2, UI.gold) end
    text(u.name, 10, y + 5, if maxed then UI.gold elseif afford then UI.text else UI.dim)
    pips(124, y + 6, lv, u.max)
    text(if maxed then "MAX" else fmt(c), W - 10, y + 5, if maxed then UI.gold elseif afford then UI.cyan else "#5a4060", { align = "right" })
    if over and mouse.pressed then buy(u) end
  end

  -- description of the selected upgrade
  local dy = ROW_Y + #UPGRADES * ROW_H + 2
  rect(4, dy, W - 8, 30, "#0c0e22")
  rectline(4, dy, W - 8, 30, UI.line)
  if sel <= #UPGRADES then
    local u = UPGRADES[sel]
    local lv = Save.up[u.id] or 0
    text(`{u.name}  Lv {lv}/{u.max}`, 10, dy + 5, UI.gold)
    text(u.desc, 10, dy + 17, UI.dim)
  else
    text("Z / click: buy    Enter: launch", 10, dy + 5, UI.dim)
    text("Scrap is kept even if you lose.", 10, dy + 17, UI.dim)
  end

  -- stage select
  local sy = dy + 36
  local over = hit(4, sy, W - 8, 24)
  if over then sel = STAGE_ROW end
  rect(4, sy, W - 8, 24, if sel == STAGE_ROW then "#1c2450" else "#0c0e22")
  if sel == STAGE_ROW then rectline(4, sy, W - 8, 24, UI.gold) end
  local n = Hangar.nextStage()
  if Hangar.inRun then
    local loop = if Run.nextLoop > 1 then ` (LOOP {Run.nextLoop})` else ""
    text(`NEXT: STAGE {n}{loop}`, W / 2, sy + 4, UI.text, { align = "center" })
  else
    text(`STAGE {n} / {Save.unlocked} unlocked`, W / 2, sy + 4, UI.text, { align = "center" })
    if n > 1 then text("<", 14, sy + 8, UI.gold) end
    if n < Save.unlocked then text(">", W - 18, sy + 8, UI.gold) end
    if hit(4, sy, 40, 24) and mouse.pressed then pick = math.max(1, pick - 1) end
    if hit(W - 44, sy, 40, 24) and mouse.pressed then pick = math.min(Save.unlocked, pick + 1) end
  end
  text(st.name, W / 2, sy + 14, UI.dim, { align = "center" })

  -- launch
  local ly = sy + 30
  local lo = hit(4, ly, W - 8, 30)
  if lo then sel = LAUNCH_ROW end
  local pulse = 0.5 + 0.5 * math.sin(t() * 5)
  rect(4, ly, W - 8, 30, if sel == LAUNCH_ROW then Util.alpha("#2a6aff", 0.6 + 0.3 * pulse) else "#14204a")
  rectline(4, ly, W - 8, 30, if sel == LAUNCH_ROW then "#ffffff" else UI.hi)
  text("LAUNCH", W / 2, ly + 8, UI.text, { align = "center", scale = 2 })
  if lo and mouse.pressed then launch() end
end
