-- patterns.luau: enemy bullets, laser beams and the pattern library used by enemies and bosses.
--
-- A bullet moves along `ang` at `sp` px/s. Options (all optional, passed in the pattern args):
--   color, size (1-4), rice (elongated), acc (px/s^2), min/max speed, turn (rad/s, first 2 s),
--   wave (sine wobble amplitude, rad) + wf (frequency), bounce (wall bounces),
--   split = { t, n, speed, color, size }  -> bursts into a ring after t seconds,
--   aim = { t, speed, color }             -> stops steering and re-aims at the player after t seconds.

local SIZE_R = { 2, 3, 4.5, 6.5 }        -- hit radius by size
local RIM_FRAME = { 1, 3, 5, 7 }         -- frames in the "bullets" sheet (core = rim + 1)
local MAX_BULLETS = 2400

local PP = {}
Pat.P = PP

function Pat.aimAt(x, y)
  return math.atan2(P.y - y, P.x - x)
end

function Pat.bullet(x, y, ang, speed, a)
  if #eshots >= MAX_BULLETS then return nil end
  local bs = Game.bspeed
  local b = {
    x = x, y = y, ang = ang, dir = ang, sp = speed * bs, t = 0,
    acc = (a.acc or 0) * bs, min = (a.min or 0) * bs, max = (a.max or 999) * bs,
    turn = a.turn or 0, turnT = a.turnT or 2,
    c = BULLET[a.color or "pink"] or BULLET.pink, size = a.size or 2, rice = a.rice or false,
    wave = a.wave, wf = a.wf or 6, bounce = a.bounce or 0, split = a.split, aim = a.aim,
  }
  b.r = SIZE_R[b.size] or 3
  table.insert(eshots, b)
  return b
end

function Pat.fan(x, y, center, n, spread, speed, a)
  for i = 0, n - 1 do
    local k = if n == 1 then 0 else i / (n - 1) - 0.5
    Pat.bullet(x, y, center + k * spread, speed, a)
  end
end

function Pat.ring(x, y, n, speed, offset, a)
  for i = 0, n - 1 do Pat.bullet(x, y, offset + i / n * PI * 2, speed, a) end
end

-- ------------------------------------------------------------------ the library
-- every pattern: (x, y, args, state, source) ; state persists between volleys of one gun

-- n bullets fanned around the player direction
function PP.aim(x, y, a, st)
  Pat.fan(x, y, Pat.aimAt(x, y) + (a.offset or 0), a.n or 1, a.spread or 0.3, a.speed or 140, a)
end

-- fixed direction fan (default: down), can swing back and forth
function PP.fan(x, y, a, st)
  st.ang = (st.ang or 0) + (a.sweep or 0)
  Pat.fan(x, y, (a.angle or PI / 2) + math.sin(st.ang) * (a.swing or 0), a.n or 5, a.spread or 0.8, a.speed or 120, a)
end

-- full ring; spin rotates every volley, rand = random rotation
function PP.ring(x, y, a, st)
  st.ang = (st.ang or 0) + (a.spin or 0)
  Pat.ring(x, y, a.n or 12, a.speed or 80, if a.rand then rnd(0, 6.28) else st.ang, a)
end

-- rotating arms, fire this often (every 0.05 s) for a spiral
function PP.spiral(x, y, a, st)
  st.ang = (st.ang or 0) + (a.step or 0.3)
  local arms = a.arms or 3
  for k = 0, arms - 1 do Pat.bullet(x, y, st.ang + k * PI * 2 / arms, a.speed or 100, a) end
end

-- thin rotating streams (rice bullets)
function PP.cross(x, y, a, st)
  st.ang = (st.ang or 0) + (a.step or 0.12)
  local arms = a.arms or 4
  local o = { color = a.color, size = a.size or 1, rice = true }
  for k = 0, arms - 1 do Pat.bullet(x, y, st.ang + k * PI * 2 / arms, a.speed or 120, o) end
end

