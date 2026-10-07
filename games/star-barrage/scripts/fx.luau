-- fx.luau: particles, sprite-sheet VFX, damage numbers, screen shake, hit-stop, flashes, afterimages.

FX.parts, FX.anims, FX.nums, FX.rings, FX.ghosts = {}, {}, {}, {}, {}
FX.shake, FX.stop, FX.flashA, FX.flashC = 0, 0, 0, "#ffffff"

function FX.reset()
  FX.parts, FX.anims, FX.nums, FX.rings, FX.ghosts = {}, {}, {}, {}, {}
  FX.shake, FX.stop, FX.flashA = 0, 0, 0
end

-- spray of square particles. o: speed, up (bias upward), gravity, life, size, add, spread, angle
function FX.burst(x, y, n, colors, o)
  o = o or {}
  local speed = o.speed or 120
  for _ = 1, n do
    local a = (o.angle or -math.pi / 2) + rnd(-(o.spread or math.pi), o.spread or math.pi)
    local v = rnd(0.3, 1) * speed
    local life = rnd(0.35, 0.8) * (o.life or 1)
    table.insert(FX.parts, {
      x = x + rnd(-2, 2), y = y + rnd(-2, 2), vx = math.cos(a) * v, vy = math.sin(a) * v,
      g = o.gravity or 500, life = life, max = life, c = pick(colors), s = o.size or irnd(1, 3),
      add = o.add or false, drag = o.drag or 0.5,
    })
  end
end

-- slow drifting motes (embers, sparkles, leaves)
function FX.mote(x, y, color, o)
  o = o or {}
  local life = o.life or rnd(1.5, 3)
  table.insert(FX.parts, {
    x = x, y = y, vx = o.vx or rnd(-8, 8), vy = o.vy or rnd(-25, -8), g = o.g or 0, life = life, max = life,
    c = color, s = o.size or 1, add = o.add ~= false, drag = 0, wobble = o.wobble or 0, ph = rnd(0, 6.28),
  })
end

-- play a VFX sheet (8 frames, black background drawn additively)
function FX.vfx(name, x, y, o)
  o = o or {}
  table.insert(FX.anims, {
    name = name, x = x, y = y, t = 0, fps = o.fps or 20, scale = o.scale or 1, rot = o.rot or 0,
    flip = o.flip or false, tint = o.tint, alpha = o.alpha or 1, follow = o.follow, frames = 8,
  })
end

function FX.num(x, y, txt, color, big)
  table.insert(FX.nums, { x = x + rnd(-4, 4), y = y, vy = -55, text = tostring(txt), c = color, life = 0.9, big = big })
end

function FX.ring(x, y, color, maxR, speed)
  table.insert(FX.rings, { x = x, y = y, r = 2, max = maxR or 40, speed = speed or 160, c = color })
end

function FX.ghost(spriteName, x, y, o)
  table.insert(FX.ghosts, { name = spriteName, x = x, y = y, life = 0.25, flip = o.flip, tint = o.tint or "#7ab0ff", ox = o.ox, oy = o.oy, sx = o.sx, sy = o.sy })
end

function FX.kick(shake, stop)
  FX.shake = math.max(FX.shake, shake or 0)
  FX.stop = math.max(FX.stop, stop or 0)
end

function FX.flash(color, a)
  FX.flashC, FX.flashA = color, math.max(FX.flashA, a)
end

function FX.update(dt)
  for _, p in FX.parts do
    p.vy += p.g * dt
    p.vx *= 1 - p.drag * dt
    if p.wobble and p.wobble > 0 then p.x += math.sin(p.life * 4 + p.ph) * p.wobble * dt end
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.life -= dt
  end
  FX.parts = Util.keep(FX.parts, function(p) return p.life > 0 end)
  for _, a in FX.anims do
    a.t += dt
    if a.follow then a.x, a.y = a.follow.x + (a.fx or 0), a.follow.y + (a.fy or 0) end
  end
  FX.anims = Util.keep(FX.anims, function(a) return a.t * a.fps < a.frames end)
  for _, n in FX.nums do
    n.y += n.vy * dt
    n.vy += 90 * dt
    n.life -= dt
  end
  FX.nums = Util.keep(FX.nums, function(n) return n.life > 0 end)
  for _, r in FX.rings do r.r += r.speed * dt end
  FX.rings = Util.keep(FX.rings, function(r) return r.r < r.max end)
  for _, g in FX.ghosts do g.life -= dt end
  FX.ghosts = Util.keep(FX.ghosts, function(g) return g.life > 0 end)
  FX.shake = math.max(0, FX.shake - dt * 30)
  FX.flashA = math.max(0, FX.flashA - dt * 3)
end

-- world space (inside camera)
function FX.drawBack()
  for _, g in FX.ghosts do
    spr(g.name, g.x, g.y, { ox = g.ox or 0.5, oy = g.oy or 1, flipX = g.flip, add = true, alpha = g.life * 2.4, tint = g.tint, sx = g.sx, sy = g.sy })
  end
end

function FX.drawFront()
  for _, r in FX.rings do
    local a = 1 - r.r / r.max
    circ(r.x, r.y, r.r, Util.alpha(r.c, a), false)
    circ(r.x, r.y, r.r - 1, Util.alpha(r.c, a * 0.5), false)
  end
  blend("add")
  for _, a in FX.anims do
    local f = math.min(a.frames - 1, math.floor(a.t * a.fps))
    spr(a.name, a.x, a.y, { frame = f, ox = 0.5, oy = 0.5, scale = a.scale, rot = a.rot, flipX = a.flip, tint = a.tint, alpha = a.alpha })
  end
  blend()
  for _, p in FX.parts do
    local fade = math.min(1, p.life / p.max * 2)
    if p.add then
      blend("add")
      rect(p.x, p.y, p.s, p.s, Util.alpha(p.c, fade))
      blend()
    else
      rect(p.x, p.y, p.s, p.s, Util.alpha(p.c, fade))
    end
  end
  for _, n in FX.nums do
    local s = if n.big then 2 else 1
    local a = math.min(1, n.life * 3)
    text(n.text, n.x, n.y, Util.alpha(n.c, a), { align = "center", scale = s, outline = Util.alpha("#1a0e14", a) })
  end
end

-- screen space
function FX.drawScreen()
  if FX.flashA > 0 then rect(0, 0, W, H, Util.alpha(FX.flashC, FX.flashA * 0.5)) end
end
