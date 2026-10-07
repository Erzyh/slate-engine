-- Shared game state. Every module that does require("game") gets this same table.
local G = {
  map = "room",
  lives = 3,
  gems = 0,
  totalGems = 0,
  fx = Particles.new(),
}

function G.reset()
  G.lives, G.gems = 3, 0
  G.totalGems = #objects(G.map, "gem")
  G.fx = Particles.new()
end

return G
