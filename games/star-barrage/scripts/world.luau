-- world.luau: player shots, items, the scrolling background and the stage runner.

-- ================================================================== player shots

function Shots.update(dt)
  for _, s in pshots do
    if s.kind == "missile" then
      s.t += dt
      local best, bd = nil, 1e9
      for _, f in foes do
        local d = (f.x - s.x) ^ 2 + (f.y - s.y) ^ 2
        if d < bd and f.y > 0 and not f.entering then best, bd = f, d end
      end
      if best then
        local a = math.atan2(best.y - s.y, best.x - s.x)
        s.vx = Util.approach(s.vx, math.cos(a) * 360, 900 * dt)
        s.vy = Util.approach(s.vy, math.sin(a) * 360, 900 * dt)
      else
        s.vy = Util.approach(s.vy, -360, 900 * dt)
      end
      if rnd() < 0.6 then FX.burst(s.x, s.y, 1, { "#ffcc4d", "#ff7a30" }, { speed = 20, add = true, gravity = 0, life = 0.3 }) end
    end
    s.x += s.vx * dt
    s.y += s.vy * dt
    for _, f in foes do
      if not s.dead and not f.dead and f.y > -10 then
        local dx, dy = f.x - s.x, f.y - s.y
        if dx * dx + dy * dy < f.r * f.r then
          s.dead = true
          P.score += 10
          Foes.damage(f, s.dmg)
          FX.burst(s.x, s.y - 2, 1, { "#ffffff", "#8ad0ff" }, { speed = 90, add = true, gravity = 0, life = 0.4 })
          if f.r >= 20 and rnd() < 0.12 then FX.vfx("vfx_hit", s.x, s.y, { scale = 0.35, fps = 36, rot = rnd(0, 6) }) end
        end
      end
    end
    if s.y < -20 or s.x < -20 or s.x > W + 20 or s.y > H + 20 then s.dead = true end
  end
  pshots = Util.keep(pshots, function(s) return not s.dead end)
end

function Shots.draw()
  blend("add")
  for _, s in pshots do
    if s.kind == "missile" then
      circ(s.x, s.y, 3, "#ff9a30aa", true)
    else
      rect(s.x - 2, s.y - 7, 4, 12, "#2a8affaa")
    end
  end
  blend()
  for _, s in pshots do
    if s.kind == "missile" then rect(s.x - 1, s.y - 1, 2, 2, "#ffffff")
    else rect(s.x - 1, s.y - 8, 2, 12, "#ffffff") end
  end
end

-- ================================================================== items

function Items.update(dt)
  local mag = P.st.magnet
  for _, it in items do
    it.t += dt
    local dx, dy = P.x - it.x, P.y - it.y
    local d = math.sqrt(dx * dx + dy * dy)
    -- everything flies to you near the top of the screen, inside the magnet, or after a cancel
    if not P.dead and (it.magnet or P.y < 150 or d < mag) and it.t > 0.3 then
      it.x += dx / math.max(1, d) * 400 * dt
      it.y += dy / math.max(1, d) * 400 * dt
    else
      it.vy = math.min(it.vy + 220 * dt, 90)
      it.y += it.vy * dt
    end
    if not P.dead and d < 12 then
      it.dead = true
      if it.kind == "star" then
        P.score += 100 + P.graze
        Ship.addScrap(0.5)
        if P.power < 4 then Ship.powerUp(0.2) end   -- 50 stars = one power level
      elseif it.kind == "power" then
        Ship.powerUp(4)
        P.score += 500
        sfx("coin")
      elseif it.kind == "bomb" then
        P.bombs = math.min(8, P.bombs + 1)
        FX.num(it.x, it.y - 8, "BOMB +1", UI.green)
        sfx("buy")
      end
    end
    if it.y > H + 20 then it.dead = true end
  end
  items = Util.keep(items, function(it) return not it.dead end)
end

function Items.draw()
  for _, it in items do
    if it.kind == "star" then
      blend("add")
      rect(it.x - 2, it.y - 2, 4, 4, "#ffd84a88")
      blend()
      rect(it.x - 1, it.y - 1, 2, 2, "#fff6d0")
    else
      local c = if it.kind == "power" then "#ff4a6a" else "#5affb0"
      blend("add")
      circ(it.x, it.y, 9 + math.sin(it.t * 8), Util.alpha(c, 0.35), true)
      blend()
      rect(it.x - 6, it.y - 6, 12, 12, c)
      rectline(it.x - 6, it.y - 6, 12, 12, "#ffffff")
      text(if it.kind == "power" then "P" else "B", it.x, it.y - 3, "#ffffff", { align = "center" })
    end
  end
end

-- ================================================================== background

local stars, rocks = {}, {}

