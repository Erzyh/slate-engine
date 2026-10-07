-- foes.luau: regular enemies (from stage map objects) and multi-phase bosses.

local function makeGuns(list, o)
  local guns = {}
  for i, g in list do
    local args = Util.copy(g[3])
    local every = g[2]
    local pat = g[1]
    if i == 1 and o then
      pat = o.shot or pat
      every = o.rate or every
      args.color = o.color or args.color
      args.n = o.n or args.n
    end
    table.insert(guns, { pat = pat, every = every, args = args, timer = 0, st = {} })
  end
  return guns
end

function Foes.spawn(o)
  if o.type == "boss" or o.type == "midboss" then return Foes.spawnBoss(o) end
  local def = FOES[o.type]
  if not def then return end
  local hp = (o.hp or def.hp) * Game.hpMul
  local f = {
    def = def, sprite = def.sprite, x = o.x, y = -20, hp = hp, max = hp, t = 0, flash = 0, r = def.r,
    move = o.move or def.move, speed = o.speed or def.speed, dir = o.dir or (if o.x < W / 2 then 1 else -1),
    stopY = o.stopY or 90, hold = o.hold or def.hold or 7, score = def.score, scrap = def.scrap,
    guns = makeGuns(def.fire, o),
  }
  if f.move == "side" then
    -- enters from the side at height stopY and crosses the screen
    f.x = if f.dir > 0 then -20 else W + 20
    f.y = f.stopY
  end
  for _, g in f.guns do g.timer = 0.5 + g.every * rnd(0.3, 0.8) end
  if f.move == "dive" then f.guns[1].timer = 0.9 end
  table.insert(foes, f)
end

-- ------------------------------------------------------------------ bosses

function Foes.spawnBoss(o)
  local def = BOSSES[o.boss or ""]
  if not def then return end
  local f = {
    def = def, boss = true, sprite = def.sprite, x = W / 2, y = -70, t = 0, flash = 0, r = def.r,
    phase = 0, stopY = o.stopY or 110, entering = true, tx = W / 2, ty = 110, dashT = 0,
    score = 20000, scrap = 0, guns = {},
  }
  bossRef = f
  -- stage bosses get the boss theme, OVERMIND its own; midbosses keep the stage music
  if def.final then Game.bgm(if def == BOSSES.overmind then "lastboss" else "boss", { fade = 0.8 }) end
  Hud.banner(def.title, "WARNING", UI.red, 2.4)
  sfx("explode")
  table.insert(foes, f)
  Foes.nextPhase(f, true)
end

function Foes.nextPhase(f, first)
  if not first then
    -- phase cleared
    Pat.cancel(true)
    FX.flash("#ffffff", 0.6)
    FX.ring(f.x, f.y, "#ff5ad8", 200, 220)
    FX.kick(8, 0.1)
    if f.captured and not f.timedOut then
      local bonus = 40 * Run.stage * Run.loop
      Ship.addScrap(bonus)
      P.score += 30000 * f.phase
      FX.num(f.x, f.y + 30, `CAPTURE +{bonus}`, UI.gold, true)
      sfx("buy")
    end
  end
  f.phase += 1
  local ph = f.def.phases[f.phase]
  if not ph then
    Foes.kill(f)
    return
  end
  f.hp = ph.hp * Game.hpMul
  f.max = f.hp
  f.move = ph.move or "hover"
  f.guns = makeGuns(ph.fire)
  for _, g in f.guns do g.timer = 1.2 + rnd(0, 0.3) end
  f.pt = 0
  f.ptime = ph.time or 40
  f.captured, f.timedOut = true, false
  if not first then Hud.banner(ph.name, `PHASE {f.phase} / {#f.def.phases}`, UI.pink, 1.8) end
end

