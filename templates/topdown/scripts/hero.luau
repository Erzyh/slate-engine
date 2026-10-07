-- The hero: walks in 8 directions, swings a sword with Z / pad A.
local G = require("game")

local Hero = {}

local SPEED, SWING_TIME, INVINCIBLE = 72, 0.18, 1.0

-- x, y = feet (bottom-center), like map objects
function Hero.spawn(x, y)
  -- the collision box is the lower part of the sprite, so you can walk "behind" tree tops a bit
  Hero.body = { x = x - 5, y = y - 8, w = 10, h = 8 }
  Hero.dir = "down"
  Hero.fx, Hero.fy = 0, 1 -- facing vector
  Hero.swingT, Hero.hurtT = 0, 0
  Hero.kx, Hero.ky = 0, 0 -- knockback
  Hero.anim = Anim.new("hero", "down")
end

function Hero.hurt(fromX, fromY)
  if Hero.hurtT > 0 or G.lives <= 0 then return end
  G.lives -= 1
  Hero.hurtT = INVINCIBLE
  sfx("hit")
  Cam.shake(3, 0.2)
  local b = Hero.body
  local dx, dy = b.x + b.w / 2 - fromX, b.y + b.h / 2 - fromY
  local d = math.max(1, math.sqrt(dx * dx + dy * dy))
  Hero.kx, Hero.ky = dx / d * 160, dy / d * 160
  if G.lives <= 0 then Scene.go("over", nil, { fade = 0.5 }) end
end

-- the sword's hit box while swinging, or nil
function Hero.swordBox()
  if Hero.swingT <= 0 then return nil end
  local b = Hero.body
  local cx, cy = b.x + b.w / 2 + Hero.fx * 12, b.y + b.h / 2 - 4 + Hero.fy * 12
  return { x = cx - 9, y = cy - 9, w = 18, h = 18 }
end

function Hero.update(dt)
  local b = Hero.body
  Hero.hurtT = math.max(0, Hero.hurtT - dt)
  Hero.swingT = math.max(0, Hero.swingT - dt)

  local ax, ay = axis("x"), axis("y")
  local len = math.sqrt(ax * ax + ay * ay)
  if len > 1 then ax, ay = ax / len, ay / len end -- diagonals aren't faster
  local moving = len > 0.2
  if moving then
    local fx = if math.abs(ax) > 0.3 then math.sign(ax) else 0
    local fy = if math.abs(ay) > 0.3 then math.sign(ay) else 0
    if fx ~= 0 or fy ~= 0 then Hero.fx, Hero.fy = fx, fy end
    if math.abs(ax) > math.abs(ay) then
      Hero.dir = "side"
    else
      Hero.dir = if ay < 0 then "up" else "down"
    end
  end

  if btnp("a") and Hero.swingT == 0 then
    Hero.swingT = SWING_TIME
    sfx("click", 0.6)
  end

  -- slow down while swinging; knockback fades out
  local speed = if Hero.swingT > 0 then SPEED * 0.4 else SPEED
  local dx, dy = ax * speed + Hero.kx, ay * speed + Hero.ky
  Hero.kx *= math.max(0, 1 - 10 * dt)
  Hero.ky *= math.max(0, 1 - 10 * dt)
  Physics.move(b, dx * dt, dy * dt, G.map)

  -- walk cycle only while moving; standing still shows the first frame
  Hero.anim:play(Hero.dir)
  if moving then
    Hero.anim:update(dt)
  else
    Hero.anim:play(Hero.dir, { restart = true })
  end
end

function Hero.draw()
  local b = Hero.body
  local blink = Hero.hurtT > 0 and math.floor(Hero.hurtT * 14) % 2 == 0
  if not blink then
    Hero.anim:draw(b.x - 3, b.y - 8, { flipX = Hero.dir == "side" and Hero.fx < 0 })
  end
  -- sword swipe: a short arc in front of the hero
  if Hero.swingT > 0 then
    local k = 1 - Hero.swingT / SWING_TIME
    local cx, cy = b.x + b.w / 2, b.y + b.h / 2 - 4
    local base = math.atan2(Hero.fy, Hero.fx)
    for i = 0, 4 do
      local a = base - 1.1 + (k * 2.2) * (i / 4)
      line(cx + math.cos(a) * 6, cy + math.sin(a) * 6, cx + math.cos(a) * 15, cy + math.sin(a) * 15, if i == 4 then "#f4f4f4" else "#94b0c2")
    end
  end
end

return Hero
