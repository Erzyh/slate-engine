-- PLATFORMER TEMPLATE
-- Run and jump to the flag. Stomp slimes, grab coins, don't touch the spikes.
--   move: arrows / WASD / d-pad / left stick      jump: Z / Space / pad A (hold for higher)
--
-- Files:   game.luau    shared state (lives, coins)
--          player.luau  movement and feel (tweak the numbers at the top!)
--          world.luau   coins, slimes and the goal, placed on maps/level1 with the Object tool
-- The level is maps/level1.json: open it in the Map tab and paint.
local G = require("game")
local P = require("player")
local World = require("world")

local function backdrop()
  cls("#29366f")
  -- far hills scroll slower than the level (parallax)
  local px = -(Cam.x * 0.25) % 90
  for i = -1, 4 do
    circ(px + i * 90, H - 10, 44, "#3b5dc9", true)
  end
  local qx = -(Cam.x * 0.5) % 70
  for i = -1, 5 do
    circ(qx + i * 70 + 35, H + 4, 36, "#257179", true)
  end
end

local function hud()
  for i = 1, 3 do
    spr("heart", 4 + (i - 1) * 10, 4, { frame = if i <= G.lives then 0 else 1 })
  end
  spr("coin", W - 40, 4)
  text(`x {G.coins}`, W - 29, 5, "#f4f4f4", { outline = "#1a1c2c" })
end

Scene.add("title", {
  update = function(dt)
    if btnp("a") or btnp("start") then Scene.go("play") end
  end,
  draw = function()
    backdrop()
    text("PLATFORMER", W / 2, 50, "#ffcd75", { align = "center", scale = 2, outline = "#1a1c2c" })
    spr("hero", W / 2 - 8, 80, { anim = "idle" })
    if math.floor(t() * 2) % 2 == 0 then
      text("press Z or A to start", W / 2, 110, "#f4f4f4", { align = "center", outline = "#1a1c2c" })
    end
  end,
})

Scene.add("play", {
  enter = function()
    G.reset()
    local start = objects(G.map, "start")[1]
    P.spawn(start.x, start.y)
    World.load()
    Cam.follow(P.body.x, P.body.y, 1, { lerp = 0, bounds = G.map })
  end,
  update = function(dt)
    if UI.pause.update() then return end -- Enter / Esc / pad Start: pause + volume + fullscreen
    P.update(dt)
    World.update(dt)
    G.fx:update(dt)
    local b = P.body
    Cam.follow(b.x + b.w / 2, b.y, dt, { bounds = G.map, lookX = P.facing * 24 })
  end,
  draw = function()
    backdrop()
    Cam.apply()
    map(G.map, 0, 0)
    World.draw()
    P.draw()
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
      text(`coins: {G.coins}`, W / 2, 95, "#f4f4f4", { align = "center" })
      text("press Z or A to play again", W / 2, 125, "#94b0c2", { align = "center" })
    end,
  }
end
Scene.add("clear", endScreen("LEVEL CLEAR!", "#a7f070"))
Scene.add("over", endScreen("GAME OVER", "#b13e53"))

-- "Play from here" in the Map tab skips the title (the editor moves the "start" object)
Scene.go(if playtest() then "play" else "title")