-- two spirals rotating in opposite directions -> a woven net
function PP.web(x, y, a, st)
  st.ang = (st.ang or 0) + (a.step or 0.2)
  local arms = a.arms or 4
  local o2 = { color = a.color2 or a.color, size = a.size }
  for k = 0, arms - 1 do
    local o = k * PI * 2 / arms
    Pat.bullet(x, y, st.ang + o, a.speed or 90, a)
    Pat.bullet(x, y, -st.ang + o, a.speed or 90, o2)
  end
end

-- slow ring that accelerates outwards (blooms)
function PP.flower(x, y, a, st)
  st.ang = (st.ang or 0) + (a.spin or 0.2)
  Pat.ring(x, y, a.n or 20, a.speed or 25, st.ang, { color = a.color, size = a.size, acc = a.acc or 70, max = a.max or 200, rice = a.rice })
end

-- rings whose bullets bend; alt flips the bend every volley
function PP.curve(x, y, a, st)
  st.n = (st.n or 0) + 1
  st.ang = (st.ang or 0) + (a.spin or 0.13)
  local turn = (a.turn or 0.8) * (if a.alt and st.n % 2 == 0 then -1 else 1)
  Pat.ring(x, y, a.n or 16, a.speed or 90, st.ang, { color = a.color, size = a.size, turn = turn, rice = a.rice ~= false })
end

-- fast curling bullets that slow down: a whirlpool
function PP.vortex(x, y, a, st)
  st.ang = (st.ang or 0) + (a.step or 0.5)
  local arms = a.arms or 2
  local o = { color = a.color, size = a.size, turn = a.turn or 1.6, acc = -(a.decel or 90), min = a.min or 40, rice = true }
  for k = 0, arms - 1 do Pat.bullet(x, y, st.ang + k * PI * 2 / arms, a.speed or 160, o) end
end

-- wobbling streams
function PP.wave(x, y, a, st)
  local base = if a.aimed then Pat.aimAt(x, y) else (a.angle or PI / 2)
  Pat.fan(x, y, base, a.n or 3, a.spread or 0.6, a.speed or 110,
    { color = a.color, size = a.size, wave = a.wave or 0.6, wf = a.wf or 5, rice = a.rice })
end

-- bullets falling from the top of the screen
function PP.rain(x, y, a, st)
  local o = { color = a.color, size = a.size or 1, acc = a.acc or 20, rice = a.rice }
  for _ = 1, a.n or 6 do
    local s = a.speed or 60
    Pat.bullet(rnd(8, W - 8), rnd(-24, -8), PI / 2 + rnd(-0.15, 0.15), rnd(s, s * 1.8), o)
  end
end

-- a burst of bullets in one line, each faster than the last (reads as a laser shot)
function PP.stream(x, y, a, st)
  local ang = Pat.aimAt(x, y) + (a.offset or 0)
  local o = { color = a.color, size = a.size or 1, rice = true }
  for i = 0, (a.n or 6) - 1 do Pat.bullet(x, y, ang, (a.speed or 120) + i * (a.gap or 22), o) end
end

-- big bullets that burst into rings
function PP.split(x, y, a, st)
  local base = if a.aimed == false then PI / 2 else Pat.aimAt(x, y)
  Pat.fan(x, y, base, a.n or 1, a.spread or 0.6, a.speed or 80, {
    color = a.color, size = 4,
    split = { t = a.t or 1.1, n = a.ring or 12, speed = a.ringSpeed or 90, color = a.color2 or a.color, size = a.size2 or 2 },
  })
end

-- rings that bounce off the side walls
function PP.bounce(x, y, a, st)
  st.ang = (st.ang or 0) + (a.spin or 0)
  Pat.ring(x, y, a.n or 10, a.speed or 100, st.ang, { color = a.color, size = a.size, bounce = a.bounces or 1 })
end

-- ring that stops, then every bullet re-aims at the player
function PP.freeze(x, y, a, st)
  st.ang = (st.ang or 0) + 0.17
  local s = a.speed or 140
  Pat.ring(x, y, a.n or 16, s, st.ang, {
    color = a.color, size = a.size, acc = -s * 1.6, min = 0,
    aim = { t = a.t or 1.2, speed = a.speed2 or 130, color = a.color2 },
  })
