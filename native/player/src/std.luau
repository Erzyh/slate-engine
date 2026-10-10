-- Slate standard library: loaded before your scripts, available everywhere.

-- ------------------------------------------------------------------ Anim
-- Frame animation for a sprite, following its tags and per-frame durations from the editor.
--
--   local hero = Anim.new("hero", "idle")
--   hero:play("run")                                   -- switches only if it is a different tag
--   hero:play("attack", { loop = false, onEnd = function() hero:play("idle") end })
--   hero:update(dt)
--   hero:draw(x, y, { flipX = facing < 0 })
--   hero.frame, hero.tag, hero.done, hero.speed

local Anim_ = {}
Anim = Anim_
Anim_.__index = Anim_

local function frameList(info, tagName)
  local from, to, dir = 0, info.frames - 1, "forward"
  if tagName ~= nil then
    local tg = info.tags[tagName]
    if tg == nil then error(`Anim: sprite has no tag "{tagName}"`, 3) end
    from, to, dir = tg.from, tg.to, tg.dir
  end
  local list = {}
  if dir == "reverse" then
    for f = to, from, -1 do table.insert(list, f) end
  else
    for f = from, to do table.insert(list, f) end
    if dir == "pingpong" then
      for f = to - 1, from + 1, -1 do table.insert(list, f) end
    end
  end
  return list
end

function Anim_.new(name, tag)
  local info = sprite(name)
  if info == nil then error(`Anim.new: no sprite named "{name}"`, 2) end
  local a = setmetatable({ name = name, info = info, speed = 1 }, Anim_)
  a:play(tag, { restart = true })
  return a
end

function Anim_:play(tag, o)
  o = o or {}
  if tag == self.tag and not o.restart and self.list ~= nil then return self end
  self.tag = tag
  self.list = frameList(self.info, tag)
  self.i, self.t, self.done = 1, 0, false
  self.loop = o.loop ~= false
  self.onEnd = o.onEnd
  self.frame = self.list[1]
  return self
end

-- seconds the given frame stays on screen
function Anim_:duration(f)
  local d = self.info.durations[f + 1]
  if d ~= nil and d > 0 then return d / 1000 end
  return 1 / math.max(1, self.info.fps)
end

function Anim_:update(dt)
  if self.done then return end
  self.t += dt * self.speed
  local guard = 0
  while self.t >= self:duration(self.list[self.i]) and guard < 64 do
    guard += 1
    self.t -= self:duration(self.list[self.i])
    self.i += 1
    if self.i > #self.list then
      if self.loop then
        self.i = 1
      else
        self.i, self.t, self.done = #self.list, 0, true
        self.frame = self.list[self.i]
        if self.onEnd then self.onEnd(self) end
        return
      end
    end
  end
  self.frame = self.list[self.i]
end

function Anim_:draw(x, y, o)
  local p = if o then table.clone(o) else {}
  p.frame = self.frame
  spr(self.name, x, y, p)
end

-- ------------------------------------------------------------------ Ease
-- Easing curves for Tween (or your own math): Ease.outCubic(0..1) -> 0..1

local Ease_ = {}
Ease = Ease_
function Ease_.linear(t) return t end
function Ease_.inQuad(t) return t * t end
function Ease_.outQuad(t) return 1 - (1 - t) * (1 - t) end
function Ease_.inOutQuad(t) return if t < 0.5 then 2 * t * t else 1 - (-2 * t + 2) ^ 2 / 2 end
function Ease_.inCubic(t) return t * t * t end
function Ease_.outCubic(t) return 1 - (1 - t) ^ 3 end
function Ease_.inOutCubic(t) return if t < 0.5 then 4 * t * t * t else 1 - (-2 * t + 2) ^ 3 / 2 end
function Ease_.inSine(t) return 1 - math.cos(t * math.pi / 2) end
function Ease_.outSine(t) return math.sin(t * math.pi / 2) end
function Ease_.inOutSine(t) return -(math.cos(math.pi * t) - 1) / 2 end
function Ease_.inBack(t) return 2.70158 * t * t * t - 1.70158 * t * t end
function Ease_.outBack(t) return 1 + 2.70158 * (t - 1) ^ 3 + 1.70158 * (t - 1) ^ 2 end
function Ease_.outElastic(t)
  if t <= 0 or t >= 1 then return t end
  return 2 ^ (-10 * t) * math.sin((t * 10 - 0.75) * (2 * math.pi / 3)) + 1
end
function Ease_.outBounce(t)
  local n, d = 7.5625, 2.75
  if t < 1 / d then return n * t * t end
  if t < 2 / d then t -= 1.5 / d return n * t * t + 0.75 end
  if t < 2.5 / d then t -= 2.25 / d return n * t * t + 0.9375 end
  t -= 2.625 / d
  return n * t * t + 0.984375
end

-- ------------------------------------------------------------------ Timer
-- Run code later or repeatedly. Ticks by itself (before your update).
--
--   Timer.after(2, function() spawnBoss() end)
--   local h = Timer.every(0.5, function() fire() end)      -- return false from it to stop
--   Timer.every(0.1, blink, 6)                             -- 6 times
--   Timer.cancel(h)

local Timer_ = { list = {} }
Timer = Timer_

function Timer_.after(sec, fn)
  local h = { t = sec, fn = fn }
  table.insert(Timer_.list, h)
  return h
end

function Timer_.every(sec, fn, count)
  local h = { t = sec, every = sec, fn = fn, count = count }
  table.insert(Timer_.list, h)
  return h
end

function Timer_.cancel(h)
  if h then h.dead = true end
end

function Timer_.clear()
  for _, h in Timer_.list do h.dead = true end
  Timer_.list = {}
end

function Timer_.update(dt)
  local list = Timer_.list
  Timer_.list = {}
  for _, h in list do
    if not h.dead then
      h.t -= dt
      if h.t <= 0 then
        local stop = h.fn() == false
        if h.every and not stop then
          h.t += h.every
          if h.count then
            h.count -= 1
            if h.count <= 0 then h.dead = true end
          end
        else
          h.dead = true
        end
      end
      if not h.dead then table.insert(Timer_.list, h) end
    end
  end
end

-- ------------------------------------------------------------------ Tween
-- Animate numbers in a table over time. Ticks by itself.
--
--   Tween.to(box, 0.4, { y = 20, alpha = 1 }, { ease = "outBack", delay = 0.1, onDone = function() ... end })
--   Tween.cancelAll(box)

local Tween_ = { list = {} }
Tween = Tween_

function Tween_.to(obj, sec, target, o)
  o = o or {}
  local ease = o.ease or "outQuad"
  if type(ease) == "string" then
    local fn = Ease_[ease]
    if fn == nil then error(`Tween: no easing "{ease}"`, 2) end
    ease = fn
  end
  local tw = { obj = obj, dur = math.max(sec, 1e-6), t = -(o.delay or 0), to = target, ease = ease, onDone = o.onDone, onUpdate = o.onUpdate }
  table.insert(Tween_.list, tw)
  return tw
end

function Tween_.cancel(tw)
  if tw then tw.dead = true end
end

function Tween_.cancelAll(obj)
  for _, tw in Tween_.list do
    if obj == nil or tw.obj == obj then tw.dead = true end
  end
end

function Tween_.update(dt)
  local list = Tween_.list
  Tween_.list = {}
  for _, tw in list do
    if not tw.dead then
      tw.t += dt
      if tw.t >= 0 then
        if tw.from == nil then
          tw.from = {}
          for k in tw.to do tw.from[k] = tw.obj[k] or 0 end
        end
        local k = math.min(1, tw.t / tw.dur)
        local e = tw.ease(k)
        for key, v in tw.to do tw.obj[key] = tw.from[key] + (v - tw.from[key]) * e end
        if tw.onUpdate then tw.onUpdate(tw.obj, k) end
        if k >= 1 then
          tw.dead = true
          if tw.onDone then tw.onDone(tw.obj) end
        end
      end
      if not tw.dead then table.insert(Tween_.list, tw) end
    end
  end
end

-- ------------------------------------------------------------------ Scene
-- Screens of the game (title, play, game over...). If you don't write update/draw yourself,
-- the current scene's run automatically.
--
--   Scene.add("title", { enter = function(args) end, update = function(dt) end, draw = function() end, leave = function() end })
--   Scene.go("play", { level = 1 })                    -- fades through black (fade = seconds, 0 = cut)
--   Scene.go("over", nil, { fade = 0.5, color = "#ffffff" })
--   Scene.name                                          -- current scene's name

local Scene_ = { list = {}, current = nil, name = nil, fade = 0, dir = 0, fadeTime = 0.25, color = "#000000" }
Scene = Scene_

function Scene_.add(name, s)
  Scene_.list[name] = s
  return s
end

local function switch(name, args)
  local cur = Scene_.current
  if cur and cur.leave then cur.leave() end
  Scene_.current, Scene_.name = Scene_.list[name], name
  if Scene_.current.enter then Scene_.current.enter(args) end
end

function Scene_.go(name, args, o)
  if Scene_.list[name] == nil then error(`Scene.go: no scene "{name}" (Scene.add it first)`, 2) end
  o = o or {}
  local fade = o.fade or (if Scene_.current then 0.25 else 0)
  if fade <= 0 then
    switch(name, args)
    return
  end
  Scene_.nextName, Scene_.nextArgs, Scene_.fadeTime, Scene_.color, Scene_.dir = name, args, fade, o.color or "#000000", 1
end

function Scene_.update(dt)
  if Scene_.dir > 0 then
    Scene_.fade = math.min(1, Scene_.fade + dt / Scene_.fadeTime)
    if Scene_.fade >= 1 then
      switch(Scene_.nextName, Scene_.nextArgs)
      Scene_.dir = -1
    end
  elseif Scene_.dir < 0 then
    Scene_.fade = math.max(0, Scene_.fade - dt / Scene_.fadeTime)
    if Scene_.fade <= 0 then Scene_.dir = 0 end
  end
  local cur = Scene_.current
  if cur and cur.update and Scene_.dir <= 0 then cur.update(dt) end
