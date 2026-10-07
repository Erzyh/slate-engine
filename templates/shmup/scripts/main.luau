-- SHOOTER TEMPLATE (vertical shoot 'em up)
-- Your ship fires by itself: dodge and survive as long as you can.
--   move: arrows / WASD / d-pad / left stick      slow move: hold X / pad B
--
-- Files:   game.luau     shared state (lives, score, bullets)
--          ship.luau     your ship
--          enemies.luau  enemy kinds and waves (add your own kind to KINDS!)
local G = require("game")
local Ship = require("ship")
local Enemies = require("enemies")

-- a starfield in three layers: far stars are dim and slow
local stars = {}
for i = 1, 70 do
  local layer = (i % 3) + 1
  table.insert(stars, { x = rnd(0, W), y = rnd(0, H), speed = layer * 18, color = ({ "#333c57", "#566c86", "#94b0c2" })[layer] })
end

local function space(dt)
  for _, s in stars do
    s.y += s.speed * dt
    if s.y > H then s.y, s.x = 0, rnd(0, W) end
  end
end

local function drawSpace()
  cls("#0b0d1a")
  for _, s in stars do rect(s.x, s.y, 1, if s.speed > 40 then 2 else 1, s.color) end
end

local function hud()
  text(`{G.score}`, 4, 4, "#f4f4f4", { outline = "#0b0d1a" })
  text(`BEST {G.best}`, W - 4, 4, "#94b0c2", { align = "right", outline = "#0b0d1a" })
  for i = 1, 3 do
    spr("heart", 4 + (i - 1) * 10, H - 12, { frame = if i <= G.lives then 0 else 1 })
  end
end

Scene.add("title", {
  update = function(dt)
    space(dt)
    if btnp("a") or btnp("start") then Scene.go("play") end
  end,
  draw = function()
    drawSpace()
    text("SHOOTER", W / 2, 90, "#73eff7", { align = "center", scale = 2, outline = "#0b0d1a" })
    spr("ship", W / 2, 150, { frame = 1, ox = 0.5, oy = 0.5 })
    if math.floor(t() * 2) % 2 == 0 then
      text("press Z or A", W / 2, 200, "#ffcd75", { align = "center" })
    end
    text(`best {load("best", 0)}`, W / 2, 220, "#566c86", { align = "center" })
  end,
})

Scene.add("play", {
  enter = function()
    G.reset()
    Ship.spawn()
    Enemies.start()
  end,
  leave = function()
    Enemies.stop()
  end,
  update = function(dt)
    if UI.pause.update() then return end -- Enter / Esc / pad Start: pause + volume + fullscreen
    G.time += dt
    space(dt)
    Ship.update(dt)
    Enemies.update(dt)
    G.fx:update(dt)
  end,
  draw = function()
    drawSpace()
    Cam.apply() -- only for the shake
    Enemies.draw()
    Ship.draw()
    G.fx:draw()
    Cam.reset()
    hud()
    UI.pause.draw()
  end,
})

Scene.add("over", {
  update = function(dt)
    space(dt)
    if btnp("a") or btnp("start") then Scene.go("play") end
  end,
  draw = function()
    drawSpace()
    text("GAME OVER", W / 2, 110, "#b13e53", { align = "center", scale = 2 })
    text(`score {G.score}`, W / 2, 145, "#f4f4f4", { align = "center" })
    text(`best {G.best}`, W / 2, 160, "#94b0c2", { align = "center" })
    text("press Z or A", W / 2, 200, "#ffcd75", { align = "center" })
  end,
})

Scene.go("title")
