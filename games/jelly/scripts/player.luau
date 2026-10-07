-- The jelly. It is one sprite: squash, stretch, wobble and tilt all happen in code -
-- a damped spring (sq = squash amount, sqv = its velocity) gets kicked on jumps and landings.

local C = require("config")
local S = require("state")
local world = require("world")
local fx = require("fx")

local player = {}

-- dev autopilot (trailer footage): F8
player.auto = { on = false, hold = 0, press = false, stuck = 0, back = 0 }
local auto = player.auto

function player.spawn(x, y)
  S.player = { x = x, y = y, vx = 0, vy = 0, ground = false, coyote = 0, buffer = 0, sq = 0, sqv = 0, face = 1,
    dead = false, deadT = 0, inv = 0, safeX = x, safeY = y, rot = 0, cut = false }
end

-- squash (+) / stretch (-) impulse
function player.wobble(amount)
  S.player.sqv += amount
end

function player.hurt()
  local P = S.player
  if P.dead or P.inv > 0 then return end
  P.dead, P.deadT = true, 0.9
  S.deaths += 1
  fx.burst(P.x, P.y - 6, 26, { "#4fd3a5", "#a2f5c8", "#2c9e8f", "#f4fbff" }, { speed = 160, gravity = 500 })
  sfx("explode")
end

local function moveX(P, dt)
  local nx = P.x + P.vx * dt
  local side = if P.vx > 0 then nx + 6 else nx - 6
  if P.vx ~= 0 and (world.solid(side, P.y - 2) or world.solid(side, P.y - 7) or world.solid(side, P.y - 12)) then
    P.x = if P.vx > 0 then math.floor(side / C.T) * C.T - 6.01 else (math.floor(side / C.T) + 1) * C.T + 6.01
    P.vx = 0
  else
    P.x = nx
  end
end

local function moveY(P, dt)
  local ny = P.y + P.vy * dt
  local wasGround = P.ground
  P.ground = false
  if P.vy >= 0 then
    for _, ox in { -5, 5 } do
      local tile = world.tileAt(P.x + ox, ny)
      local top = math.floor(ny / C.T) * C.T
      if C.SOLID[tile] or (tile == C.PLATFORM and P.y <= top + 1) then
        if not wasGround and P.vy > 120 then
          player.wobble(math.min(P.vy / 90, 5))
          fx.burst(P.x, top, 6, { "#ffffff", "#c8e8c0" }, { angle = -math.pi / 2, spread = 1.3, speed = 50, gravity = 100 })
        end
        P.y, P.vy, P.ground = top, 0, true
        return
      end
    end
  else
    for _, ox in { -5, 5 } do
      if world.solid(P.x + ox, ny - 13) then
        P.vy = 0
        P.y = (math.floor((ny - 13) / C.T) + 1) * C.T + 13
        player.wobble(-2)
        return
      end
    end
  end
  P.y = ny
end

-- autopilot: run right, jump at pits, walls and beetles, walk onto springs, back off when stuck
local function autopilot(P, dt)
  auto.press = false
  auto.hold -= dt
  auto.back -= dt
  if world.solid(P.x + 8, P.y - 6) then auto.stuck += dt else auto.stuck = 0 end
  if auto.stuck > 1 then
    auto.stuck, auto.back = 0, 0.7
  end
  if auto.back > 0 or not P.ground then return end
  local ax = P.x + 7
  local pit = not world.solid(ax, P.y + 4) and world.tileAt(ax, P.y + 4) ~= C.PLATFORM
  local wall = world.solid(P.x + 14, P.y - 4)
  local near, spring = false, false
  for _, o in S.objs do
    local d = o.x - P.x
    if o.type == "spring" and d > -4 and d < 70 then spring = true end
    if o.alive and o.type == "beetle" and d > 0 and d < 44 and math.abs(o.y - P.y) < 20 then near = true end
  end
  if spring then near, wall = false, false end
  if pit or wall or near then
    auto.press, auto.hold = true, 0.4
  end
end

local function jumpHeld()
  return key("z") or key("space") or key("up") or key("w") or auto.hold > 0
end

function player.update(dt)
  local P = S.player
  if P.dead then
    P.deadT -= dt
    if P.deadT <= 0 then
      P.dead, P.inv, P.x, P.y, P.vx, P.vy = false, 1.2, P.safeX, P.safeY, 0, 0
      player.wobble(4)
    end
    return
  end
  P.inv = math.max(0, P.inv - dt)
  if auto.on then autopilot(P, dt) end
  local autoDir = if auto.on then (if auto.back > 0 then -1 else 1) else 0
  local dir = (if key("right") or key("d") or autoDir > 0 then 1 else 0) - (if key("left") or key("a") or autoDir < 0 then 1 else 0)
  if dir ~= 0 then
    P.vx = clamp(P.vx + dir * C.ACCEL * dt, -C.RUN, C.RUN)
    P.face = dir
  else
    P.vx = P.vx * math.max(0, 1 - 12 * dt)
  end
  -- jump: coyote time + input buffer + variable height
  P.coyote = if P.ground then 0.1 else P.coyote - dt
  P.buffer = if keyp("z") or keyp("space") or keyp("up") or keyp("w") or auto.press then 0.12 else P.buffer - dt
  if P.buffer > 0 and P.coyote > 0 then
    P.vy, P.buffer, P.coyote, P.cut = -C.JUMP, 0, 0, true
    player.wobble(-4.5)
    fx.burst(P.x, P.y, 5, { "#ffffff", "#c8e8c0" }, { angle = math.pi / 2, spread = 1.2, speed = 40, gravity = 0 })
    sfx("jump")
  end
  -- releasing jump early cuts a jump short (never a spring bounce)
  if P.cut and P.vy < 0 and not jumpHeld() then P.vy += C.GRAV * dt * 1.5 end
  P.vy = math.min(P.vy + C.GRAV * dt, 420)
  moveX(P, dt)
  moveY(P, dt)
  -- remember a safe spot to respawn
  if P.ground and world.solid(P.x - 5, P.y + 1) and world.solid(P.x + 5, P.y + 1) then P.safeX, P.safeY = P.x, P.y end
  -- spikes and pits
  if world.tileAt(P.x, P.y - 3) == C.SPIKES or P.y > S.mapH + 20 then player.hurt() end
  -- the jelly spring
  local runWobble = if P.ground and math.abs(P.vx) > 20 then math.sin(t() * 22) * 0.06 else 0
  P.sqv += (-(P.sq - runWobble) * 420 - P.sqv * 11) * dt
  P.sq = clamp(P.sq + P.sqv * dt, -0.45, 0.45)
  P.rot = lerp(P.rot, (if P.ground then P.vx / C.RUN * 0.08 else P.vx / C.RUN * 0.18 + P.vy / 900 * 0.1), math.min(1, dt * 12))
end

function player.draw()
  local P = S.player
  if P.dead then return end
  if P.inv > 0 and math.floor(P.inv * 14) % 2 == 0 then return end
  spr(S.jellySprite, P.x, P.y, { ox = 0.5, oy = 1, sx = 1 + P.sq, sy = 1 - P.sq, rot = P.rot, flipX = P.face < 0 })
end

return player
