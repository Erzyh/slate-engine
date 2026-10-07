-- ship.luau: the player ship. Weapons come from the hangar upgrades (Save.up) plus the in-run power level.

local OPTION_POS = {
  { { 0, 20 } },
  { { -20, 6 }, { 20, 6 } },
  { { -20, 6 }, { 20, 6 }, { 0, 22 } },
  { { -24, 4 }, { 24, 4 }, { -12, 20 }, { 12, 20 } },
}
local SHIELD_TIME = { 40, 30, 20 }

function Ship.lv(id)
  return Save.up[id] or 0
end

-- derived stats (recomputed when an upgrade is bought)
function Ship.stats()
  local lv = Ship.lv
  return {
    dmg = 1.25 * (1 + 0.12 * lv("dmg")),
    rate = 0.075 / (1 + 0.08 * lv("rate")),
    speed = 160 * (1 + 0.08 * lv("speed")),
    r = ({ 2.5, 1.9, 1.4 })[lv("hitbox") + 1],
    magnet = 40 + 22 * lv("magnet"),
    grazeScrap = 0.12 * (1 + lv("graze")),
    salvage = 1 + 0.15 * lv("scrap"),
    bombDmg = 1 + 0.3 * lv("bombdmg"),
  }
end

function Ship.newRun()
  P = {
    x = W / 2, y = H - 60, lives = 2 + Ship.lv("life"), bombs = 2 + Ship.lv("bomb"), power = 1 + Ship.lv("power"), powerXp = 0,
    score = 0, graze = 0, scrap = 0, scrapF = 0, inv = 2, fireT = 0, missT = 0, bombT = 0, dead = false, respawnT = 0, bank = 0,
    shield = Ship.lv("shield") > 0, shieldT = 0, opts = {}, laserT = 0, laserTarget = nil,
  }
  P.st = Ship.stats()
  P.r = P.st.r
end

-- put the ship back at the bottom for a new stage (run stats stay)
function Ship.place()
  P.x, P.y, P.inv, P.dead = W / 2, H - 60, 2, false
  -- every stage starts with at least the run's starting ships and bombs
  P.lives = math.max(P.lives, 2 + Ship.lv("life"))
  P.bombs = math.max(P.bombs, 2 + Ship.lv("bomb"))
  P.st = Ship.stats()
  P.r = P.st.r
  P.opts = {}
end

-- scrap goes straight into the bank (Salvage multiplies everything)
function Ship.addScrap(n)
  P.scrapF += n * P.st.salvage
  local whole = math.floor(P.scrapF)
  if whole > 0 then
    P.scrapF -= whole
    P.scrap += whole
    Save.scrap += whole
  end
end

function Ship.powerUp(n)
  if P.power >= 4 then
    P.score += 2000
    return
  end
  P.powerXp += n
  while P.power < 4 and P.powerXp >= 10 do
    P.powerXp -= 10
    P.power += 1
    Hud.banner("POWER UP", `Level {P.power}`, UI.blue, 1.4)
    FX.vfx("vfx_level", P.x, P.y - 10, { scale = 0.8, fps = 16 })
    sfx("powerup")
  end
end

function Ship.graze(b)
  P.graze += 1
  P.score += 50
  Ship.addScrap(P.st.grazeScrap)
  FX.burst(b.x, b.y, 3, { "#ffffff", b.c[2] }, { speed = 70, add = true, gravity = 0, life = 0.3 })
end

function Ship.bomb()
  if P.bombs <= 0 or P.bombT > 0 or P.dead then return end
  P.bombs -= 1
  P.bombT = 2.2 * (0.8 + 0.2 * P.st.bombDmg)
  P.inv = math.max(P.inv, P.bombT + 0.3)
  if bossRef then bossRef.captured = false end
  Pat.cancel(true)
  FX.flash("#c8e0ff", 1)
  FX.kick(10, 0.06)
  for i = 0, 3 do FX.ring(P.x, P.y, if i % 2 == 0 then "#8ad0ff" else "#ffffff", 260, 240 + i * 90) end
  FX.vfx("vfx_level", P.x, P.y - 20, { scale = 2.4, fps = 12 })
  for _, f in foes do Foes.damage(f, (if f.boss then 70 else 400) * P.st.bombDmg) end
  sfx("explode")