end

-- layered rings with growing speed -> petals
function PP.petal(x, y, a, st)
  st.ang = (st.ang or 0) + (a.spin or 0.1)
  local o = { color = a.color, size = a.size, rice = true }
  for k = 0, (a.layers or 3) - 1 do
    Pat.ring(x, y, a.n or 10, (a.speed or 60) + k * (a.gap or 18), st.ang + k * (a.twist or 0.08), o)
  end
end

-- random spray (down, or at the player with aimed = true)
function PP.spray(x, y, a, st)
  local base = if a.aimed then Pat.aimAt(x, y) else (a.angle or PI / 2)
  local s, sp = a.speed or 70, a.spread or 1
  for _ = 1, a.n or 8 do Pat.bullet(x, y, base + rnd(-sp, sp), rnd(s, s * 1.7), a) end
end

-- laser beams: a thin warning line first, then a deadly beam. turn sweeps it while active
function PP.beam(x, y, a, st, src)
  st.n = (st.n or 0) + 1
  local n = a.n or 1
  local base = if a.aimed ~= false then Pat.aimAt(x, y) else (a.angle or PI / 2)
  local turn = (a.turn or 0) * (if a.alt and st.n % 2 == 0 then -1 else 1)
  for i = 0, n - 1 do
    local k = if n == 1 then 0 else i / (n - 1) - 0.5
    table.insert(beams, {
      x = x, y = y, ang = base + k * (a.spread or 0.8), turn = turn,
      w = a.width or 10, warn = math.max(1.0, a.warn or 1.0), life = a.life or 1.0, t = 0, c = BULLET[a.color or "red"],
    })
  end
  sfx("error")
end

function Pat.fire(name, x, y, a, st, src)
  local f = PP[name]
  if f then f(x, y, a, st, src) end
end

-- ------------------------------------------------------------------ update + draw

local function hitPlayer(b)
  if P.dead then return end
  if P.inv <= 0 then Ship.hit() end
end

function Pat.update(dt)
  local graze = false
  local pr = P.r
  for _, b in eshots do
    b.t += dt
    if b.aim and b.t >= b.aim.t then
      b.ang = Pat.aimAt(b.x, b.y)
      b.sp, b.acc, b.min, b.turn = b.aim.speed * Game.bspeed, 0, 0, 0
      if b.aim.color then b.c = BULLET[b.aim.color] end
      b.aim = nil
    end
    if b.split and b.t >= b.split.t then
      local s = b.split
      b.split = nil
      b.dead = true
      Pat.ring(b.x, b.y, s.n, s.speed, rnd(0, 6.28), { color = s.color, size = s.size })
      FX.burst(b.x, b.y, 4, { b.c[2], "#ffffff" }, { speed = 60, add = true, gravity = 0, life = 0.4 })
    end
    b.sp = math.clamp(b.sp + b.acc * dt, b.min, b.max)
    if b.turn ~= 0 and b.t < b.turnT then b.ang += b.turn * dt end
    local d = b.ang
    if b.wave then d += math.sin(b.t * b.wf) * b.wave end
    b.dir = d
    b.x += math.cos(d) * b.sp * dt
    b.y += math.sin(d) * b.sp * dt
    if b.bounce > 0 and (b.x < 3 or b.x > W - 3) then
      b.ang = PI - b.ang
      b.bounce -= 1
      b.x = math.clamp(b.x, 3, W - 3)
    end
    if not P.dead then
      local dx, dy = b.x - P.x, b.y - P.y
      local d2 = dx * dx + dy * dy
      local hr = b.r * 0.7 + pr
      if d2 < hr * hr then
        b.dead = true
        hitPlayer(b)
      elseif d2 < 196 and not b.grazed then
        b.grazed = true
        Ship.graze(b)
        graze = true
      end
    end
    if b.x < -30 or b.x > W + 30 or b.y < -40 or b.y > H + 30 or b.t > 14 then b.dead = true end
  end
  if graze then beep(1400, 0.02, "sine", 0.06) end
  eshots = Util.keep(eshots, function(b) return not b.dead end)

  for _, bm in beams do
    bm.t += dt
    local active = bm.t >= bm.warn
    if active then
      bm.ang += bm.turn * dt
      if not bm.on then
        bm.on = true
        FX.kick(3, 0)
        sfx("explode")
      end
      if not P.dead and P.inv <= 0 then
        -- distance from the player to the beam line
        local cx, cy = math.cos(bm.ang), math.sin(bm.ang)
        local px, py = P.x - bm.x, P.y - bm.y
        local along = px * cx + py * cy
        local across = math.abs(px * -cy + py * cx)
        if along > 0 and across < bm.w * 0.38 + P.r then hitPlayer(bm) end
      end
    end
    if bm.t > bm.warn + bm.life then bm.dead = true end
  end
  beams = Util.keep(beams, function(b) return not b.dead end)
