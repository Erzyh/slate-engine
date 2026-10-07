-- JELLY JUMP - a tiny platformer made in Slate.
-- main.luau runs first; the other scripts are modules it loads with require().
--
--   config   tuning values and tile ids          world    tiles, background, camera
--   state    the shared game state               fx       particles
--   player   the jelly                           objects  coins, beetles, springs, flag

local C = require("config")
local S = require("state")
local world = require("world")
local fx = require("fx")
local player = require("player")
local objects = require("objects")

local function alpha(c, a)
  return string.sub(c, 1, 7) .. string.format("%02x", math.floor(math.clamp(a, 0, 1) * 255))
end

local function clock()
  return string.format("%d:%02d", math.floor(S.timer / 60), math.floor(S.timer % 60))
end

local function startRun()
  S.parts = {}
  objects.spawn()
  S.timer, S.deaths = 0, 0
  S.scene, S.sceneT = "play", 0
end

function init()
  world.load()
  objects.spawn()
  music("theme", { volume = 0.6 })
end

function update(dt)
  S.sceneT += dt
  if C.DEV and keyp("f8") then player.auto.on = not player.auto.on end
  if S.scene == "title" then
    if keyp("z") or keyp("space") or keyp("enter") then startRun() end
    return
  end
  if S.scene == "play" then
    S.timer += dt
    if C.DEV and keyp("f2") then S.player.x, S.player.y = (S.mapW - 12) * C.T, 8 * C.T end
    player.update(dt)
  elseif S.scene == "clear" and S.sceneT > 1.5 and (keyp("z") or keyp("enter")) then
    startRun()
    return
  end
  objects.update(dt)
  fx.update(dt)
  world.updateCamera(dt)
end

local function drawTitle()
  local bob = math.sin(S.sceneT * 2) * 3
  text("JELLY", W / 2 + 2, 38 + bob + 2, "#1b1a2a", { align = "center", scale = 4 })
  text("JELLY", W / 2, 38 + bob, "#4fd3a5", { align = "center", scale = 4, outline = "#1b1a2a" })
  text("JUMP", W / 2 + 2, 72 - bob + 2, "#1b1a2a", { align = "center", scale = 4 })
  text("JUMP", W / 2, 72 - bob, "#ffe27a", { align = "center", scale = 4, outline = "#1b1a2a" })
  if math.sin(S.sceneT * 4) > 0 then text("PRESS Z", W / 2, 118, "#ffffff", { align = "center", outline = "#1b1a2a" }) end
  text("ARROWS move   Z jump", W / 2, 160, "#1b1a2a", { align = "center" })
end

local function drawHud()
  spr("coin", 10, 6)
  text(`{S.got}/{S.total}`, 24, 8, "#ffffff", { outline = "#1b1a2a" })
  text(clock(), W - 8, 8, "#ffffff", { align = "right", outline = "#1b1a2a" })
  if S.scene == "clear" then
    local a = math.min(1, S.sceneT * 3)
    rect(0, H / 2 - 34, W, 62, alpha("#1b1a2a", a * 0.75))
    text("CLEAR!", W / 2, H / 2 - 26, "#ffe27a", { align = "center", scale = 3, outline = "#1b1a2a" })
    text(`COINS {S.got}/{S.total}    TIME {clock()}`, W / 2, H / 2 + 6, "#ffffff", { align = "center" })
    if S.sceneT > 1.5 then text("PRESS Z", W / 2, H / 2 + 18, "#a2f5c8", { align = "center" }) end
  end
end

function draw()
  world.drawSky()
  camera(math.floor(S.cam.x), math.floor(S.cam.y))
  objects.draw("back")
  world.drawTiles()
  objects.draw("front")
  player.draw()
  fx.draw()
  camera()
  if S.scene == "title" then drawTitle() else drawHud() end
end