end

function Ship.hit()
  if P.god then return end
  if P.shield then
    -- the shield takes the hit
    P.shield = false
    P.shieldT = SHIELD_TIME[Ship.lv("shield")] or 40
    P.inv = 1.5
    FX.ring(P.x, P.y, "#5af0ff", 60, 220)
    FX.burst(P.x, P.y, 24, { "#5af0ff", "#ffffff" }, { speed = 160, add = true, gravity = 0 })
    FX.flash("#5af0ff", 0.4)
    Foes.clearNear(P.x, P.y, 60)
    Hud.banner("SHIELD DOWN", "", UI.cyan, 1.0)
    sfx("hit")
    return
  end
  P.dead = true
  P.respawnT = 1.4
  P.lives -= 1
  P.power = math.max(1, P.power - 1)
  if bossRef then bossRef.captured = false end
  FX.vfx("vfx_fire", P.x, P.y, { scale = 1.6, fps = 14 })
  FX.burst(P.x, P.y, 50, { "#ffffff", "#8ad0ff", "#2a6aff" }, { speed = 220, add = true, gravity = 0 })
  FX.ring(P.x, P.y, "#ffffff", 120, 200)
  FX.flash("#ff4060", 0.8)
  FX.kick(12, 0.25)
  Pat.cancel(false)
  sfx("explode")
  for i = 1, 3 do table.insert(items, { kind = "power", x = P.x + (i - 2) * 16, y = P.y - 20, vy = -90, t = 0 }) end
end

local function bolt(x, y, ang, dmg)
  table.insert(pshots, { x = x, y = y, vx = math.cos(ang) * 520, vy = math.sin(ang) * 520, dmg = dmg, kind = "bolt" })
end

local function fireWeapons(dt, focus)
  local st = P.st
  local up = -PI / 2
  local laser = focus and Ship.lv("laser") > 0
  P.fireT -= dt
  if P.fireT <= 0 then
    P.fireT = st.rate
    if not laser then
      local lanes = ({ { -4, 4 }, { -8, 0, 8 }, { -10, -4, 4, 10 }, { -12, -6, 0, 6, 12 } })[P.power]
      for _, ox in lanes do bolt(P.x + ox, P.y - 12, up, st.dmg) end
      local wide = Ship.lv("wide") + (if P.power >= 3 then 1 else 0)
      local narrow = if focus then 0.3 else 1
      for i = 1, wide do
        local a = 0.14 * i * narrow
        bolt(P.x - 6, P.y - 8, up - a, st.dmg * 0.7)
        bolt(P.x + 6, P.y - 8, up + a, st.dmg * 0.7)
      end
    end
    for _, o in P.opts do bolt(o.x, o.y - 6, up, st.dmg * 0.6) end
    beep(880, 0.03, "square", 0.04, 0.7)
  end
  -- homing missiles
  local ml = Ship.lv("missile")
  if ml > 0 then
    P.missT -= dt
    if P.missT <= 0 then
      P.missT = 0.75 - 0.08 * ml
      for _, s in { -1, 1 } do
        table.insert(pshots, { x = P.x + s * 10, y = P.y, vx = s * 60, vy = -200, dmg = (1.5 + 0.5 * ml) * st.dmg, kind = "missile", t = 0 })
      end
    end
  end
  -- focus laser: hits the first enemy straight above
  P.laserTarget = nil
  if laser then
    P.laserT += dt
    local best, by = nil, -1e9
    for _, f in foes do
      if f.y < P.y and f.y > -10 and math.abs(f.x - P.x) < f.r + 4 and f.y > by and not f.entering then best, by = f, f.y end
    end
    P.laserTarget = best
    if best then
      Foes.damage(best, 38 * (1 + 0.25 * Ship.lv("laser")) * st.dmg * dt)
      if rnd() < 0.5 then FX.burst(P.x + rnd(-3, 3), best.y + best.r * 0.5, 1, { "#ffffff", "#8ad0ff" }, { speed = 90, add = true, gravity = 0, life = 0.4 }) end
    end
  end
end

