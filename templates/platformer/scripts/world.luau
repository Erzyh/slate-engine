-- Things placed on the map with the Object tool (O in the Map tab): coins, slimes, the goal.
local G = require("game")
local P = require("player")

local World = {}

function World.load()
  World.coins, World.slimes = {}, {}
  for _, o in objects(G.map, "coin") do
    table.insert(World.coins, { x = o.x - 4, y = o.y - 12, w = 8, h = 8, anim = Anim.new("coin", "spin") })
  end
  for _, o in objects(G.map, "slime") do
    table.insert(World.slimes, { x = o.x - 7, y = o.y - 8, w = 14, h = 8, vy = 0, dir = -1, anim = Anim.new("slime", "walk") })
  end
  local g = objects(G.map, "goal")[1]
  World.goal = if g then { x = g.x - 6, y = g.y - 16, w = 8, h = 16, anim = Anim.new("flag", "wave") } else nil
end

local function slime(s, dt)
  -- walk, turn around at walls and ledges
  s.vy = math.min(s.vy + 800 * dt, 300)
  local hit = Physics.move(s, s.dir * 22 * dt, s.vy * dt, G.map, { oneway = 1 })
  if hit.down then s.vy = 0 end
  local aheadX = if s.dir > 0 then s.x + s.w + 1 else s.x - 1
  local ground = msolid(G.map, aheadX, s.y + s.h + 2) or msolid(G.map, aheadX, s.y + s.h + 2, 1)
  if hit.left or hit.right or (hit.down and not ground) then s.dir = -s.dir end
  s.anim:update(dt)
end

function World.update(dt)
  local b = P.body
  for i = #World.coins, 1, -1 do
    local c = World.coins[i]
    c.anim:update(dt)
    if Physics.overlap(b, c) then
      table.remove(World.coins, i)
      G.coins += 1
      sfx("coin", 0.6)
      G.fx:burst(c.x + 4, c.y + 4, 8, { colors = { "#ffcd75", "#f4f4f4" }, speed = 60, life = 0.35 })
    end
  end
  for i = #World.slimes, 1, -1 do
    local s = World.slimes[i]
    slime(s, dt)
    if Physics.overlap(b, s) then
      -- coming down on top of it = stomp
      if b.vy > 0 and b.y + b.h - s.y < 7 then
        table.remove(World.slimes, i)
        P.bounce(220)
        sfx("explode", 0.5)
        Cam.shake(2, 0.15)
        G.fx:burst(s.x + 7, s.y + 4, 14, { colors = { "#a7f070", "#38b764" }, speed = 90, gravity = 300, life = 0.5, size = 2 })
      else
        P.hurt(false, s.x + s.w / 2)
      end
    end
  end
  if World.goal then
    World.goal.anim:update(dt)
    if Physics.overlap(b, World.goal) then
      sfx("powerup")
      Scene.go("clear", nil, { fade = 0.6, color = "#f4f4f4" })
      World.goal = nil
    end
  end
end

function World.draw()
  for _, c in World.coins do c.anim:draw(c.x, c.y) end
  for _, s in World.slimes do s.anim:draw(s.x - 1, s.y - 8, { flipX = s.dir < 0 }) end
  if World.goal then World.goal.anim:draw(World.goal.x - 2, World.goal.y) end
end

return World
