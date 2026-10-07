-- Shared game state. Every module that does require("game") gets this same table.
local G = {
  map = "level1",
  lives = 3,
  coins = 0,
  fx = Particles.new(),
}

function G.reset()
  G.lives, G.coins = 3, 0
  G.fx = Particles.new()
end

return G
