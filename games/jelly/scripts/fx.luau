-- Particles: little squares that fly, fall and fade.

local S = require("state")

local fx = {}

-- n particles from (x, y). o: angle, spread, speed, gravity, life, size
function fx.burst(x, y, n, colors, o)
  o = o or {}
  for _ = 1, n do
    local a = (o.angle or -math.pi / 2) + rnd(-(o.spread or math.pi), o.spread or math.pi)
    local v = rnd(0.3, 1) * (o.speed or 80)
    local life = rnd(0.3, 0.7) * (o.life or 1)
    table.insert(S.parts, { x = x, y = y, vx = math.cos(a) * v, vy = math.sin(a) * v, g = o.gravity or 300,
      life = life, max = life, c = pick(colors), s = o.size or irnd(1, 2) })
  end
end

function fx.update(dt)
  local alive = {}
  for _, p in S.parts do
    p.life -= dt
    p.vy += p.g * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    if p.life > 0 then table.insert(alive, p) end
  end
  S.parts = alive
end

function fx.draw()
  for _, p in S.parts do
    rect(p.x, p.y, p.s, p.s, p.c)
  end
end

return fx
