-- TOP-DOWN TEMPLATE
-- Find every gem in the meadow. Bats chase you: two sword hits each.
--   move: arrows / WASD / d-pad / left stick      sword: Z / Space / pad A
--
-- Files:   game.luau   shared state (lives, gems)
--          hero.luau   movement, sword, getting hurt
--          world.luau  gems and bats, placed on maps/room with the Object tool
-- The map is maps/room.json. Walls, water and trees have tile flag 0 (solid) in sprites/tiles.json.
local G = require("game")
local Hero = require("hero")
local World = require("world")

local function hud()
  for i = 1, 3 do
    spr("heart", 4 + (i - 1) * 10, 4, { frame = if i <= G.lives then 0 else 1 })
  end
  spr("gem", W - 46, 4)
  text(`{G.gems}/{G.totalGems}`, W - 35, 5, "#f4f4f4", { outline = "#1a1c2c" })
end

Scene.add("title", {
  update = function(dt)
    if btnp("a") or btnp("start") then Scene.go("play") end
  end,
  draw = function()
    cls("#1a1c2c")
    map(G.map, -40, -60)
    rect(0, 40, W, 90, "#1a1c2ccc")
    text("TOP-DOWN", W / 2, 54, "#a7f070", { align = "center", scale = 2, outline = "#1a1c2c" })
    text("find every gem", W / 2, 80, "#f4f4f4", { align = "center" })
    if math.floor(t() * 2) % 2 == 0 then
      text("press Z or A to start", W / 2, 106, "#ffcd75", { align = "center" })
    end
  end,
})

Scene.add("play", {
  enter = function()
    G.reset()
    local start = objects(G.map, "start")[1]
    Hero.spawn(start.x, start.y)
    World.load()
    Cam.follow(Hero.body.x, Hero.body.y, 1, { lerp = 0, bounds = G.map })
  end,
  update = function(dt)
    if UI.pause.update() then return end -- Enter / Esc / pad Start: pause + volume + fullscreen
    Hero.update(dt)
    World.update(dt)
    G.fx:update(dt)
    Cam.follow(Hero.body.x + 5, Hero.body.y, dt, { bounds = G.map })
  end,
  draw = function()
    cls("#1a1c2c")
    Cam.apply()
    map(G.map, 0, 0)
    World.draw()
    Hero.draw()
    G.fx:draw()
    Cam.reset()
    hud()
    UI.pause.draw()
  end,
})

local function endScreen(title, color)
  return {
    update = function(dt)
      if btnp("a") or btnp("start") then Scene.go("play") end
    end,
    draw = function()
      cls("#1a1c2c")
      text(title, W / 2, 60, color, { align = "center", scale = 2 })
      text(`gems: {G.gems}/{G.totalGems}`, W / 2, 95, "#f4f4f4", { align = "center" })
      text("press Z or A to play again", W / 2, 125, "#94b0c2", { align = "center" })
    end,
  }
end
Scene.add("clear", endScreen("ALL GEMS FOUND!", "#73eff7"))
Scene.add("over", endScreen("GAME OVER", "#b13e53"))

-- "Play from here" in the Map tab skips the title (the editor moves the "start" object)
Scene.go(if playtest() then "play" else "title")