function Bg.init()
  stars, rocks = {}, {}
  for i = 1, 90 do table.insert(stars, { x = rnd(0, W), y = rnd(0, H), z = (i % 3) + 1 }) end
  for _ = 1, 7 do table.insert(rocks, { x = rnd(0, W), y = rnd(-H, H), s = rnd(0.25, 0.6), r = rnd(0, 6), vr = rnd(-0.5, 0.5) }) end
end

function Bg.update(dt, scroll)
  for _, s in stars do
    s.y += scroll * dt * (s.z * 0.9)
    if s.y > H then
      s.y -= H
      s.x = rnd(0, W)
    end
  end
  for _, r in rocks do
    r.y += scroll * dt * (0.6 + r.s)
    r.r += r.vr * dt
    if r.y > H + 30 then
      r.y, r.x = rnd(-200, -30), rnd(0, W)
    end
  end
end

function Bg.draw(st, scrollY)
  cls(st.bg)
  local nb = SZ.nebula
  if nb then
    local off = (scrollY * 0.25) % nb.h
    for i = -1, 1 do spr("nebula", (W - nb.w) / 2, off + i * nb.h - nb.h + H, { tint = st.neb }) end
  end
  rect(0, 0, W, H, Util.alpha(st.bg, 0.4))
  local py = ((scrollY * 0.08 + 120) % (H + 400)) - 200
  spr("planet", W * st.px, py, { ox = 0.5, oy = 0.5, tint = st.planet, scale = if st.big then 2 else 1 })
  for _, s in stars do
    rect(s.x, s.y, 1, if s.z == 3 then 2 else 1, st.stars[s.z])
  end
  if st.rocks then
    for _, r in rocks do spr("asteroid", r.x, r.y, { ox = 0.5, oy = 0.5, scale = r.s, rot = r.r, tint = "#5a5060" }) end
  end
end

-- ================================================================== stage runner

local clearT = nil

function Stage.start(n)
  Run.stage = n
  local st = STAGES[n]
  local s, l = n - 1, Run.loop - 1
  Game.hpMul = (1 + 0.32 * s) * (1 + 0.7 * l)
  Game.bspeed = 1 + 0.04 * s + 0.12 * l
  Game.rateMul = 1 + 0.06 * s + 0.2 * l
  foes, pshots, eshots, beams, items = {}, {}, {}, {}, {}
  bossRef, clearT = nil, nil
  FX.reset()
  Ship.place()
  stageObjs = objects(st.map)
  table.sort(stageObjs, function(a, b) return a.y > b.y end)   -- bottom of the map comes first
  local info = mapinfo(st.map)
  stageH = if info then info.h * info.th else 6000
  stageY, spawnIdx = 0, 1
  local loop = if Run.loop > 1 then `  LOOP {Run.loop}` else ""
  Hud.banner(`STAGE {n}{loop}`, st.name, UI.blue, 2.6)
  Game.bgm(`stage{n}`, { fade = 1 })
end

function Stage.current()
  return STAGES[Run.stage]
end

-- the stage boss died: short victory lap, then the clear screen
function Stage.bossDown()
  Game.bgm(nil, { fade = 2.5 })
  clearT = 3
end

function Stage.skip()
  -- dev: skip 10 seconds (or the current boss phase); stops right at a boss
  if bossRef and not bossRef.entering then
    bossRef.timedOut = true
    Foes.nextPhase(bossRef)
    return
  end
  if bossRef then return end
  stageY += SCROLL * 10
  local top = stageH - H - stageY
  while spawnIdx <= #stageObjs and stageObjs[spawnIdx].y >= top do
    local o = stageObjs[spawnIdx]
    if o.type == "boss" or o.type == "midboss" then
      stageY = stageH - H - o.y
      break
    end
    spawnIdx += 1
  end
  P.power = 4
end

function Stage.update(dt)
  if clearT then
    clearT -= dt
    if clearT <= 0 then
      clearT = nil
      Game.stageClear()
    end
  end
  -- scrolling stops while a boss is alive; objects spawn as their map row comes into view
  local scroll = if bossRef then 0 else SCROLL
  stageY += scroll * dt
  local top = stageH - H - stageY
  while spawnIdx <= #stageObjs and stageObjs[spawnIdx].y >= top do
    Foes.spawn(stageObjs[spawnIdx])
    spawnIdx += 1
  end
  -- ran out of map without a boss (hand-edited stage): clear when the screen is empty
  if spawnIdx > #stageObjs and not bossRef and not clearT and #foes == 0 and stageY > stageH - H then clearT = 2 end
  Bg.update(dt, scroll + 30)
end

function Stage.progress()
  return math.clamp(stageY / math.max(1, stageH - H), 0, 1)
end
