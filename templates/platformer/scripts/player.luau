-- The hero. Coyote time (jump just after leaving a ledge), jump buffering (press jump just
-- before landing) and variable jump height (let go early for a short hop) make it feel fair.
local G = require("game")

local P = {}

local SPEED, ACCEL, FRICTION = 92, 900, 1000
local GRAVITY, JUMP, MAX_FALL = 820, 285, 320
local COYOTE, BUFFER, INVINCIBLE = 0.09, 0.12, 1.2
local MAP_OPTS = { oneway = 1 } -- tile flag bit 1 = jump-through planks

-- x, y = where the feet are (bottom-center), like map objects
function P.spawn(x, y)
  P.body = { x = x - 6, y = y - 12, w = 12, h = 12, vx = 0, vy = 0 }
  P.safe = { x = P.body.x, y = P.body.y }
  P.facing, P.coyote, P.buffer, P.hurtT, P.safeT, P.bouncing = 1, 0, 0, 0, 0, false
  P.anim = Anim.new("hero", "idle")
end

function P.bounce(speed)
  P.body.vy = -speed
  P.bouncing = true -- a stomp bounce isn't cut short by letting go of jump
end

-- lose a heart; `fall` = spikes or a pit, which also puts you back on safe ground
function P.hurt(fall, fromX)
  if G.lives <= 0 or (P.hurtT > 0 and not fall) then return end
  G.lives -= 1
  P.hurtT = INVINCIBLE
  sfx("hit")
  Cam.shake(3, 0.25)
  local b = P.body
  if fall then
    b.x, b.y, b.vx, b.vy = P.safe.x, P.safe.y, 0, 0
  else
    b.vx = if b.x + b.w / 2 < (fromX or 0) then -120 else 120
    P.bounce(160)
  end
  if G.lives <= 0 then Scene.go("over", nil, { fade = 0.5 }) end
end

function P.update(dt)
  local b = P.body
  P.hurtT = math.max(0, P.hurtT - dt)

  -- run (axis("x") is -1..1 from arrows, WASD, d-pad or the left stick)
  local ax = axis("x")
  if ax ~= 0 then
    b.vx = clamp(b.vx + ax * ACCEL * dt, -SPEED, SPEED)
    P.facing = if ax > 0 then 1 else -1
  else
    local f = FRICTION * dt
    b.vx = if math.abs(b.vx) <= f then 0 else b.vx - f * math.sign(b.vx)
  end

  -- jump
  local grounded = Physics.grounded(b, G.map, MAP_OPTS)
  P.coyote = if grounded then COYOTE else P.coyote - dt
  P.buffer = if btnp("a") then BUFFER else P.buffer - dt
  if P.buffer > 0 and P.coyote > 0 then
    b.vy = -JUMP
    P.buffer, P.coyote, P.bouncing = 0, 0, false
    sfx("jump", 0.4)
    G.fx:burst(b.x + b.w / 2, b.y + b.h, 5, { colors = { "#f4f4f4", "#94b0c2" }, speed = 40, life = 0.25, spread = 1.2 })
  end
  if b.vy >= 0 then P.bouncing = false end
  if not btn("a") and b.vy < -90 and not P.bouncing then b.vy = -90 end

  -- fall and move through the map
  b.vy = math.min(b.vy + GRAVITY * dt, MAX_FALL)
  local hit = Physics.move(b, b.vx * dt, b.vy * dt, G.map, MAP_OPTS)
  if hit.down or hit.up then b.vy = 0 end
  if hit.left or hit.right then b.vx = 0 end

  -- spikes (tile flag bit 2) and pits
  local feet = b.y + b.h - 3
  if msolid(G.map, b.x + 3, feet, 2) or msolid(G.map, b.x + b.w - 3, feet, 2) then
    P.hurt(true)
  elseif b.y > mapinfo(G.map).h * 16 then
    P.hurt(true)
  end

  -- remember solid ground to respawn on
  if grounded and P.hurtT == 0 then
    P.safeT += dt
    if P.safeT > 0.25 then P.safe.x, P.safe.y = b.x, b.y end
  else
    P.safeT = 0
  end

  -- the animation follows the state
  if not grounded then
    P.anim:play(if b.vy < 0 then "jump" else "fall")
  elseif math.abs(b.vx) > 8 then
    P.anim:play("run")
  else
    P.anim:play("idle")
  end
  P.anim:update(dt)
end

function P.draw()
  local b = P.body
  if P.hurtT > 0 and math.floor(P.hurtT * 12) % 2 == 0 then return end -- blink while invincible
  P.anim:draw(b.x - 2, b.y - 4, { flipX = P.facing < 0 })
end

return P