end

function Scene_.draw()
  local cur = Scene_.current
  if cur and cur.draw then cur.draw() end
  if Scene_.fade > 0 then
    camera()
    rect(0, 0, W, H, Scene_.color:sub(1, 7) .. string.format("%02x", math.floor(Scene_.fade * 255)))
  end
end

function update(dt) Scene_.update(dt) end
function draw() Scene_.draw() end

-- ------------------------------------------------------------------ Cam
-- A camera that follows, stays inside the level and shakes.
--
--   Cam.follow(player.x, player.y, dt, { lerp = 8, bounds = "level1" })   -- or bounds = { x0, y0, x1, y1 }
--   Cam.shake(4, 0.3)
--   Cam.apply()  ... draw the world ...  Cam.reset()   -- then draw the HUD

local Cam_ = { x = 0, y = 0, ox = 0, oy = 0, shakeAmt = 0, shakeT = 0, bounds = nil }
Cam = Cam_

function Cam_.follow(tx, ty, dt, o)
  o = o or {}
  local gx, gy = tx - W / 2 + (o.lookX or 0), ty - H / 2 + (o.lookY or 0)
  local b = o.bounds or Cam_.bounds
  if type(b) == "string" then
    local mi = mapinfo(b)
    b = { 0, 0, mi.w * mi.tw, mi.h * mi.th }
  end
  if b then
    gx = clamp(gx, b[1], math.max(b[1], b[3] - W))
    gy = clamp(gy, b[2], math.max(b[2], b[4] - H))
  end
  local k = if o.lerp == 0 or o.lerp == false then 1 else math.min(1, dt * (o.lerp or 8))
  Cam_.x += (gx - Cam_.x) * k
  Cam_.y += (gy - Cam_.y) * k
end

function Cam_.shake(amount, time)
  Cam_.shakeAmt = math.max(Cam_.shakeAmt, amount)
  Cam_.shakeT = math.max(Cam_.shakeT, time or 0.3)
end

function Cam_.update(dt)
  if Cam_.shakeT > 0 then
    Cam_.shakeT -= dt
    local a = Cam_.shakeAmt * math.min(1, Cam_.shakeT * 5)
    Cam_.ox, Cam_.oy = rnd(-a, a), rnd(-a, a)
    if Cam_.shakeT <= 0 then Cam_.shakeAmt, Cam_.ox, Cam_.oy = 0, 0, 0 end
  end
end

function Cam_.apply() camera(math.floor(Cam_.x + Cam_.ox), math.floor(Cam_.y + Cam_.oy)) end
function Cam_.reset() camera() end
function Cam_.toWorld(sx, sy) return sx + Cam_.x, sy + Cam_.y end

-- ------------------------------------------------------------------ Debug (editor Game view)
-- With "Hitboxes" on in the Game view, every box that went through Physics is outlined, and the
-- solid tiles of the maps it moved on are shaded. Nothing here runs when it is off.

local Debug_ = { on = false, bodies = setmetatable({}, { __mode = "k" }), maps = {} }

function Debug_.track(b, map)
  if type(b) ~= "table" or b.w == nil then return end
  Debug_.bodies[b] = t()
  if map then Debug_.maps[map] = true end
end

function Debug_.draw()
  camera(math.floor(Cam_.x + Cam_.ox), math.floor(Cam_.y + Cam_.oy))
  for map in Debug_.maps do
    local mi = mapinfo(map)
    if mi and mi.tw > 0 then
      local x0, y0 = math.max(0, math.floor(Cam_.x / mi.tw)), math.max(0, math.floor(Cam_.y / mi.th))
      for ty = y0, math.min(mi.h - 1, y0 + math.ceil(H / mi.th)) do
        for tx = x0, math.min(mi.w - 1, x0 + math.ceil(W / mi.tw)) do
          if msolid(map, tx * mi.tw, ty * mi.th, 0) then rect(tx * mi.tw, ty * mi.th, mi.tw, mi.th, "#ff4d6d40") end
        end
      end
    end
  end
  local now = t()
  for b, seen in Debug_.bodies do
    if now - seen < 0.5 and b.x and b.y then rectline(b.x, b.y, b.w, b.h, "#7cff6b") end
  end
  camera()
end

-- ------------------------------------------------------------------ Physics
-- Move boxes through a tile map without going into walls (tile flags from the tileset:
-- bit 0 = solid by default; a "oneway" bit makes jump-through platforms).
--
--   local body = { x = 40, y = 20, w = 10, h = 14, vx = 0, vy = 0 }     -- x, y = top-left
--   local hit = Physics.move(body, body.vx * dt, body.vy * dt, "level1", { oneway = 1 })
--   if hit.down then body.vy = 0 end          -- hit.left / right / up / down
--   Physics.grounded(body, "level1", { oneway = 1 })
--   Physics.overlap(a, b)                     -- two boxes touch?

local Physics_ = {}
Physics = Physics_

-- points along an edge, at least one per tile so nothing slips through
local function edge(from, len, tile)
  local pts = { from, from + len - 0.01 }
  local p = from + tile
  while p < from + len - 0.01 do
    table.insert(pts, p)
    p += tile
  end
  return pts
end

function Physics_.move(b, dx, dy, map, o)
  if Debug_.on then Debug_.track(b, map) end
  o = o or {}
  local bit, oneway = o.solid or 0, o.oneway
  local mi = mapinfo(map)
  if mi == nil then error(`Physics.move: no map "{map}"`, 2) end
  local tw, th = mi.tw, mi.th
  local hit = { left = false, right = false, up = false, down = false }
  -- x, in steps of at most half a tile
  local n = math.max(1, math.ceil(math.abs(dx) / (tw / 2)))
  for _ = 1, n do
    local sx = dx / n
    if sx == 0 then break end
    local nx = b.x + sx
    local ex = if sx > 0 then nx + b.w - 0.01 else nx
    local wall = false
    for _, py in edge(b.y, b.h, th) do
      if msolid(map, ex, py, bit) then
        wall = true
        break
      end
    end
    if wall then
      if sx > 0 then
        b.x = math.floor(ex / tw) * tw - b.w
        hit.right = true
      else
        b.x = (math.floor(ex / tw) + 1) * tw
        hit.left = true
      end
      break
    end
    b.x = nx
  end
  -- y
  n = math.max(1, math.ceil(math.abs(dy) / (th / 2)))
  for _ = 1, n do
    local sy = dy / n
    if sy == 0 then break end
    local ny = b.y + sy
    local ey = if sy > 0 then ny + b.h - 0.01 else ny
    local wall = false
    for _, px in edge(b.x, b.w, tw) do
      if msolid(map, px, ey, bit) then
        wall = true
        break
      end
      -- jump-through platforms only stop you from above
      if oneway ~= nil and sy > 0 and msolid(map, px, ey, oneway) then
        local top = math.floor(ey / th) * th
        if b.y + b.h <= top + 0.01 then
          wall = true
          break
        end
      end
    end
    if wall then
      if sy > 0 then
        b.y = math.floor(ey / th) * th - b.h
        hit.down = true
      else
        b.y = (math.floor(ey / th) + 1) * th
        hit.up = true
      end
      break
    end
    b.y = ny
  end
  return hit
end

-- standing on something? (solid, or a jump-through platform)
function Physics_.grounded(b, map, o)
  if Debug_.on then Debug_.track(b, map) end
  o = o or {}
  for _, px in edge(b.x, b.w, mapinfo(map).tw) do
    if msolid(map, px, b.y + b.h + 0.5, o.solid or 0) or (o.oneway and msolid(map, px, b.y + b.h + 0.5, o.oneway)) then return true end
  end
  return false
end

function Physics_.overlap(a, b)
  if Debug_.on then
    Debug_.track(a)
    Debug_.track(b)
  end
  return a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h
end

-- ------------------------------------------------------------------ live scripts
-- A script starting with `--!live` is patched into the running game when it changes (the engine runs it
-- again and merges what it returns into the old table): edit numbers and see them at once.
function __slate_merge(old, new)
  for k, v in new do
    if type(v) == "table" and type(old[k]) == "table" and getmetatable(v) == nil then
      __slate_merge(old[k], v)
    else
      old[k] = v
    end
  end
end

