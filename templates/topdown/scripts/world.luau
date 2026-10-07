-- Gems and bats placed on maps/room with the Object tool (O in the Map tab).
local G = require("game")
local Hero = require("hero")

local World = {}

function World.load()
  World.gems, World.bats = {}, {}
  for _, o in objects(G.map, "gem") do
    table.insert(World.gems, { x = o.x - 4, y = o.y - 12, w = 8, h = 8, anim = Anim.new("gem", "shine"), bob = rnd(0, 6) })
  end
  for _, o in objects(G.map, "bat") do
    local bat = { x = o.x - 6, y = o.y - 12, w = 12, h = 8, vx = 0, vy = 0, hp = 2, flash = 0, anim = Anim.new("bat", "fly") }
    bat.anim.speed = rnd(0.8, 1.2)
    table.insert(World.bats, bat)
  end
end

local function updateBat(bat, dt)
  local b = Hero.body
  local dx, dy = b.x - bat.x, b.y - bat.y
  local d = math.sqrt(dx * dx + dy * dy)
  if d < 100 then
    -- chase, with a wobble so they don't stack into one
    bat.vx += (dx / d * 46 - bat.vx) * 2 * dt
    bat.vy += (dy / d * 46 - bat.vy) * 2 * dt + math.sin(t() * 6 + bat.x) * 20 * dt
  else
    bat.vx *= 1 - dt
    bat.vy = math.sin(t() * 2 + bat.x) * 12
  end
  local hit = Physics.move(bat, bat.vx * dt, bat.vy * dt, G.map)
  if hit.left or hit.right then bat.vx = -bat.vx end
  if hit.up or hit.down then bat.vy = -bat.vy end
  bat.flash = math.max(0, bat.flash - dt)
  bat.anim:update(dt)
end

function World.update(dt)
  local b = Hero.body
  local sword = Hero.swordBox()
  for i = #World.gems, 1, -1 do
    local g = World.gems[i]
    g.anim:update(dt)
    if Physics.overlap(b, { x = g.x, y = g.y, w = g.w, h = g.h + 4 }) then
      table.remove(World.gems, i)
      G.gems += 1
      sfx("coin", 0.6)
      G.fx:burst(g.x + 4, g.y + 4, 10, { colors = { "#73eff7", "#f4f4f4" }, speed = 60, life = 0.4 })
      if G.gems == G.totalGems then Scene.go("clear", nil, { fade = 0.6, color = "#f4f4f4" }) end
    end
  end
  for i = #World.bats, 1, -1 do
    local bat = World.bats[i]
    updateBat(bat, dt)
    if sword and bat.flash == 0 and Physics.overlap(sword, bat) then
      bat.hp -= 1
      bat.flash = 0.25
      bat.vx, bat.vy = Hero.fx * 150, Hero.fy * 150
      sfx("hit", 0.5)
      if bat.hp <= 0 then
        table.remove(World.bats, i)
        sfx("explode", 0.5)
        G.fx:burst(bat.x + 6, bat.y + 4, 14, { colors = { "#8f3f8f", "#c06bc0", "#f4f4f4" }, speed = 80, life = 0.45, size = 2 })
      end
    elseif Physics.overlap(b, bat) then
      Hero.hurt(bat.x + bat.w / 2, bat.y + bat.h / 2)
      bat.vx, bat.vy = -bat.vx, -bat.vy
    end
  end
end

function World.draw()
  for _, g in World.gems do
    g.anim:draw(g.x, g.y + math.floor(math.sin(t() * 3 + g.bob) * 1.5))
  end
  for _, bat in World.bats do
    bat.anim:draw(bat.x - 2, bat.y - 8, { tint = if bat.flash > 0 then "#ffffff" else nil, add = bat.flash > 0 })
  end
end

return World
