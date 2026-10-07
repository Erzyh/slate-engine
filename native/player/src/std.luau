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
  o = o or {}
  for _, px in edge(b.x, b.w, mapinfo(map).tw) do
    if msolid(map, px, b.y + b.h + 0.5, o.solid or 0) or (o.oneway and msolid(map, px, b.y + b.h + 0.5, o.oneway)) then return true end
  end
  return false
end

function Physics_.overlap(a, b)
  return a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h
end

-- ------------------------------------------------------------------ Particles
--
--   local fx = Particles.new()
--   fx:burst(x, y, 20, { colors = { "#ffcc4d", "#ffffff" }, speed = 120, gravity = 300, life = 0.6, size = 2 })
--   fx:update(dt)     fx:draw()     (draw inside Cam.apply() for world particles)

local Particles_ = {}
Particles = Particles_
Particles_.__index = Particles_

function Particles_.new()
  return setmetatable({ list = {} }, Particles_)
end

function Particles_:burst(x, y, n, o)
  o = o or {}
  local colors = o.colors or { o.color or "#ffffff" }
  for _ = 1, n do
    local a = (o.angle or -math.pi / 2) + rnd(-(o.spread or math.pi), o.spread or math.pi)
    local v = rnd(0.3, 1) * (o.speed or 80)
    local life = rnd(0.5, 1) * (o.life or 0.6)
    table.insert(self.list, {
      x = x, y = y, vx = math.cos(a) * v, vy = math.sin(a) * v, g = o.gravity or 0, drag = o.drag or 0,
      life = life, max = life, c = colors[irnd(1, #colors)], s = o.size or 1, shrink = o.shrink ~= false, add = o.add,
    })
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
  local pages = {}
  for _, p in entry.pages do
    local lines = wrap(tostring(p), w - s.padding * 2 - portraitW, 1, s.font)
    for i = 1, #lines, s.lines do
      table.insert(pages, { table.unpack(lines, i, math.min(#lines, i + s.lines - 1)) })
    end
  end
  if #pages == 0 then pages = { { "" } } end
  dlg = { entry = entry, pages = pages, page = 1, shown = 0, choice = 1, portraitW = portraitW, rects = {} }
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
    if k > 0 then
      local cut = if k >= n then #line + 1 else utf8.offset(line, k + 1)
      text(string.sub(line, 1, cut - 1), tx, y + s.padding + (i - 1) * lh, s.text, { font = s.font })
    end
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
  local lh = texth(1, s.font)
  text(label, x + w / 2, y + (h - lh) / 2 + 1, o.color or "#f4f4f4", { font = s.font, align = "center" })
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

-- ------------------------------------------------------------------ the engine ticks these before update(dt)
-- (the library keeps private references, so a game may reuse a name like UI or Timer for its own globals)
function __slate_tick(dt)
  UI_.update(dt)
  -- the pause screen stops game time (timers, tweens, camera shake, dialogs)
  if UI_.pause.open then return end
  Timer_.update(dt)
  Tween_.update(dt)
  Cam_.update(dt)
  Dialog_.update(dt)
end