end

-- turn all bullets into score stars (phase change, bomb) or just pop them
function Pat.cancel(toStars)
  for _, b in eshots do
    if toStars then table.insert(items, { kind = "star", x = b.x, y = b.y, vy = -40, t = 0, magnet = true }) end
  end
  for i = 1, math.min(#eshots, 120) do
    local b = eshots[i]
    FX.burst(b.x, b.y, 1, { b.c[2] }, { speed = 40, add = true, gravity = 0, life = 0.5 })
  end
  eshots = {}
  beams = {}
end

function Pat.draw()
  -- beams under the bullets
  for _, bm in beams do
    local len = 800
    if bm.t < bm.warn then
      local blink = math.floor(bm.t * 16) % 2 == 0
      local soon = bm.t > bm.warn - 0.3
      spr("bullets", bm.x, bm.y, { frame = 11, ox = 0, oy = 0.5, sx = len / 16, sy = (if soon then 4 else 2) / 16, rot = bm.ang, tint = bm.c[2], alpha = if blink or soon then 0.95 else 0.5 })
    else
      local k = bm.t - bm.warn
      local grow = math.min(1, k * 10) * math.min(1, (bm.life - k) * 6)
      local w = bm.w * grow
      spr("bullets", bm.x, bm.y, { frame = 11, ox = 0, oy = 0.5, sx = len / 16, sy = (w * 1.6) / 16, rot = bm.ang, tint = bm.c[2], alpha = 0.35, add = true })
      spr("bullets", bm.x, bm.y, { frame = 11, ox = 0, oy = 0.5, sx = len / 16, sy = w / 16, rot = bm.ang, tint = bm.c[2] })
      spr("bullets", bm.x, bm.y, { frame = 11, ox = 0, oy = 0.5, sx = len / 16, sy = (w * 0.45) / 16, rot = bm.ang, tint = bm.c[1] })
      circ(bm.x, bm.y, w * 0.9, bm.c[1], true)
    end
  end
  -- glow pass for big bullets
  for _, b in eshots do
    if b.size >= 3 then spr("bullets", b.x, b.y, { frame = 0, ox = 0.5, oy = 0.5, tint = b.c[2], alpha = 0.45, add = true, scale = b.size * 0.3 }) end
  end
  for _, b in eshots do
    if b.rice then
      spr("bullets", b.x, b.y, { frame = 9, ox = 0.5, oy = 0.5, rot = b.dir, tint = b.c[2] })
      spr("bullets", b.x, b.y, { frame = 10, ox = 0.5, oy = 0.5, rot = b.dir, tint = b.c[1] })
    else
      local f = RIM_FRAME[b.size] or 3
      spr("bullets", b.x, b.y, { frame = f, ox = 0.5, oy = 0.5, tint = b.c[2] })
      spr("bullets", b.x, b.y, { frame = f + 1, ox = 0.5, oy = 0.5, tint = b.c[1] })
    end
  end
end
