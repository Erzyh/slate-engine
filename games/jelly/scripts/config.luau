-- Tuning values and tile ids, shared by every script: local C = require("config")

return {
  MAP = "level1",
  T = 16,                -- tile size in pixels
  DEV = true,            -- F2: jump to the flag, F8: autopilot

  -- tile ids (frames of the "tiles" sprite)
  SOLID = { [0] = true, [1] = true, [2] = true, [3] = true, [4] = true, [6] = true },
  PLATFORM = 5,          -- one-way: you can jump up through it
  SPIKES = 7,

  -- physics (pixels / second)
  GRAV = 900,
  RUN = 110,
  ACCEL = 1000,
  JUMP = 300,
  SPRING = 480,
}