function Ship.update(dt)
  P.inv = math.max(0, P.inv - dt)
  P.bombT = math.max(0, P.bombT - dt)
  if not P.shield and Ship.lv("shield") > 0 then
    P.shieldT -= dt
    if P.shieldT <= 0 then
      P.shield = true
      FX.ring(P.x, P.y, "#5af0ff", 30, 120)
    end
  end
  if P.dead then
    P.respawnT -= dt
    if P.respawnT <= 0 then
      if P.lives < 0 then
        Game.over()
        return
      end
      P.dead, P.x, P.y, P.inv, P.bombs = false, W / 2, H - 60, 2.5, math.max(P.bombs, 2 + Ship.lv("bomb"))
    end
    return
  end
  local focus = key("shift")
  local speed = if focus then P.st.speed * 0.44 else P.st.speed
  local dx = (if key("right") or key("d") then 1 else 0) - (if key("left") or key("a") then 1 else 0)
  local dy = (if key("down") or key("s") then 1 else 0) - (if key("up") or key("w") then 1 else 0)
  if dx ~= 0 and dy ~= 0 then dx, dy = dx * 0.707, dy * 0.707 end
  P.x = math.clamp(P.x + dx * speed * dt, 8, W - 8)
  P.y = math.clamp(P.y + dy * speed * dt, 40, H - 26)
  P.bank = Util.approach(P.bank, dx, dt * 6)

  -- option drones follow their slots smoothly
  local n = Ship.lv("option")
  local slots = OPTION_POS[n]
  for i = 1, n do
    local o = P.opts[i]
    if not o then
      o = { x = P.x, y = P.y }
      P.opts[i] = o
    end
    local s = slots[i]
    local tx, ty = P.x + s[1] * (if focus then 0.45 else 1), P.y + s[2] * (if focus then 0.6 else 1)
    o.x += (tx - o.x) * math.min(1, dt * 14)
    o.y += (ty - o.y) * math.min(1, dt * 14)
  end

  fireWeapons(dt, focus)   -- always auto fire
  if keyp("x") or keyp("k") then Ship.bomb() end
  FX.burst(P.x, P.y + 10, 1, { "#8ad0ff", "#ffffff", "#2a6aff" }, { speed = 50, angle = PI / 2, spread = 0.3, add = true, gravity = 0, life = 0.35 })
end

function Ship.draw()
  if P.dead then return end
  -- laser
  if P.laserTarget ~= nil or (key("shift") and Ship.lv("laser") > 0) then
    local top = if P.laserTarget then P.laserTarget.y + P.laserTarget.r * 0.5 else 0
    local w = 5 + Ship.lv("laser") + math.sin(t() * 50)
    blend("add")
    rect(P.x - w, top, w * 2, P.y - 10 - top, "#2a6aff66")
    blend()
    rect(P.x - w * 0.5, top, w, P.y - 10 - top, "#8ad0ff")
    rect(P.x - 1, top, 2, P.y - 10 - top, "#ffffff")
  end
  for _, o in P.opts do
    blend("add")
    circ(o.x, o.y, 6 + math.sin(t() * 9) * 1, "#4aa8ff55", true)
    blend()
    circ(o.x, o.y, 4, "#2a6aff", true)
    circ(o.x, o.y, 2, "#e0f4ff", true)
  end
  if P.inv > 0 and math.floor(P.inv * 16) % 2 == 0 then return end
  local s = SZ.player
  spr("player", P.x, P.y, { ox = 0.5, oy = 0.5, sx = 1 - math.abs(P.bank) * 0.18 })
  blend("add")
  circ(P.x, P.y + s.h / 2 - 2, 4 + math.sin(t() * 40) * 1.5, "#4aa8ff88", true)
  if P.shield then circ(P.x, P.y, 16 + math.sin(t() * 4), "#5af0ff22", true) end
  blend()
  if P.shield then circ(P.x, P.y, 16 + math.sin(t() * 4), "#5af0ff88", false) end
  if key("shift") then
    circ(P.x, P.y, P.r + 2, "#ffffff", true)
    circ(P.x, P.y, P.r, UI.red, true)
    circ(P.x, P.y, 14, "#8ad0ff55", false)
  end
end