local function bossMove(f, dt)
  if f.entering then
    f.y = Util.approach(f.y, f.stopY, 60 * dt)
    if f.y >= f.stopY then f.entering = false end
    return
  end
  local m, tt = f.move, f.t
  local sy = f.stopY
  if m == "hover" then
    f.tx, f.ty = W / 2 + math.sin(tt * 0.45) * W * 0.28, sy
  elseif m == "center" then
    f.tx, f.ty = W / 2, sy
  elseif m == "chase" then
    f.tx, f.ty = math.clamp(P.x, 50, W - 50), sy
  elseif m == "dash" then
    f.dashT -= dt
    if f.dashT <= 0 then
      f.dashT = 2.6
      f.tx, f.ty = rnd(50, W - 50), rnd(sy - 30, sy + 40)
    end
  elseif m == "circle" then
    f.tx, f.ty = W / 2 + math.cos(tt * 0.8) * 70, sy + math.sin(tt * 0.8) * 30
  elseif m == "figure8" then
    f.tx, f.ty = W / 2 + math.sin(tt * 0.6) * 80, sy + math.sin(tt * 1.2) * 25
  end
  local sp = if m == "dash" then 160 else 70
  f.x = Util.approach(f.x, f.tx, sp * dt)
  f.y = Util.approach(f.y, f.ty, sp * 0.7 * dt)
end

-- ------------------------------------------------------------------ update

local function moveFoe(f, dt)
  local m = f.move
  if m == "straight" then
    f.y += f.speed * dt
  elseif m == "sine" then
    f.y += f.speed * dt
    f.x += math.cos(f.t * 2.2) * 80 * dt * f.dir
  elseif m == "stop" then
    if f.t < 2 then f.y = Util.approach(f.y, f.stopY, f.speed * 2 * dt)
    elseif f.t < f.hold then f.x += math.sin(f.t * 0.8) * 12 * dt
    else f.y += f.speed * dt end
  elseif m == "drift" then
    f.y += f.speed * dt
    f.x += f.dir * 18 * dt
  elseif m == "side" then
    f.x += f.dir * f.speed * 1.4 * dt
    f.y += 12 * dt
  elseif m == "dive" then
    -- swoop in, pause, then dash at where the player was
    if f.t < 1.0 then
      f.y = Util.approach(f.y, f.stopY, f.speed * 2.5 * dt)
      if f.t > 0.55 and math.floor(f.t * 14) % 2 == 0 then f.flash = 0.04 end
    elseif not f.vx then
      local a = Pat.aimAt(f.x, f.y)
      f.vx, f.vy = math.cos(a) * f.speed * 3.2, math.max(60, math.sin(a) * f.speed * 3.2)
      FX.burst(f.x, f.y - 6, 6, { "#5af0ff", "#ffffff" }, { speed = 60, angle = -PI / 2, add = true, gravity = 0 })
    else
      f.x += f.vx * dt
      f.y += f.vy * dt
    end
  end
end

function Foes.update(dt)
  for _, f in foes do
    f.t += dt
    f.flash = math.max(0, f.flash - dt)
    if f.boss then
      bossMove(f, dt)
      if not f.entering then
        f.pt += dt
        if f.pt >= f.ptime then
          f.timedOut = true
          Foes.nextPhase(f)
        end
      end
    else
      moveFoe(f, dt)
    end
    -- guns (enemies hold fire near the bottom so nothing spawns point blank)
    local canFire = if f.boss then not f.entering else (f.t > 0.4 and f.y > 26 and f.y < H - 110 and f.x > 6 and f.x < W - 6)
    if canFire and not f.dead then
      for _, g in f.guns do
        g.timer -= dt * Game.rateMul
        if g.timer <= 0 then
          g.timer += g.every
          if g.timer < 0 then g.timer = g.every end
          local a = g.args
          Pat.fire(g.pat, f.x + (a.ox or 0), f.y + (a.oy or 10), a, g.st, f)
        end
      end
    end
    if not P.dead and P.inv <= 0 and not f.entering then
      local dx, dy = f.x - P.x, f.y - P.y
      if dx * dx + dy * dy < (f.r * 0.6) ^ 2 then Ship.hit() end
    end
    if f.y > H + 60 or f.x < -90 or f.x > W + 90 then f.dead = true end
  end
  foes = Util.keep(foes, function(f) return not f.dead end)
end