-- ------------------------------------------------------------------ Particles
--
--   local fx = Particles.new()
--   fx:burst(x, y, 20, { colors = { "#ffcc4d", "#ffffff" }, speed = 120, gravity = 300, life = 0.6, size = 2 })
--   fx:burst(x, y, "explosion")       -- a preset made in the particle editor (Project -> Particles)
--   fx:emit(x, y, "smoke", dt)        -- keep emitting (preset's rate per second), e.g. a torch
--   fx:update(dt)     fx:draw()     (draw inside Cam.apply() for world particles)

local Particles_ = {}
Particles = Particles_
Particles_.__index = Particles_

function Particles_.new()
  return setmetatable({ list = {}, acc = {} }, Particles_)
end

-- the options of a preset from the particle editor
function Particles_.preset(name)
  local o = __particle_preset(name)
  if o == nil then error(`Particles: no preset "{name}" (make it in Project -> Particles)`, 3) end
  return o
end

-- burst(x, y, n, opts) / burst(x, y, "preset", extra opts?) / burst(x, y, opts)
function Particles_:burst(x, y, n, o)
  if type(n) == "string" then
    local p = Particles_.preset(n)
    if o then
      p = table.clone(p)
      for k, v in o do p[k] = v end
    end
    o, n = p, p.count or 20
  elseif type(n) == "table" then
    o, n = n, n.count or 20
  end
  o = o or {}
  local colors = o.colors or { o.color or "#ffffff" }
  local r = o.radius or 0
  for _ = 1, n do
    local a = (o.angle or -math.pi / 2) + rnd(-(o.spread or math.pi), o.spread or math.pi)
    local v = rnd(0.3, 1) * (o.speed or 80)
    local life = rnd(0.5, 1) * (o.life or 0.6)
    local ra, rr = rnd(0, math.pi * 2), math.sqrt(rnd()) * r
    table.insert(self.list, {
      x = x + math.cos(ra) * rr, y = y + math.sin(ra) * rr, vx = math.cos(a) * v, vy = math.sin(a) * v, g = o.gravity or 0, drag = o.drag or 0,
      life = life, max = life, c = colors[irnd(1, #colors)], s = o.size or 1, shrink = o.shrink ~= false, add = o.add,
    })
  end
end

-- keep emitting at (x, y): call every frame with dt; rate = particles per second (opts.rate)
function Particles_:emit(x, y, o, dt)
  local key = o
  if type(o) == "string" then o = Particles_.preset(o) end
  local rate = o.rate or 20
  self.acc[key] = (self.acc[key] or 0) + rate * (dt or 1 / 60)
  local n = math.floor(self.acc[key])
  if n > 0 then
    self.acc[key] -= n
    local one = table.clone(o)
    one.count = n
    self:burst(x, y, one)
  end
end

function Particles_:update(dt)
  local alive = {}
  for _, p in self.list do
    p.life -= dt
    if p.life > 0 then
      p.vy += p.g * dt
      local k = 1 - p.drag * dt
      p.vx *= k
      p.vy *= k
      p.x += p.vx * dt
      p.y += p.vy * dt
      table.insert(alive, p)
    end
  end
  self.list = alive
end

function Particles_:draw()
  for _, p in self.list do
    local s = if p.shrink then math.max(1, math.ceil(p.s * p.life / p.max)) else p.s
    if p.add then blend("add") end
    rect(p.x - s / 2, p.y - s / 2, s, s, p.c)
    if p.add then blend() end
  end
end

function Particles_:count()
  return #self.list
end

-- ------------------------------------------------------------------ Text
-- Animated text, with effects for the whole string or marked up inside it:
--
--   Text.draw("GAME OVER", W / 2, 40, "#ffffff", { align = "center", wave = 2 })
--   Text.draw("{shake}무서워!{/} 그리고 {rainbow}무지개{/}", 8, 8, "#fff")
--   local done = Text.draw(story, 8, 60, "#fff", { typing = 30, start = shownAt })  -- typewriter
--
-- Markup: {wave} {shake} {rainbow} {blink} {bounce} {#ff0000} {color=#ff0000}, closed by {/}.
-- A number sets the strength: {wave=4} {shake=2} {rainbow=3}. Dialog text understands it too.

local Text_ = { cache = {}, cached = 0 }
Text = Text_

local EFFECTS = { wave = true, shake = true, rainbow = true, blink = true, bounce = true }

-- "{wave}hi{/}" -> { { ch = "h", fx = { wave = true } }, ... }
function Text_.parse(str)
  str = tostring(str)
  local hit = Text_.cache[str]
  if hit then return hit end
  local out, stack = {}, { {} }
  local skip = 0
  for pos, code in utf8.codes(str) do
    if pos < skip then continue end
    if code == 123 then -- "{"
      local close = string.find(str, "}", pos, true)
      local tag = close and string.sub(str, pos + 1, close - 1)
      if tag then
        local top = stack[#stack]
        local name, val = string.match(tag, "^(%w+)=?(.*)$")
        if tag == "/" or string.sub(tag, 1, 1) == "/" then
          if #stack > 1 then table.remove(stack) end
          skip = close + 1
          continue
        elseif string.sub(tag, 1, 1) == "#" or name == "color" then
          local fx = table.clone(top)
          fx.color = if name == "color" then val else tag
          table.insert(stack, fx)
          skip = close + 1
          continue
        elseif name and EFFECTS[name] then
          local fx = table.clone(top)
          fx[name] = tonumber(val) or true
          table.insert(stack, fx)
          skip = close + 1
          continue
        end
      end
    end
    local top = stack[#stack]
    table.insert(out, { ch = utf8.char(code), fx = if next(top) then top else nil })
  end
  -- keep the cache small (dialog lines, HUD strings...)
  Text_.cached += 1
  if Text_.cached > 512 then Text_.cache, Text_.cached = {}, 0 end
  Text_.cache[str] = out
  return out
end

-- the text without markup
function Text_.strip(str)
  local b = {}
  for _, c in Text_.parse(str) do table.insert(b, c.ch) end
  return table.concat(b)
end

function Text_.len(str) return #Text_.parse(str) end

local function hsv(h)
  local i = math.floor(h * 6) % 6
  local f = h * 6 - math.floor(h * 6)
  local q, u = 1 - f, f
  local r, g, b
  if i == 0 then r, g, b = 1, u, 0
  elseif i == 1 then r, g, b = q, 1, 0
  elseif i == 2 then r, g, b = 0, 1, u
  elseif i == 3 then r, g, b = 0, q, 1
  elseif i == 4 then r, g, b = u, 0, 1
  else r, g, b = 1, 0, q end
  return string.format("#%02x%02x%02x", math.floor(r * 255), math.floor(g * 255), math.floor(b * 255))
end

-- stable jitter for shaking letters (changes 30 times a second)
local function jitter(i, k)
  local v = math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return (v - math.floor(v)) * 2 - 1
end

-- how far the pen moves after a letter: its width plus the gap before the next one
local advances = {}
local function advance(ch, scale, font)
  local key = ch .. "|" .. scale .. "|" .. (font or "")
  local a = advances[key]
  if a == nil then
    a = textw(ch .. ch, scale, font) - textw(ch, scale, font)
    advances[key] = a
  end
  return a
end

function Text_.width(str, o)
  o = o or {}
  local chars = Text_.parse(str)
  local w = 0
  for i, c in chars do w += if i == #chars then textw(c.ch, o.scale or 1, o.font) else advance(c.ch, o.scale or 1, o.font) end
  return w
end

-- draw parsed characters; `count` limits how many show (typewriter). Returns the width drawn.
function Text_.drawChars(chars, x, y, color, o, count)
  o = o or {}
  local now = t()
  local k = math.floor(now * 30)
  local scale, font = o.scale or 1, o.font
  local n = math.min(#chars, count or #chars)
  local cx = x
  if o.align == "center" or o.align == "right" then
    local w = 0
    for i = 1, #chars do w += if i == #chars then textw(chars[i].ch, scale, font) else advance(chars[i].ch, scale, font) end
    cx -= if o.align == "center" then math.floor(w / 2) else w
  end
  local x0 = cx
  -- a line with Hangul: the classic letters drop to share its baseline (as text() does)
  local drop = 0
  for i = 1, #chars do
    if string.byte(chars[i].ch, 1) > 127 then
      drop = __textdrop(font) * scale
      break
    end
  end
  for i = 1, n do
    local c = chars[i]
    local fx = c.fx
    local wave = (fx and fx.wave) or o.wave
    local shake = (fx and fx.shake) or o.shake
    local rainbow = (fx and fx.rainbow) or o.rainbow
    local blink = (fx and fx.blink) or o.blink
    local bounce = (fx and fx.bounce) or o.bounce
    local dx, dy = 0, 0
    if wave then dy += math.sin(now * 8 - i * 0.6) * (if wave == true then 2 else wave) * scale end
    if bounce then dy -= math.abs(math.sin(now * 6 - i * 0.4)) * (if bounce == true then 3 else bounce) * scale end
    if shake then
      local a = (if shake == true then 1 else shake) * scale
      dx += jitter(i, k) * a
      dy += jitter(i + 97, k) * a
    end
    -- letters typed just now rise into place
    if o.typing and o.pop ~= false then
      local age = now - (o.start or 0) - i / o.typing
      if age < 0.12 then dy += (1 - math.max(0, age) / 0.12) * 3 * scale end
    end
    local col = (fx and fx.color) or color
    if rainbow then col = hsv((now * 0.5 * (if rainbow == true then 1 else rainbow) + i * 0.07) % 1) end
    local w = advance(c.ch, scale, font)
    if not (blink and math.floor(now * 3) % 2 == 0) and c.ch ~= " " then
      local cd = if string.byte(c.ch, 1) > 127 then 0 else drop
      text(c.ch, math.floor(cx + dx + 0.5), math.floor(y + dy + cd + 0.5), col, { scale = scale, font = font, outline = o.outline })
    end
    cx += w
  end
  return cx - x0
end

-- Draw a string with effects. With { typing = chars per second, start = t() when it began }
-- it types itself out; returns true once all of it shows.
function Text_.draw(str, x, y, color, o)
  o = o or {}
  local chars = Text_.parse(str)
  local count = #chars
  if o.typing then count = math.max(0, math.floor((t() - (o.start or 0)) * o.typing)) end
  Text_.drawChars(chars, x, y, color, o, count)
  return count >= #chars
end

-- ------------------------------------------------------------------ Dialog
-- Dialog boxes: typewriter text, speaker name, portrait, choices. Text wraps at spaces to fit the
-- box (Korean too), and long text continues on the next page.
--
--   Dialog.say("오랜만이야! 마을에 온 걸 환영해.", { name = "촌장", portrait = "elder" })
--   Dialog.say({ "첫 페이지", "두 번째 페이지" }, { onDone = function() ... end })
--   Dialog.ask("문을 열까?", { "연다", "그냥 둔다" }, function(choice) ... end)
--   if Dialog.active() then return end    -- in update: the game waits while someone talks
--   Dialog.draw()                         -- last in draw (it draws in screen space, over the HUD)
--   Dialog.style.speed = 60               -- colors, font, lines, speed, sound: see Dialog.style
-- Z / Space / pad A / click: show the whole page, then the next. Up / down (or the mouse): pick a choice.

local Dialog_ = {
  queue = {},
  style = {
    font = "erx", lines = 3, speed = 40, margin = 4, padding = 6,
    bg = "#1a1c2cf0", border = "#f4f4f4", text = "#f4f4f4", name = "#ffcd75", nameBg = "#333c57",
    choice = "#ffcd75", dim = "#94b0c2", sound = "click", soundVolume = 0.12,
  },
}
Dialog = Dialog_
local dlg = nil -- the dialog on screen
local tickN, closedAt = 0, -1

local function boxRect()
  local s = Dialog_.style
  local lh = texth(1, s.font)
  local h = s.lines * lh + s.padding * 2 - 1
  return s.margin, H - s.margin - h, W - s.margin * 2, h, lh
end

local function pageLen(page)
  local n = 0
  for _, l in page do n += utf8.len(l) or #l end
  return n
end

local function startDialog(entry)
  local s = Dialog_.style
  local _, _, w = boxRect()
  local portraitW = 0
  if entry.portrait then
    local info = sprite(entry.portrait)
    if info == nil then error(`Dialog: no sprite "{entry.portrait}" for the portrait`, 3) end
    portraitW = info.w + s.padding
  end
  local pages, styled = {}, {}
  for _, p in entry.pages do
    -- wrap the text without markup, then give every line its own styled characters back
    local chars = Text_.parse(p)
    local plain = {}
    for _, c in chars do table.insert(plain, c.ch) end
    local lines = wrap(table.concat(plain), w - s.padding * 2 - portraitW, 1, s.font)
    local ci, lineChars = 1, {}
    for li, line in lines do
      local list = {}
      for _, code in utf8.codes(line) do
        local ch = utf8.char(code)
        -- skip what wrapping dropped (spaces and line breaks at the ends of lines)
        while chars[ci] and chars[ci].ch ~= ch do ci += 1 end
        table.insert(list, chars[ci] or { ch = ch })
        ci += 1
      end
      lineChars[li] = list
    end
    for i = 1, #lines, s.lines do
      table.insert(pages, { table.unpack(lines, i, math.min(#lines, i + s.lines - 1)) })
      table.insert(styled, { table.unpack(lineChars, i, math.min(#lines, i + s.lines - 1)) })
    end
  end
  if #pages == 0 then pages, styled = { { "" } }, { { {} } } end
  dlg = { entry = entry, pages = pages, styled = styled, page = 1, shown = 0, choice = 1, portraitW = portraitW, rects = {} }
end

local function nextInQueue()
  if dlg == nil and #Dialog_.queue > 0 then startDialog(table.remove(Dialog_.queue, 1)) end
end

local function finish(choice)
  local e = dlg.entry
  dlg = nil
  closedAt = tickN
  if e.onChoose then e.onChoose(choice) end
  if e.onDone then e.onDone(choice) end
  nextInQueue()
end

function Dialog_.say(text, o)
  o = o or {}
  local pages = if type(text) == "table" then text else { text }
  table.insert(Dialog_.queue, { pages = pages, name = o.name, portrait = o.portrait, onDone = o.onDone, choices = o.choices, onChoose = o.onChoose })
  nextInQueue()
end

function Dialog_.ask(text, choices, onChoose, o)
  o = table.clone(o or {})
  o.choices, o.onChoose = choices, onChoose
  Dialog_.say(text, o)
end

-- true while a dialog is open (and on the frame it closed, so the closing press doesn't also jump)
function Dialog_.active()
  return dlg ~= nil or closedAt == tickN
end

function Dialog_.clear()
  Dialog_.queue = {}
  dlg = nil
end

function Dialog_.update(dt)
  tickN += 1
  local d = dlg
  if d == nil then return end
  local s = Dialog_.style
  local page = d.pages[d.page]
  local total = pageLen(page)
  local press = btnp("a") or mouse.pressed
  if d.shown < total then
    local before = math.floor(d.shown)
    d.shown = math.min(total, d.shown + s.speed * dt)
    if press then d.shown = total end
    if s.sound and math.floor(d.shown) > before and math.floor(d.shown) % 3 == 0 then sfx(s.sound, s.soundVolume) end
    return
  end
  local last = d.page == #d.pages
  local choices = d.entry.choices
  if last and choices then
    local n = #choices
    if btnp("up") then d.choice = (d.choice - 2) % n + 1 end
    if btnp("down") then d.choice = d.choice % n + 1 end
    for i, r in d.rects do
      if hit(r[1], r[2], r[3], r[4]) then
        d.choice = i
        if mouse.pressed then return finish(i) end
      end
    end
    if btnp("a") then finish(d.choice) end
  elseif press then
    if last then finish(nil) else d.page += 1; d.shown = 0 end
  end
end

function Dialog_.draw()
  local d = dlg
  if d == nil then return end
  local s = Dialog_.style
  local x, y, w, h, lh = boxRect()
  camera()
  rect(x, y, w, h, s.bg)
  rectline(x, y, w, h, s.border)
  local e = d.entry
  if e.name then
    local nw = textw(e.name, 1, s.font) + 10
    rect(x, y - lh - 4, nw, lh + 4, s.nameBg)
    rectline(x, y - lh - 4, nw, lh + 5, s.border)
    text(e.name, x + 5, y - lh - 1, s.name, { font = s.font })
  end
  local tx = x + s.padding
  if e.portrait then
    spr(e.portrait, tx, y + s.padding)
    tx += d.portraitW
  end
  -- the revealed part of the page
  local left = math.floor(d.shown)
  for i, line in d.pages[d.page] do
    local n = utf8.len(line) or #line
    local k = math.min(n, left)
    left -= k
    if k > 0 then Text_.drawChars(d.styled[d.page][i], tx, y + s.padding + (i - 1) * lh, s.text, { font = s.font }, k) end
  end
  local done = d.shown >= pageLen(d.pages[d.page])
  local last = d.page == #d.pages
  if done and not (last and e.choices) and math.floor(t() * 3) % 2 == 0 then
    -- "more" arrow
    local ax, ay = x + w - 10, y + h - 7
    rect(ax, ay, 5, 1, s.text)
    rect(ax + 1, ay + 1, 3, 1, s.text)
    rect(ax + 2, ay + 2, 1, 1, s.text)
  end
  if done and last and e.choices then
    local cw = 0
    for _, c in e.choices do cw = math.max(cw, textw(c, 1, s.font)) end
    cw += 22
    local ch = #e.choices * lh + 8
    local cx, cy = x + w - cw, y - ch - 2
    rect(cx, cy, cw, ch, s.bg)
    rectline(cx, cy, cw, ch, s.border)
    d.rects = {}
    for i, c in e.choices do
      local iy = cy + 4 + (i - 1) * lh
      d.rects[i] = { cx, iy, cw, lh }
      local sel = i == d.choice
      if sel then text(">", cx + 5, iy, s.choice, { font = s.font }) end
      text(c, cx + 14, iy, if sel then s.choice else s.dim, { font = s.font })
    end
  end
end

-- ------------------------------------------------------------------ UI
-- Menus, buttons, bars and toasts for title screens, pause and settings (keyboard, gamepad, mouse).
--
--   local menu = UI.menu({ "Start", "Settings", "Quit" })
--   local pick = menu:update()            -- in update: 1, 2, 3 when chosen (Z / A / click), else nil
--   menu:draw(W / 2, 90)                  -- in draw: the items, centered on x
--   -- sliders and toggles (left / right change them; onChange gets the new value):
--   UI.menu({ { label = "Music", value = 1, min = 0, max = 1, step = 0.1, onChange = function(v) volume("music", v) end },
--             { label = "Fullscreen", toggle = true, value = fullscreen(), onChange = fullscreen } })
--   if UI.button("OK", x, y, w, h) then ... end   -- a mouse button (draws itself; true when clicked)
--   UI.bar(x, y, w, h, hp, maxHp, "#b13e53")      -- health / progress bar
--   UI.toast("저장했습니다")                         -- a short message; UI.draw() shows it
--   if UI.pause.update() then return end          -- Enter / Esc / Start pauses the game (with a settings menu)
--   UI.pause.draw()

local UI_ = {
  style = {
    font = "erx", text = "#94b0c2", selected = "#ffcd75", panel = "#1a1c2cf0", border = "#f4f4f4",
    bar = "#333c57", button = "#333c57", buttonHover = "#3b5dc9", sound = "click", soundVolume = 0.25,
  },
  toasts = {},
}

UI = UI_

local Menu = {}
Menu.__index = Menu

function UI_.menu(items, o)
  o = o or {}
  local list = {}
  for _, it in items do
    table.insert(list, if type(it) == "table" then it else { label = tostring(it) })
  end
  return setmetatable({ items = list, index = 1, rects = {}, spacing = o.spacing, align = o.align or "center" }, Menu)
end

local function valueText(it)
  if it.toggle then return if it.value then "ON" else "OFF" end
  if it.min ~= nil then
    local span = (it.max or 1) - it.min
    return `{math.floor(((it.value or 0) - it.min) / (if span == 0 then 1 else span) * 100 + 0.5)}%`
  end
  return nil
end

function Menu:label(i)
  local it = self.items[i]
  local v = valueText(it)
  return if v then `{it.label}   < {v} >` else it.label
end

function Menu:move(d)
  local n = #self.items
  for _ = 1, n do
    self.index = (self.index - 1 + d) % n + 1
    if not self.items[self.index].disabled then break end
  end
  if UI_.style.sound then sfx(UI_.style.sound, UI_.style.soundVolume) end
end

local function change(it, dir)
  if it.toggle then
    it.value = not it.value
  elseif it.min ~= nil then
    local step = it.step or ((it.max - it.min) / 10)
    it.value = clamp((it.value or it.min) + dir * step, it.min, it.max)
    it.value = math.floor(it.value / step + 0.5) * step
  else
    return false
  end
  if it.onChange then it.onChange(it.value) end
  if UI_.style.sound then sfx(UI_.style.sound, UI_.style.soundVolume) end
  return true
end

-- returns the index of the item chosen this frame (plain items), or nil
function Menu:update()
  if btnp("up") then self:move(-1) end
  if btnp("down") then self:move(1) end
  local it = self.items[self.index]
  if btnp("left") then change(it, -1) end
  if btnp("right") then change(it, 1) end
  local moved = mouse.x ~= self.mx or mouse.y ~= self.my
  self.mx, self.my = mouse.x, mouse.y
  for i, r in self.rects do
    if hit(r[1], r[2], r[3], r[4]) and not self.items[i].disabled then
      if moved or mouse.pressed then self.index = i end
      if mouse.pressed then
        if change(self.items[i], 1) then return nil end
        return i
      end
    end
  end
  if btnp("a") and not it.disabled then
    if change(it, 1) then return nil end
    return self.index
  end
  return nil
end

function Menu:draw(x, y, o)
  o = o or {}
  local s = UI_.style
  local lh = texth(1, s.font)
  local gap = self.spacing or (lh + 4)
  self.rects = {}
  for i, it in self.items do
    local label = self:label(i)
    local tw = textw(label, 1, s.font)
    local lx = if self.align == "center" then x - tw / 2 elseif self.align == "right" then x - tw else x
    local iy = y + (i - 1) * gap
    local sel = i == self.index
    local color = if it.disabled then "#566c86" elseif sel then s.selected else s.text
    if sel then text(">", lx - 10, iy, s.selected, { font = s.font }) end
    text(label, lx, iy, color, { font = s.font, outline = o.outline })
    self.rects[i] = { lx - 12, iy - 2, tw + 24, lh + 2 }
  end
end

function UI_.panel(x, y, w, h, o)
  o = o or {}
  rect(x, y, w, h, o.color or UI_.style.panel)
  rectline(x, y, w, h, o.border or UI_.style.border)
end

function UI_.bar(x, y, w, h, value, max, color, o)
  o = o or {}
  local k = clamp(value / math.max(max, 1e-6), 0, 1)
  rect(x, y, w, h, o.back or UI_.style.bar)
  if k > 0 then rect(x + 1, y + 1, math.max(1, math.floor((w - 2) * k)), h - 2, color or "#a7f070") end
  rectline(x, y, w, h, o.border or "#1a1c2c")
end

-- a clickable button; returns true on the frame it is clicked
function UI_.button(label, x, y, w, h, o)
  o = o or {}
  local s = UI_.style
  local over = hit(x, y, w, h)
  rect(x, y, w, h, if over then s.buttonHover else s.button)
  rectline(x, y, w, h, s.border)
  local _, th = textsize(label, 1, s.font)
  text(label, x + w / 2, y + math.floor((h - th) / 2 + 0.5), o.color or "#f4f4f4", { font = s.font, align = "center" })
  return over and mouse.pressed
end

function UI_.toast(msg, secs)
  table.insert(UI_.toasts, { msg = tostring(msg), t = secs or 1.8 })
end

function UI_.update(dt)
  local keep = {}
  for _, q in UI_.toasts do
    q.t -= dt
    if q.t > 0 then table.insert(keep, q) end
  end
  UI_.toasts = keep
end

-- toasts (call last in draw)
function UI_.draw()
  local s = UI_.style
  local lh = texth(1, s.font)
  camera()
  for i, q in UI_.toasts do
    local tw = textw(q.msg, 1, s.font) + 12
    local a = math.min(1, q.t * 4)
    local y = 6 + (i - 1) * (lh + 8) - (1 - a) * 6
    rect(W / 2 - tw / 2, y, tw, lh + 5, s.panel)
    rectline(W / 2 - tw / 2, y, tw, lh + 5, s.border)
    text(q.msg, W / 2, y + 3, "#f4f4f4", { font = s.font, align = "center" })
  end
end

-- a ready-made pause screen: Enter / Esc / pad Start opens and closes it
-- (labels can be changed, e.g. UI.pause.title = "일시정지"; UI.pause.menu.items[1].label = "계속하기")
UI_.pause = { open = false, title = "PAUSED" }
UI_.pause.menu = UI_.menu({
  { id = "resume", label = "Resume" },
  { id = "music", label = "Music", value = 1, min = 0, max = 1, step = 0.1, onChange = function(v) volume("music", v) end },
  { id = "sfx", label = "Sound", value = 1, min = 0, max = 1, step = 0.1, onChange = function(v) volume("sfx", v) end },
  { id = "fullscreen", label = "Fullscreen", toggle = true, value = false, onChange = function(v) fullscreen(v) end },
})

-- call first in update: returns true while paused (skip the rest of your update)
function UI_.pause.update()
  local p = UI_.pause
  if btnp("start") then
    p.open = not p.open
    if p.open then
      local m = p.menu
      m.index = 1
      for _, it in m.items do
        if it.id == "music" then it.value = volume("music") end
        if it.id == "sfx" then it.value = volume("sfx") end
        if it.id == "fullscreen" then it.value = fullscreen() end
      end
    end
    return true
  end
  if not p.open then return false end
  local pick = p.menu:update()
  if pick and p.menu.items[pick].id == "resume" then p.open = false end
  if pick and p.menu.items[pick].onChoose then p.menu.items[pick].onChoose() end
  return true
end

function UI_.pause.draw()
  local p = UI_.pause
  if not p.open then return end
  camera()
  rect(0, 0, W, H, "#0b0d1ab0")
  local n = #p.menu.items
  local lh = texth(1, UI_.style.font) + 4
  local h = n * lh + 40
  local w = 150
  UI_.panel(W / 2 - w / 2, H / 2 - h / 2, w, h)
  text(p.title, W / 2, H / 2 - h / 2 + 8, UI_.style.selected, { font = UI_.style.font, align = "center" })
  p.menu:draw(W / 2, H / 2 - h / 2 + 28)
end

-- UI screens made in the editor's UI tab (a HUD, a title menu...):
--   UI.screen("hud")              -- draws it (call after Cam.reset()); returns the id of a button clicked now
-- Texts show game values with {name} or {G.coins}; sprites repeat by a value (hearts); bars fill by a value.
-- An element's anchor ("tl" top left, "t", "tr", "l", "c", "r", "bl", "b", "br") keeps it at that
-- corner or edge of the screen when the resolution changes; x, y are measured from there.

-- a global (or a field of one) by its dotted name; numbers stay numbers
local function lookup(path)
  local n = tonumber(path)
  if n then return n end
  local v = _G
  for part in string.gmatch(path, "[^%.]+") do
    if type(v) ~= "table" then return nil end
    v = v[part]
  end
  return v
end

-- "{G.coins}" -> "12"; braces that aren't values (Text markup like {wave}) stay as they are
local function fillText(str)
  return (string.gsub(str, "{([%a_][%w_%.]*)}", function(p)
    local v = lookup(p)
    if v == nil or type(v) == "table" or type(v) == "function" then return nil end
    if type(v) == "number" and v == math.floor(v) then return tostring(math.floor(v)) end
    return tostring(v)
  end))
end

function UI_.screen(name)
  local sc = __screen(name)
  if sc == nil then error(`UI.screen: no screen "{name}" (make it in the UI tab)`, 2) end
  camera()
  local clicked = nil
  for _, e in sc.elements or {} do
    if e.visible and e.visible ~= "" then
      local v = lookup(e.visible)
      if not v or v == 0 then continue end
    end
    local k = e.kind
    -- x, y are measured from the element's anchor: a corner, an edge's middle or the center
    local an = e.anchor or "tl"
    local x = e.x + (if string.find(an, "r") then W elseif string.find(an, "l") then 0 else W / 2)
    local y = e.y + (if string.sub(an, 1, 1) == "b" then H elseif string.sub(an, 1, 1) == "t" then 0 else H / 2)
    if k == "panel" then
      rect(x, y, e.w or 40, e.h or 20, e.bg or UI_.style.panel)
      if e.border then rectline(x, y, e.w or 40, e.h or 20, e.border) end
    elseif k == "text" then
      Text.draw(fillText(e.text or ""), x, y, e.color or "#f4f4f4", { align = e.align, scale = e.scale, font = e.font, outline = e.outline })
    elseif k == "sprite" and e.sprite then
      local count = 1
      if e["repeat"] and e["repeat"] ~= "" then count = math.max(0, math.floor(tonumber(lookup(e["repeat"])) or 0)) end
      local info = sprite(e.sprite)
      local step = ((info and info.w) or 8) * (e.scale or 1) + (e.gap or 1)
      for i = 0, count - 1 do spr(e.sprite, x + i * step, y, { frame = e.frame, scale = e.scale }) end
    elseif k == "bar" then
      local value = tonumber(lookup(e.value or "0")) or 0
      local max = tonumber(lookup(e.max or "1")) or 1
      UI_.bar(x, y, e.w or 40, e.h or 6, value, max, e.color, { back = e.bg, border = e.border })
    elseif k == "button" then
      if UI_.button(fillText(e.text or "OK"), x, y, e.w or 50, e.h or 14) then clicked = e.id or e.text end
    end
  end
  return clicked
end

-- ------------------------------------------------------------------ Path
-- Finding the way around walls on a tile map (walls = tiles with flag bit 0, like Physics).
--
--   local pts = Path.find("level1", ex, ey, px, py)        -- waypoints { {x, y}, ... } or nil
--   local dx, dy, d = Path.toward("level1", ex, ey, px, py) -- direction to move now (nil = no way)
--   Path.chase(enemy, player.x, player.y, 40, dt, "level1") -- move a box toward a point
--   Path.dist("level1", ex, ey, px, py)                     -- walking distance in tiles, or nil
--
-- toward / chase / dist share one distance field per target, so a crowd chasing the player costs
-- about the same as one enemy. Options: { bit = 0, diagonal = true }.

local Path_ = {}
Path = Path_

function Path_.find(map, x0, y0, x1, y1, o) return __path_find(map, x0, y0, x1, y1, o) end
function Path_.toward(map, x, y, tx, ty, o) return __path_toward(map, x, y, tx, ty, o) end
function Path_.dist(map, x, y, tx, ty, o) return __path_dist(map, x, y, tx, ty, o) end

-- Move box b (x, y = top-left, w, h) toward (tx, ty) at speed px/s, sliding along walls.
-- Returns the Physics hit table, and false when there is no way there.
function Path_.chase(b, tx, ty, speed, dt, map, o)
  local cx, cy = b.x + b.w / 2, b.y + b.h / 2
  local dx, dy = __path_toward(map, cx, cy, tx, ty, o)
  if dx == nil then return nil, false end
  -- don't overshoot a target that is closer than one step
  local step = math.min(speed * dt, math.sqrt((tx - cx) ^ 2 + (ty - cy) ^ 2))
  return Physics_.move(b, dx * step, dy * step, map, o and { solid = o.bit } or nil), true
end

-- ------------------------------------------------------------------ Save (slots)
-- Several save slots, each a table of values, plus when it was saved and a label to show.
--
--   Save.use(2)                     -- the active slot (default 1)
--   Save.set("level", "level3")     -- written at once
--   Save.get("level", "level1")
--   Save.label("Level 3 · 12 gems") -- shown on the slot screen
--   Save.info(n) -> { time, label } or nil (empty)    Save.clear(n)

local Save_ = { slot = 1, slots = 3 }
Save = Save_

local function slotData(n)
  local d = load("slate.slot" .. n, nil)
  return if type(d) == "table" then d else nil
end

function Save_.use(n) Save_.slot = n end

function Save_.get(key, fallback)
  local d = slotData(Save_.slot)
  if d == nil or d.values == nil or d.values[key] == nil then return fallback end
  return d.values[key]
end

function Save_.set(key, value)
  local d = slotData(Save_.slot) or { values = {} }
  d.values = d.values or {}
  d.values[key] = value
  d.time = now()
  save("slate.slot" .. Save_.slot, d)
end

function Save_.label(text)
  local d = slotData(Save_.slot) or { values = {} }
  d.label = text
  d.time = now()
  save("slate.slot" .. Save_.slot, d)
end

function Save_.info(n)
  local d = slotData(n or Save_.slot)
  return if d then { time = d.time or 0, label = d.label or "" } else nil
end

function Save_.clear(n) wipe("slate.slot" .. (n or Save_.slot)) end

-- "just now", "5 min ago", "3 h ago", "2 days ago"
local function ago(t)
  local s = math.max(0, now() - t)
  if s < 60 then return "just now" end
  if s < 3600 then return `{math.floor(s / 60)} min ago` end
  if s < 86400 then return `{math.floor(s / 3600)} h ago` end
  return `{math.floor(s / 86400)} days ago`
end

-- ------------------------------------------------------------------ settings + slot screens (UI)
-- Settings are kept between runs (music / sound volume, fullscreen) and applied at start.

local SETTINGS = "slate.settings"
local Lang_ = { tables = nil, version = -1, cur = nil }
local function applySettings()
  local s = load(SETTINGS, nil)
  if type(s) ~= "table" then return end
  if type(s.lang) == "string" then Lang_.cur = s.lang end
  if s.music then volume("music", s.music) end
  if s.sfx then volume("sfx", s.sfx) end
  if s.fullscreen ~= nil then fullscreen(s.fullscreen) end
end
local function keepSettings()
  save(SETTINGS, { music = volume("music"), sfx = volume("sfx"), fullscreen = fullscreen(), lang = Lang_.cur })
end
applySettings()

-- ------------------------------------------------------------------ languages
-- Texts per language in lang/<code>.json ({ "title": "...", "menu": { "start": "..." } }):
--   tr("menu.start")                 -- the text in the current language (the key itself if missing)
--   tr("gold", { n = 12 })           -- "{n} gold" -> "12 gold"
--   lang()  lang("en")  langs()      -- current / switch (remembered) / available codes
-- The first language is slate.json "language", else the player's last choice, else "en", else the first.

local function langTables()
  local v = __strings_version()
  if v ~= Lang_.version then
    Lang_.tables, Lang_.version = __strings() or {}, v
  end
  return Lang_.tables
end

function langs()
  local out = {}
  for k in langTables() do table.insert(out, k) end
  table.sort(out)
  return out
end

function lang(code)
  local t = langTables()
  if code ~= nil then
    if t[code] == nil then error(`lang: no lang/{code}.json`, 2) end
    Lang_.cur = code
    keepSettings()
    return code
  end
  if Lang_.cur == nil or t[Lang_.cur] == nil then
    local d = __lang_default()
    Lang_.cur = if d and t[d] then d elseif t.en then "en" else langs()[1]
  end
  return Lang_.cur
end

function tr(key, vars)
  local t = langTables()
  local cur = lang()
  local d = __lang_default()
  local s = (cur and t[cur] and t[cur][key]) or (d and t[d] and t[d][key]) or (t.en and t.en[key]) or key
  if vars then
    s = string.gsub(s, "{([%w_]+)}", function(k)
      local v = vars[k]
      return if v == nil then nil else tostring(v)
    end)
  end
  return s
end

local LANG_NAMES = { ko = "한국어", en = "English", ja = "日本語", zh = "中文", es = "Español", fr = "Français", de = "Deutsch", pt = "Português", ru = "Русский" }
function langname(code)
  return LANG_NAMES[code] or string.upper(code)
end

-- the pause menu's changes are kept too
for _, it in UI_.pause.menu.items do
  if it.onChange then
    local f = it.onChange
    it.onChange = function(v)
      f(v)
      keepSettings()
    end
  end
end

-- A settings screen for title menus:  UI.settings.show()  then update() / draw() while open.
UI_.settings = { open = false, title = "SETTINGS", controls = true }
UI_.settings.menu = UI_.menu({
  { id = "music", label = "Music", value = 1, min = 0, max = 1, step = 0.1, onChange = function(v) volume("music", v) keepSettings() end },
  { id = "sfx", label = "Sound", value = 1, min = 0, max = 1, step = 0.1, onChange = function(v) volume("sfx", v) keepSettings() end },
  { id = "fullscreen", label = "Fullscreen", toggle = true, value = false, onChange = function(v) fullscreen(v) keepSettings() end },
  { id = "back", label = "Back" },
})

function UI_.settings.show()
  local st = UI_.settings
  st.open = true
  st.menu.index = 1
  local items = st.menu.items
  local has = false
  for _, it in items do
    if it.id == "lang" then has = true end
  end
  if not has and #langs() > 1 then table.insert(items, #items, { id = "lang", label = "Language" }) end
  for _, it in items do
    if it.id == "lang" then it.label = `{st.langLabel or "Language"}: {langname(lang())}` end
  end
  for _, it in st.menu.items do
    if it.id == "music" then it.value = volume("music") end
    if it.id == "sfx" then it.value = volume("sfx") end
    if it.id == "fullscreen" then it.value = fullscreen() end
  end
end

-- returns true while open (skip the rest of your update)
function UI_.settings.update()
  local st = UI_.settings
  if not st.open then return false end
  local pick = st.menu:update()
  if pick and st.menu.items[pick].id == "lang" then
    local all = langs()
    local i = table.find(all, lang()) or 0
    lang(all[i % #all + 1])
    st.menu.items[pick].label = `{st.langLabel or "Language"}: {langname(lang())}`
  end
  if (pick and st.menu.items[pick].id == "back") or btnp("b") or btnp("start") then st.open = false end
  return true
end

function UI_.settings.draw()
  local st = UI_.settings
  if not st.open then return end
  camera()
  rect(0, 0, W, H, "#0b0d1ac0")
  local lh = texth(1, UI_.style.font) + 4
  local n = #st.menu.items
  local h = n * lh + 44 + (if st.controls then lh * 2 else 0)
  local w = 180
  local x0, y0 = W / 2 - w / 2, H / 2 - h / 2
  UI_.panel(x0, y0, w, h)
  text(st.title, W / 2, y0 + 8, UI_.style.selected, { font = UI_.style.font, align = "center" })
  st.menu:draw(W / 2, y0 + 28)
  if st.controls then
    local cy = y0 + 32 + n * lh
    text("move: arrows / WASD / pad", W / 2, cy, "#566c86", { font = UI_.style.font, align = "center" })
    text("A: Z / Space    B: X", W / 2, cy + lh, "#566c86", { font = UI_.style.font, align = "center" })
  end
end

-- A save slot screen:  UI.slots.show({ title = "LOAD", onPick = function(n, empty) ... end })
UI_.slots = { open = false, title = "SAVE SLOTS", index = 1 }

function UI_.slots.show(o)
  o = o or {}
  local sl = UI_.slots
  sl.open, sl.index, sl.title, sl.onPick, sl.allowEmpty = true, Save_.slot, o.title or "SAVE SLOTS", o.onPick, o.allowEmpty ~= false
end

function UI_.slots.update()
  local sl = UI_.slots
  if not sl.open then return false end
  local n = Save_.slots
  if btnp("up") then sl.index = (sl.index - 2) % n + 1 sfx(UI_.style.sound, UI_.style.soundVolume) end
  if btnp("down") then sl.index = sl.index % n + 1 sfx(UI_.style.sound, UI_.style.soundVolume) end
  if btnp("b") or btnp("start") then sl.open = false return true end
  local pick = nil
  for i = 1, n do
    local r = sl.rects and sl.rects[i]
    if r and hit(r[1], r[2], r[3], r[4]) then
      sl.index = i
      if mouse.pressed then pick = i end
    end
  end
  if btnp("a") then pick = sl.index end
  if pick then
    local empty = Save_.info(pick) == nil
    if empty and not sl.allowEmpty then
      sfx("error", 0.3)
    else
      Save_.use(pick)
      sl.open = false
      if sl.onPick then sl.onPick(pick, empty) end
    end
  end
  return true
end

function UI_.slots.draw()
  local sl = UI_.slots
  if not sl.open then return end
  camera()
  rect(0, 0, W, H, "#0b0d1ac0")
  local s = UI_.style
  local lh = texth(1, s.font)
  local rowH = lh * 2 + 8
  local w = math.min(W - 20, 220)
  local h = Save_.slots * (rowH + 4) + 30
  local x0, y0 = W / 2 - w / 2, H / 2 - h / 2
  UI_.panel(x0, y0, w, h)
  text(sl.title, W / 2, y0 + 8, s.selected, { font = s.font, align = "center" })
  sl.rects = {}
  for i = 1, Save_.slots do
    local y = y0 + 24 + (i - 1) * (rowH + 4)
    local sel = i == sl.index
    rect(x0 + 6, y, w - 12, rowH, if sel then "#333c57" else "#1a1c2c")
    if sel then rectline(x0 + 6, y, w - 12, rowH, s.selected) end
    sl.rects[i] = { x0 + 6, y, w - 12, rowH }
    local info = Save_.info(i)
    text(`SLOT {i}`, x0 + 12, y + 4, if sel then s.selected else s.text, { font = s.font })
    if info then
      text(if info.label ~= "" then info.label else "saved", x0 + 12, y + 5 + lh, "#f4f4f4", { font = s.font })
      local a = ago(info.time)
      text(a, x0 + w - 12 - textw(a, 1, s.font), y + 4, "#566c86", { font = s.font })
    else
      text("empty", x0 + 12, y + 5 + lh, "#566c86", { font = s.font })
    end
  end
end

-- (Actors, below, is declared first: Level loads a map's actors)
local Actors_ = { list = {}, bullets = {}, collected = {}, view = "side", map = nil }
Actors = Actors_

-- ------------------------------------------------------------------ Level
-- Moving between maps:  Level.player = hero (a box {x, y, w, h})
--   Level.start("level1")          -- the first map (or the "Play from here" spot when testing)
--   Level.go("cave", "entrance")   -- another map, at the object whose name (or type) is "entrance"
--   Level.current                  -- the map name;  Level.onEnter = function(map) ... end
-- Door objects (behavior=door, target=cave, to=entrance) call Level.go themselves.

local Level_ = { current = nil, player = nil, onEnter = nil }
Level = Level_

local function spawnPoint(map, name)
  for _, o in objects(map) do
    if name and ((o.props and o.props.name == name) or o.name == name or o.type == name) then return o.x, o.y end
  end
  if name == nil then
    for _, o in objects(map) do
      if o.type == "start" or o.type == "player" or o.type == "spawn" then return o.x, o.y end
    end
  end
  return nil
end

-- put the player's box with its feet at (x, y)
local function place(x, y)
  local p = Level_.player
  if p and x then
    p.x, p.y = x - (p.w or 0) / 2, y - (p.h or 0)
    if p.vx then p.vx = 0 end
    if p.vy then p.vy = 0 end
  end
end

function Level_.go(map, spawn)
  if mapinfo(map) == nil then error(`Level.go: no map "{map}"`, 2) end
  Level_.current = map
  Actors_.load(map)
  place(spawnPoint(map, spawn))
  if Level_.onEnter then Level_.onEnter(map) end
end

function Level_.start(map)
  local pt = playtest()
  if pt then
    Level_.go(pt.map)
    place(pt.x, pt.y)
  else
    Level_.go(map)
  end
end

-- ------------------------------------------------------------------ Actors (behavior presets)
-- Map objects with a behavior move by themselves; no code needed beyond:
--   Actors.update(dt, player)   (player = {x, y, w, h, vy?}; omit it for no interaction)
--   Actors.draw()               (inside Cam.apply())
-- Behaviors (props of the object; values below are the defaults):
--   patrol   walks and turns at walls and ledges       speed=30  gravity=500 (side view)
--   chase    comes after the player when near          speed=40  range=120
--   shoot    fires at the player when near             rate=1.5  range=150  bulletSpeed=100  bullet=(sprite)
--   pickup   collected on touch (sfx "coin")            value=1  sound=coin
--   hazard   hurts on touch
--   door     takes the player to another map            target=map  to=spawn name  key=up (or none)
--   bob      floats up and down (decoration)            height=3
-- Events:  Actors.onPickup(actor)  Actors.onHurt(actor)  Actors.onStomp(actor)  Actors.onDoor(actor)
--          Actors.collected[type] counts pickups.  Actors.view = "side" (gravity) or "top".


local function num(o, k, d)
  local v = o.props and o.props[k]
  return tonumber(v) or d
end

function Actors_.load(map)
  Actors_.list, Actors_.bullets, Actors_.map = {}, {}, map
  for _, o in objects(map) do
    local b = o.props and o.props.behavior
    if b then
      local info = o.sprite and sprite(o.sprite)
      local box = if o.sprite then hitbox(o.sprite, 0, 0) else { x = 0, y = 0, w = 8, h = 8 }
      local sw, sh = if info then info.w else 8, if info then info.h else 8
      local a = {
        obj = o, behavior = b, type = o.type, sprite = o.sprite, props = o.props or {},
        -- the box the game collides with, from the sprite's hitbox
        x = o.x - sw / 2 + box.x, y = o.y - sh + box.y, w = box.w, h = box.h, ox = box.x, oy = box.y,
        vx = 0, vy = 0, dir = if (o.props.dir == "left") then -1 else 1, t = rnd(0, 1), cool = num(o, "rate", 1.5) * rnd(0.3, 1),
        homeY = o.y - sh + box.y, alive = true,
      }
      if info and info.tags and info.tags.walk then a.anim = Anim.new(o.sprite, "walk")
      elseif info and info.tags and info.tags.idle then a.anim = Anim.new(o.sprite, "idle") end
      table.insert(Actors_.list, a)
    end
  end
end

local function solidAt(x, y) return Actors_.map and msolid(Actors_.map, x, y) end

local function walk(a, dt, speed)
  local map = Actors_.map
  if Actors_.view == "side" then
    a.vy = math.min(a.vy + num(a.obj, "gravity", 500) * dt, 400)
    local hit = Physics_.move(a, a.dir * speed * dt, a.vy * dt, map)
    if hit.down then a.vy = 0 end
    -- turn at walls, and at ledges when standing
    local ahead = if a.dir > 0 then a.x + a.w + 1 else a.x - 1
    if hit.left or hit.right or (hit.down and not solidAt(ahead, a.y + a.h + 2)) then a.dir = -a.dir end
  else
    local hit = Physics_.move(a, a.dir * speed * dt, 0, map)
    if hit.left or hit.right then a.dir = -a.dir end
  end
end

local function hurtOrStomp(a, p)
  -- side view: landing on top stomps it
  if Actors_.view == "side" and (p.vy or 0) > 0 and p.y + p.h - (p.vy or 0) / 60 <= a.y + 3 and a.behavior ~= "hazard" then
    if a.props.stomp ~= false then
      a.alive = false
      if Actors_.onStomp then Actors_.onStomp(a) end
      return
    end
  end
  if Actors_.onHurt then Actors_.onHurt(a) end
end

function Actors_.update(dt, player)
  local p = player
  for _, a in Actors_.list do
    if not a.alive then continue end
    a.t += dt
    if a.anim then a.anim:update(dt) end
    local b = a.behavior
    local dx, dy, dist = 0, 0, math.huge
    if p then
      dx, dy = (p.x + p.w / 2) - (a.x + a.w / 2), (p.y + p.h / 2) - (a.y + a.h / 2)
      dist = math.sqrt(dx * dx + dy * dy)
    end
    if b == "patrol" then
      walk(a, dt, num(a.obj, "speed", 30))
    elseif b == "chase" then
      if p and dist < num(a.obj, "range", 120) then
        if Actors_.view == "side" then
          a.dir = if dx < 0 then -1 else 1
          walk(a, dt, num(a.obj, "speed", 40))
        else
          Path.chase(a, p.x + p.w / 2, p.y + p.h / 2, num(a.obj, "speed", 40), dt, Actors_.map)
          a.dir = if dx < 0 then -1 else 1
        end
      elseif Actors_.view == "side" then
        walk(a, dt, 0)
      end
    elseif b == "shoot" then
      a.cool -= dt
      if p and dist < num(a.obj, "range", 150) and a.cool <= 0 then
        a.cool = num(a.obj, "rate", 1.5)
        local sp = num(a.obj, "bulletSpeed", 100)
        table.insert(Actors_.bullets, { x = a.x + a.w / 2, y = a.y + a.h / 2, vx = dx / dist * sp, vy = dy / dist * sp, life = 4, sprite = a.props.bullet, from = a })
        a.dir = if dx < 0 then -1 else 1
      end
    elseif b == "bob" then
      a.y = a.homeY + math.sin(a.t * 3) * num(a.obj, "height", 3)
    end
    -- touching the player
    if p and Physics_.overlap(a, p) then
      if b == "pickup" then
        a.alive = false
        Actors_.collected[a.type] = (Actors_.collected[a.type] or 0) + num(a.obj, "value", 1)
        sfx(a.props.sound or "coin", 0.5)
        if Actors_.onPickup then Actors_.onPickup(a) end
      elseif b == "door" then
        local key = a.props.key or "up"
        if key == "none" or btnp(key) then
          if Actors_.onDoor then Actors_.onDoor(a) end
          if a.props.target then
            Level_.go(a.props.target, a.props.to)
            return
          end
        end
      elseif b == "patrol" or b == "chase" or b == "hazard" or b == "shoot" then
        hurtOrStomp(a, p)
      end
    end
  end
  -- bullets
  local keep = {}
  for _, bl in Actors_.bullets do
    bl.life -= dt
    bl.x += bl.vx * dt
    bl.y += bl.vy * dt
    local gone = bl.life <= 0 or solidAt(bl.x, bl.y)
    if not gone and p and bl.x > p.x and bl.x < p.x + p.w and bl.y > p.y and bl.y < p.y + p.h then
      gone = true
      if Actors_.onHurt then Actors_.onHurt(bl.from) end
    end
    if not gone then table.insert(keep, bl) end
  end
  Actors_.bullets = keep
  -- forget the ones that are gone
  local alive = {}
  for _, a in Actors_.list do if a.alive then table.insert(alive, a) end end
  Actors_.list = alive
end

function Actors_.draw()
  for _, a in Actors_.list do
    if a.sprite then
      local x, y = a.x - a.ox, a.y - a.oy
      local flip = a.dir < 0
      if a.anim then a.anim:draw(x, y, { flipX = flip })
      else spr(a.sprite, x, y, { flipX = flip, anim = nil, frame = math.floor(a.t * 6) % math.max(1, (sprite(a.sprite) or { frames = 1 }).frames) }) end
    else
      rect(a.x, a.y, a.w, a.h, "#ffcd75")
    end
  end
  for _, bl in Actors_.bullets do
    if bl.sprite then spr(bl.sprite, bl.x, bl.y, { ox = 0.5, oy = 0.5 })
    else
      circ(bl.x, bl.y, 2, "#ff7aa8", true)
      circ(bl.x, bl.y, 1, "#ffffff", true)
    end
  end
end

-- ------------------------------------------------------------------ Fx
-- Whole-screen effects drawn over the game (after draw(), so HUDs get them too).
--
--   Fx.flash("#ffffff", 0.1)        -- a quick flash that fades out (hits, explosions)
--   Fx.fade("#000000", 0.5, done)   -- fade to a color and stay there; Fx.fade(nil, 0.5) fades back
--   Fx.freeze(0.06)                 -- hit-stop: the game holds still for a moment
--   Fx.tint("#1a2a6c", 0.35)        -- tint the screen (night, underwater); Fx.tint() clears it
--
-- Screen shaders (on the whole image, smooth on any window size):
--   Fx.effect("crt", 1)             -- turn one on (0..1, some take bigger numbers), 0 / nil turns it off
--   Fx.effect("grayscale", 1, 0.5)  -- ...fading over 0.5 s
--   Fx.effect({ vignette = 0.6, bloom = 0.5 })
--   Fx.shockwave(x, y)              -- a ring of distortion from a point (map / world pixels)
--   Fx.glitch(0.3)                  -- digital glitch for a moment
--   Fx.shader(glsl)                 -- your own fragment shader (main(); uv, Texture, time, resolution)
--   Fx.reset()
-- Effects: crt scanlines vignette aberration grayscale sepia invert pixelate wave
--          brightness contrast saturation hue posterize noise bloom

local Fx_ = { flashC = "#ffffff", flashT = 0, flashD = 0, fadeC = "#000000", fadeA = 0, fadeFrom = 0, fadeTo = 0, fadeT = 0, fadeD = 0, tintC = nil, tintA = 0, freezeT = 0,
  values = {}, fades = {}, waves = {}, glitchT = 0, glitchK = 0, glitchD = 0, dirty = true }
Fx = Fx_

-- uniform slot of each effect, and its "off" value
local SLOT = { crt = 1, scanlines = 2, vignette = 3, aberration = 4, grayscale = 5, sepia = 6, invert = 7, pixelate = 8,
  wave = 9, brightness = 10, contrast = 11, saturation = 12, hue = 13, posterize = 14, noise = 15, bloom = 16 }
local NEUTRAL = { brightness = 1, contrast = 1, saturation = 1 }

-- "#rgb" / "#rrggbb" + alpha 0..1 -> "#rrggbbaa"
local function withAlpha(c, a)
  if type(c) ~= "string" or c:sub(1, 1) ~= "#" then return c end
  if #c == 4 then c = "#" .. c:sub(2, 2):rep(2) .. c:sub(3, 3):rep(2) .. c:sub(4, 4):rep(2) end
  return c:sub(1, 7) .. string.format("%02x", math.floor(clamp(a, 0, 1) * 255 + 0.5))
end

function Fx_.flash(color, time)
  Fx_.flashC, Fx_.flashD = color or "#ffffff", time or 0.12
  Fx_.flashT = Fx_.flashD
end

function Fx_.fade(color, time, onDone)
  if color then Fx_.fadeC = color end
  Fx_.fadeFrom, Fx_.fadeTo = Fx_.fadeA, if color then 1 else 0
  Fx_.fadeD, Fx_.fadeT, Fx_.fadeDone = time or 0.4, 0, onDone
end

function Fx_.tint(color, amount) Fx_.tintC, Fx_.tintA = color, amount or 0.3 end
function Fx_.freeze(time) Fx_.freezeT = math.max(Fx_.freezeT, time or 0.06) end

local function effectValue(name) return Fx_.values[name] or NEUTRAL[name] or 0 end

-- Fx.effect(name, value, fadeTime) or Fx.effect({ name = value, ... }, fadeTime)
function Fx_.effect(name, value, time)
  if type(name) == "table" then
    for n, v in name do Fx_.effect(n, v, value) end
    return
  end
  if SLOT[name] == nil then error(`Fx.effect: no effect "{name}"`, 2) end
  local to = if value == nil or value == false then (NEUTRAL[name] or 0) elseif value == true then 1 else value
  if time and time > 0 then
    Fx_.fades[name] = { from = effectValue(name), to = to, t = 0, d = time }
  else
    Fx_.fades[name] = nil
    Fx_.values[name] = to
  end
  Fx_.dirty = true
end

function Fx_.crt(on, strength) Fx_.effect("crt", if on == false then 0 else (strength or 1)) end

function Fx_.shockwave(x, y, o)
  o = o or {}
  table.insert(Fx_.waves, { x = x - Cam_.x - Cam_.ox, y = y - Cam_.y - Cam_.oy, r = 0, speed = o.speed or 180, size = o.size or math.max(W, H) * 0.6, strength = o.strength or 1 })
end

function Fx_.glitch(time, strength)
  Fx_.glitchT, Fx_.glitchD, Fx_.glitchK = time or 0.3, time or 0.3, strength or 1
end

function Fx_.shader(src) __shader(src) end

function Fx_.reset()
  Fx_.values, Fx_.fades, Fx_.waves = {}, {}, {}
  Fx_.glitchT, Fx_.tintC, Fx_.fadeA, Fx_.flashT = 0, nil, 0, 0
  Fx_.dirty = true
  __shader(nil)
end

function Fx_.update(dt)
  if Fx_.flashT > 0 then Fx_.flashT = math.max(0, Fx_.flashT - dt) end
  for name, f in Fx_.fades do
    f.t = math.min(f.d, f.t + dt)
    Fx_.values[name] = lerp(f.from, f.to, Ease_.outQuad(f.t / f.d))
    if f.t >= f.d then Fx_.fades[name] = nil end
    Fx_.dirty = true
  end
  for i = #Fx_.waves, 1, -1 do
    local w = Fx_.waves[i]
    w.r += w.speed * dt
    if w.r > w.size then table.remove(Fx_.waves, i) end
    Fx_.dirty = true
  end
  if Fx_.glitchT > 0 then
    Fx_.glitchT = math.max(0, Fx_.glitchT - dt)
    Fx_.dirty = true
  end
  if Fx_.fadeD > 0 and Fx_.fadeT < Fx_.fadeD then
    Fx_.fadeT = math.min(Fx_.fadeD, Fx_.fadeT + dt)
    Fx_.fadeA = lerp(Fx_.fadeFrom, Fx_.fadeTo, Fx_.fadeT / Fx_.fadeD)
    if Fx_.fadeT >= Fx_.fadeD and Fx_.fadeDone then
      local f = Fx_.fadeDone
      Fx_.fadeDone = nil
      f()
    end
  end
end

function Fx_.draw()
  if Fx_.tintC and Fx_.tintA > 0 then rect(0, 0, W, H, withAlpha(Fx_.tintC, Fx_.tintA)) end
  -- shader values, sent when something changed
  if Fx_.dirty then
    Fx_.dirty = false
    local v = table.create(21, 0)
    for name, slot in SLOT do v[slot] = effectValue(name) end
    v[17] = if Fx_.glitchD > 0 then Fx_.glitchK * Fx_.glitchT / Fx_.glitchD else 0
    local w = Fx_.waves[#Fx_.waves]
    if w then
      v[18], v[19], v[20], v[21] = w.x / W, w.y / H, w.r / H, w.strength * (1 - w.r / w.size)
    end
    __postfx(v)
  end
  if Fx_.fadeA > 0 then rect(0, 0, W, H, withAlpha(Fx_.fadeC, Fx_.fadeA)) end
  if Fx_.flashT > 0 then rect(0, 0, W, H, withAlpha(Fx_.flashC, Fx_.flashT / Fx_.flashD)) end
end

-- ------------------------------------------------------------------ the engine ticks these before update(dt)
-- (the library keeps private references, so a game may reuse a name like UI or Timer for its own globals)
function __slate_tick(dt)
  Debug_.on = __debug_boxes()
  Fx_.update(dt)
  -- hit-stop: skip this tick's update entirely
  if Fx_.freezeT > 0 then
    Fx_.freezeT -= dt
    return true
  end
  UI_.update(dt)
  -- the pause screen stops game time (timers, tweens, camera shake, dialogs)
  if UI_.pause.open then return end
  Timer_.update(dt)
  Tween_.update(dt)
  Cam_.update(dt)
  Dialog_.update(dt)
end

-- ... and draw this over the game after draw()
function __slate_post()
  camera()
  Fx_.draw()
  if Debug_.on then Debug_.draw() end
end
