-- The level: tile lookups, the sky / hills / clouds behind it, and the camera.

local C = require("config")
local S = require("state")

local world = {}

-- tile id at a pixel position (the map sides count as walls)
function world.tileAt(px, py)
  local tx, ty = math.floor(px / C.T), math.floor(py / C.T)
  if tx < 0 or tx >= S.mapW then return 0 end
  if ty < 0 then return -1 end
  return mget(C.MAP, tx, ty, "main")
end

function world.solid(px, py)
  return C.SOLID[world.tileAt(px, py)] == true
end

function world.load()
  local info = mapinfo(C.MAP)
  S.mapW, S.mapH = info.w, info.h * info.th
end

-- smooth follow with a little look-ahead
function world.updateCamera(dt)
  local P = S.player
  local tx = clamp(P.x - W / 2 + P.vx * 0.35, 0, S.mapW * C.T - W)
  local ty = clamp(P.y - H * 0.62, 0, S.mapH - H)
  S.cam.x = lerp(S.cam.x, tx, math.min(1, dt * 6))
  S.cam.y = lerp(S.cam.y, ty, math.min(1, dt * 4))
end

function world.drawSky()
  local top, bot = { 0x5a, 0x8c, 0xe0 }, { 0xc8, 0xe8, 0xff }
  for i = 0, 11 do
    local k = i / 11
    local c = string.format("#%02x%02x%02x", math.floor(lerp(top[1], bot[1], k)), math.floor(lerp(top[2], bot[2], k)), math.floor(lerp(top[3], bot[3], k)))
    rect(0, i * 15, W, 15, c)
  end
  -- clouds (slow parallax)
  for i = 0, 5 do
    local x = (i * 140 - S.cam.x * 0.15 + t() * 4) % (W + 200) - 100
    spr("cloud", x, 18 + (i * 37) % 50, { alpha = 0.95 })
  end
  -- far and near hills
  for i = -1, 8 do
    local x = i * 70 - (S.cam.x * 0.25) % 70
    circ(x, H + 15, 75, "#8cc3e6", true)
  end
  for i = -1, 7 do
    local x = i * 90 - (S.cam.x * 0.5) % 90 + 30
    circ(x, H + 40, 78, "#6fbf8a", true)
    circ(x + 45, H + 52, 70, "#5aa877", true)
  end
end

function world.drawTiles()
  map(C.MAP, 0, 0, { layer = "main" })
end

return world