function Foes.damage(f, dmg)
  if f.dead or f.entering then return end
  if f.boss and Game.bossLock then
    f.flash = 0.05
    return
  end
  f.hp -= dmg
  f.flash = 0.05
  if f.hp <= 0 then
    if f.boss then Foes.nextPhase(f) else Foes.kill(f) end
  end
end

-- pop enemy bullets around a point (shield)
function Foes.clearNear(x, y, r)
  for _, b in eshots do
    if (b.x - x) ^ 2 + (b.y - y) ^ 2 < r * r then
      b.dead = true
      table.insert(items, { kind = "star", x = b.x, y = b.y, vy = -40, t = 0, magnet = true })
    end
  end
end

function Foes.kill(f)
  if f.dead then return end
  f.dead = true
  local big = f.boss
  local color = if big then "#ff5ad8" else "#ffcc4d"
  P.score += f.score * Run.loop
  Ship.addScrap(f.scrap)
  FX.vfx("vfx_fire", f.x, f.y, { scale = if big then 3 else 0.6 + f.r / 30, fps = if big then 10 else 18 })
  FX.burst(f.x, f.y, if big then 100 else 18, { "#ffffff", "#ffcc4d", "#ff7a30", color }, { speed = if big then 300 else 160, add = true, gravity = 0 })
  FX.ring(f.x, f.y, color, if big then 220 else 40 + f.r, 220)
  FX.kick(if big then 16 else 3 + f.r / 10, if big then 0.35 else 0.03)
  if f.score >= 800 then FX.num(f.x, f.y - 8, fmt(f.score * Run.loop), UI.gold, f.score >= 3000) end
  sfx(if big then "explode" else "hit")
  -- suicide bullets (mines, rocks)
  if f.def.death and not P.dead and (f.x - P.x) ^ 2 + (f.y - P.y) ^ 2 > 90 * 90 then Pat.fire(f.def.death[1], f.x, f.y, f.def.death[2], {}, f) end
  -- drops
  local n = math.ceil(f.score / 250)
  for _ = 1, math.min(n, 12) do table.insert(items, { kind = "star", x = f.x + rnd(-14, 14), y = f.y + rnd(-10, 10), vy = rnd(-120, -40), t = 0 }) end
  if f.score >= 800 or rnd() < 0.12 then table.insert(items, { kind = "power", x = f.x, y = f.y, vy = -100, t = 0 }) end
  if f.score >= 3000 and rnd() < 0.5 then table.insert(items, { kind = "bomb", x = f.x + 10, y = f.y, vy = -110, t = 0 }) end
  if big then
    Pat.cancel(true)
    FX.flash("#ffffff", 1)
    bossRef = nil
    for _ = 1, 6 do FX.vfx("vfx_fire", f.x + rnd(-50, 50), f.y + rnd(-30, 30), { scale = rnd(1, 2), fps = rnd(10, 16) }) end
    table.insert(items, { kind = "bomb", x = f.x - 12, y = f.y, vy = -110, t = 0 })
    for _ = 1, 2 do table.insert(items, { kind = "power", x = f.x + rnd(-20, 20), y = f.y, vy = -110, t = 0 }) end
    local bonus = (if f.def.final then 60 else 30) * Run.stage * Run.loop
    Ship.addScrap(bonus)
    FX.num(f.x, f.y - 30, `+{bonus} SCRAP`, UI.cyan, true)
    if f.def.final then Stage.bossDown() end
  end
end

function Foes.draw()
  for _, f in foes do
    spr(f.sprite, f.x, f.y, { ox = 0.5, oy = 0.5 })
    if f.flash > 0 then spr(f.sprite, f.x, f.y, { ox = 0.5, oy = 0.5, add = true, alpha = 0.6, tint = "#ffffff" }) end
    if f.boss then
      blend("add")
      circ(f.x, f.y + 6, 10 + math.sin(t() * 6) * 3, "#ff3a6a44", true)
      blend()
      -- time-out ring shrinks as the phase timer runs down
      if not f.entering then
        local left = 1 - f.pt / f.ptime
        circ(f.x, f.y, f.r + 14 + left * 30, Util.alpha("#ff5ad8", 0.25 + 0.2 * left), false)
      end
    end
  end
end
