-- Your ship. It fires on its own; you only dodge. The hit box is a tiny core in the middle,
-- so bullets that only brush the wings don't count (that's how shooters stay fair).
local G = require("game")

local Ship = {}

local SPEED, FIRE_EVERY, INVINCIBLE = 120, 0.09, 2.0

function Ship.spawn()
  Ship.x, Ship.y = W / 2, H - 40
  Ship.vx = 0
  Ship.fireT, Ship.hurtT = 0, 1.0
end

-- the small box enemy bullets must touch
function Ship.core()
  return { x = Ship.x - 2, y = Ship.y - 1, w = 4, h = 4 }
end

function Ship.hurt()
  if Ship.hurtT > 0 or G.lives <= 0 then return end
  G.lives -= 1
  Ship.hurtT = INVINCIBLE
  sfx("explode")
  Cam.shake(4, 0.3)
  G.fx:burst(Ship.x, Ship.y, 24, { colors = { "#ffcd75", "#ef7d57", "#f4f4f4" }, speed = 110, life = 0.6, size = 2 })
  G.orbs = {} -- clear the screen after a hit: no unfair double hits
  if G.lives <= 0 then
    save("best", G.best)
    Timer.after(1.0, function() Scene.go("over", nil, { fade = 0.5 }) end)
  end
end

function Ship.update(dt)
  Ship.hurtT = math.max(0, Ship.hurtT - dt)
  if G.lives <= 0 then return end
  local ax, ay = axis("x"), axis("y")
  local slow = if btn("b") then 0.5 else 1 -- hold X / pad B to move slowly through tight gaps
  Ship.x = clamp(Ship.x + ax * SPEED * slow * dt, 8, W - 8)
  Ship.y = clamp(Ship.y + ay * SPEED * slow * dt, 16, H - 10)
  Ship.vx = ax

  Ship.fireT -= dt
  if Ship.fireT <= 0 then
    Ship.fireT = FIRE_EVERY
    table.insert(G.shots, { x = Ship.x - 4, y = Ship.y - 8, w = 2, h = 8 })
    table.insert(G.shots, { x = Ship.x + 2, y = Ship.y - 8, w = 2, h = 8 })
  end
  for i = #G.shots, 1, -1 do
    local s = G.shots[i]
    s.y -= 360 * dt
    if s.y < -10 then table.remove(G.shots, i) end
  end
end

function Ship.draw()
  for _, s in G.shots do spr("shot", s.x, s.y) end
  if G.lives <= 0 then return end
  if Ship.hurtT > 0 and math.floor(Ship.hurtT * 14) % 2 == 0 then return end
  local frame = if Ship.vx < -0.3 then 0 elseif Ship.vx > 0.3 then 2 else 1
  spr("ship", Ship.x, Ship.y, { frame = frame, ox = 0.5, oy = 0.5 })
  -- engine flicker
  if math.floor(t() * 20) % 2 == 0 then
    rect(Ship.x - 1, Ship.y + 8, 2, 2, "#ffcd75")
  end
end

return Ship
