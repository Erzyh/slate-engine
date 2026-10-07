-- Everything placed on the map in the editor (Map tab > Objects): coins, beetles, springs,
-- the goal flag and decorations. objects("level1") gives their type, position and props.

local C = require("config")
local S = require("state")
local world = require("world")
local fx = require("fx")
local player = require("player")

local placed = objects   -- the engine's objects("map"), before the module table below takes the name
local objects = {}

local function overlap(o, w, h)
  local P = S.player
  return math.abs(P.x - o.x) < (w + 12) / 2 and math.abs((P.y - 6) - (o.y - h / 2)) < (h + 12) / 2
end

function objects.spawn()
  S.objs, S.total, S.got = {}, 0, 0
  S.player = nil
  for _, o in placed(C.MAP) do
    local b = { type = o.type, x = o.x, y = o.y, t = rnd(0, 6), alive = true, sq = 0, sqv = 0 }
    if o.type == "coin" then S.total += 1 end
    if o.type == "beetle" then
      b.vx = -28
      -- a real frame animation: the "walk" tag of the spiky sprite (2 frames, set up in the Pixel tab)
      b.anim = Anim.new("spiky", "walk")
      b.anim.t = rnd(0, 0.2)
    end
    if o.type == "start" then player.spawn(o.x, o.y) end
    table.insert(S.objs, b)
  end
  if not S.player then player.spawn(40, 9 * C.T) end
end

local function win()
  S.scene, S.sceneT = "clear", 0
  local P = S.player
  for _ = 1, 60 do
    fx.burst(P.x, P.y - 20, 1, { "#ff7aa8", "#ffe27a", "#4fd3a5", "#8ea3c6", "#ffffff" }, { speed = 220, gravity = 260, life = 2 })
  end
  sfx("powerup")
end

function objects.update(dt)
  local P = S.player
  for _, o in S.objs do
    o.t += dt
    o.sqv += (-o.sq * 300 - o.sqv * 10) * dt
    o.sq += o.sqv * dt
    if not o.alive then continue end
    if o.type == "coin" then
      if not P.dead and overlap(o, 8, 10) then
        o.alive = false
        S.got += 1
        fx.burst(o.x, o.y - 6, 10, { "#ffe27a", "#f0a63a", "#ffffff" }, { speed = 70, gravity = 60 })
        sfx("coin")
      end
    elseif o.type == "beetle" then
      o.anim:update(dt)
      -- walk; turn at walls and ledges
      local ahead = o.x + (if o.vx > 0 then 8 else -8)
      if world.solid(ahead, o.y - 6) or not (world.solid(ahead, o.y + 2) or world.tileAt(ahead, o.y + 2) == C.PLATFORM) then o.vx = -o.vx end
      o.x += o.vx * dt
      if not P.dead and overlap(o, 14, 12) then
        if P.vy > 40 and P.y < o.y - 6 then
          o.alive, o.squashT = false, 0.5
          P.vy, P.cut = -250, false
          player.wobble(-3)
          fx.burst(o.x, o.y - 6, 14, { "#d4435b", "#ff8f8f", "#6e1d3a" }, { speed = 100 })
          sfx("hit")
        elseif P.inv <= 0 then
          player.hurt()
        end
      end
    elseif o.type == "spring" then
      -- landing on it or just walking onto it both bounce (no way to get stuck in front of a wall)
      if not P.dead and P.vy >= 0 and overlap(o, 14, 8) and P.y <= o.y + 0.5 then
        P.vy, P.cut, P.ground, P.coyote, P.buffer = -C.SPRING, false, false, 0, 0   -- airborne now: no jump can override it
        P.y = o.y - 10
        player.wobble(-5)
        o.sqv += 9
        fx.burst(o.x, o.y - 10, 8, { "#ff8f8f", "#ffffff" }, { speed = 90, gravity = 200 })
        beep(220, 0.25, "square", 0.3, 3)
      end
    elseif o.type == "flag" then
      if S.scene == "play" and not P.dead and math.abs(P.x - o.x) < 10 and P.y > o.y - 40 then win() end
    end
  end
end

-- layer "back" = decorations behind the tiles, "front" = things you touch
function objects.draw(layer)
  local tt = t()
  for _, o in S.objs do
    local ty = o.type
    if layer == "back" then
      if ty == "bush" then spr("bush", o.x, o.y, { ox = 0.5, oy = 1, sx = 1 + math.sin(tt * 2 + o.t) * 0.03 }) end
      if ty == "flower" then spr("flower", o.x, o.y, { ox = 0.5, oy = 1, rot = math.sin(tt * 2.5 + o.t) * 0.15 }) end
      if ty == "flag" then spr("flag", o.x - 5, o.y, { ox = 0.5, oy = 1, sx = 1 + math.sin(tt * 6) * 0.04 }) end
    elseif ty == "coin" and o.alive then
      -- spin = horizontal scale; bob = sine
      spr("coin", o.x, o.y - 3 + math.sin(tt * 3 + o.t) * 2, { ox = 0.5, oy = 1, sx = math.max(0.15, math.abs(math.cos(tt * 3.5 + o.t))) })
    elseif ty == "beetle" then
      if o.alive then
        o.anim:draw(o.x, o.y, { ox = 0.5, oy = 1, flipX = o.vx > 0 })
      elseif o.squashT and o.squashT > 0 then
        o.squashT -= 1 / 60
        spr("spiky", o.x, o.y, { ox = 0.5, oy = 1, sy = 0.25, sx = 1.4, alpha = o.squashT * 2 })
      end
    elseif ty == "spring" then
      spr("spring", o.x, o.y, { ox = 0.5, oy = 1, sx = 1 + o.sq * 0.08, sy = 1 - o.sq * 0.08 })
    end
  end
end

return objects
