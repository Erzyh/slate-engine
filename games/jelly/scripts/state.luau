-- The game's shared state. require() runs a script once, so every script that does
-- local S = require("state") gets this same table.

return {
  scene = "title",       -- title / play / clear
  sceneT = 0,            -- seconds in the current scene
  timer = 0,             -- play time of this run

  player = nil,          -- set by player.spawn()
  objs = {},             -- coins, beetles, springs... (objects.luau)
  parts = {},            -- particles (fx.luau)
  cam = { x = 0, y = 0 },
  mapW = 0,              -- in tiles
  mapH = 0,              -- in pixels

  got = 0,
  total = 0,
  deaths = 0,

  jellySprite = "jelly",
}
