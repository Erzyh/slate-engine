-- Shared game state. Every module that does require("game") gets this same table.
local G = {
  lives = 3,
  score = 0,
  best = 0,
  time = 0, -- seconds survived; the waves get harder with it
  fx = Particles.new(),
  shots = {}, -- your bullets
  orbs = {}, -- enemy bullets
}

function G.reset()
  G.lives, G.score, G.time = 3, 0, 0
  G.fx = Particles.new()
  G.shots, G.orbs = {}, {}
  G.best = load("best", 0) -- save() / load() keep data between runs
end

function G.addScore(n)
  G.score += n
  if G.score > G.best then
    G.best = G.score
  end
end

return G
