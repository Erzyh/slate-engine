-- Enemies and their bullets. Waves come from Timer.every; they speed up as G.time grows.
local G = require("game")
local Ship = require("ship")

local E = { list = {} }

local KINDS = {
  -- dives down in a wave, worth 100
  dart = { sprite = "dart", w = 12, h = 8, hp = 2, score = 100 },
  -- slides in, stops, shoots at you, leaves; worth 300
  saucer = { sprite = "saucer", w = 16, h = 8, hp = 8, score = 300 },
}

local function spawn(kind, x, y, extra)
  local k = KINDS[kind]
  local e = { kind = kind, x = x, y = y, w = k.w, h = k.h, hp = k.hp, t = 0, flash = 0 }
  for key, v in extra or {} do e[key] = v end
  table.insert(E.list, e)
end

-- aim a bullet at the ship
local function shoot(x, y, speed, spread)
  local a = math.atan2(Ship.y - y, Ship.x - x) + (spread or 0)
  table.insert(G.orbs, { x = x - 3, y = y - 3, w = 6, h = 6, vx = math.cos(a) * speed, vy = math.sin(a) * speed })
end

function E.start()
  E.list = {}
  -- a line of darts every couple of seconds
  E.dartTimer = Timer.every(2.2, function()
    local n = 3 + math.min(4, math.floor(G.time / 20))
    local side = pick({ -1, 1 })
    for i = 1, n do
      spawn("dart", W / 2 + side * (20 + i * 14), -10 - i * 14, { phase = i * 0.4 })
    end
  end)
  -- a saucer now and then
  E.saucerTimer = Timer.every(5, function()
    spawn("saucer", pick({ 30, W / 2, W - 30 }), -12, { stopAt = rnd(40, 90) })
  end)
end

function E.stop()
  Timer.cancel(E.dartTimer)
  Timer.cancel(E.saucerTimer)
end

local function hurtEnemy(e, i)
  e.hp -= 1
  e.flash = 0.06
  if e.hp <= 0 then
    table.remove(E.list, i)
    G.addScore(KINDS[e.kind].score)
    sfx("explode", 0.35)
    G.fx:burst(e.x + e.w / 2, e.y + e.h / 2, 12, { colors = { "#ffcd75", "#ef7d57", "#b13e53" }, speed = 90, life = 0.4, size = 2 })
    return true
  end
  return false
end

function E.update(dt)
  local hard = 1 + G.time / 60
  for i = #E.list, 1, -1 do
    local e = E.list[i]
    e.t += dt
    e.flash = math.max(0, e.flash - dt)
    if e.kind == "dart" then
      e.y += 70 * hard * dt
      e.x += math.cos(e.t * 2 + e.phase) * 40 * dt
    else
      if e.t < 3.5 then
        e.y += (e.stopAt - e.y) * 2 * dt
      else
        e.y -= 40 * dt -- leave
      end
      e.shotT = (e.shotT or 1) - dt
      if e.shotT <= 0 and e.t < 3.5 then
        e.shotT = math.max(0.5, 1.1 / hard)
        for s = -1, 1 do shoot(e.x + 8, e.y + 8, 70 * math.min(hard, 1.6), s * 0.25) end
        sfx("click", 0.25)
      end
    end
    -- your shots
    local dead = false
    for j = #G.shots, 1, -1 do
      if Physics.overlap(G.shots[j], e) then
        table.remove(G.shots, j)
        if hurtEnemy(e, i) then
          dead = true
          break
        end
      end
    end
    if not dead then
      if Physics.overlap(Ship.core(), e) then
        Ship.hurt()
      elseif e.y > H + 20 or (e.kind == "saucer" and e.y < -20 and e.t > 3.5) then
        table.remove(E.list, i)
      end
    end
  end
  for i = #G.orbs, 1, -1 do
    local o = G.orbs[i]
    o.x += o.vx * dt
    o.y += o.vy * dt
    if Physics.overlap(Ship.core(), o) then
      Ship.hurt() -- this clears G.orbs
      break
    elseif o.x < -10 or o.x > W + 10 or o.y < -10 or o.y > H + 10 then
      table.remove(G.orbs, i)
    end
  end
end

function E.draw()
  for _, e in E.list do
    local k = KINDS[e.kind]
    -- flash white for a moment when hit
    local look = { add = e.flash > 0, tint = if e.flash > 0 then "#ffffff" else nil }
    if e.kind == "saucer" then
      look.anim = "blink"
      spr(k.sprite, e.x, e.y - 4, look) -- the saucer's pixels start 4 rows down its 16x16 frame
    else
      spr(k.sprite, e.x, e.y, look)
    end
  end
  for _, o in G.orbs do spr("orb", o.x, o.y) end
end

return E
