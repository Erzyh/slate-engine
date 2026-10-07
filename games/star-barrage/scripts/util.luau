-- util.luau: small helpers and the UI drawing kit (panels, bars, buttons, item slots).

function Util.keep(list, alive)
  local out = {}
  for _, v in list do
    if alive(v) then table.insert(out, v) end
  end
  return out
end

-- "#rrggbb" + alpha 0..1 -> "#rrggbbaa". Alpha is quantized to 16 steps so the engine's
-- color cache stays small no matter how many fading particles there are.
function Util.alpha(c, a)
  local q = math.clamp(math.floor(a * 15 + 0.5), 0, 15) * 17
  return string.sub(c, 1, 7) .. string.format("%02x", q)
end

function Util.approach(v, target, step)
  if v < target then return math.min(v + step, target) end
  return math.max(v - step, target)
end

function Util.overlap(a, b)
  return a.x < b.x + b.w and a.x + a.w > b.x and a.y < b.y + b.h and a.y + a.h > b.y
end

function Util.copy(t)
  local o = {}
  for k, v in t do o[k] = if type(v) == "table" then Util.copy(v) else v end
  return o
end

-- ------------------------------------------------------------------ UI kit

-- framed panel: dark fill, border, top highlight, optional title strip
function Util.panel(x, y, w, h, title)
  rect(x + 2, y + 2, w, h, "#00000066")
  rect(x, y, w, h, UI.bg)
  rectline(x, y, w, h, UI.line)
  rect(x + 1, y + 1, w - 2, 1, UI.hi)
  if title then
    rect(x + 1, y + 1, w - 2, 13, "#2a2140")
    rect(x + 1, y + 14, w - 2, 1, UI.line)
    text(title, x + 6, y + 4, UI.gold)
  end
end

-- bar with a trailing "damage" segment (trail >= value) and optional label
function Util.bar(x, y, w, h, value, max, color, trail, label)
  rect(x, y, w, h, "#0a0810")
  rectline(x - 1, y - 1, w + 2, h + 2, UI.line)
  local f = math.clamp(value / math.max(1, max), 0, 1)
  local tr = math.clamp((trail or value) / math.max(1, max), 0, 1)
  if tr > f then rect(x, y, math.floor(w * tr), h, "#ffffffaa") end
  rect(x, y, math.floor(w * f), h, color)
  rect(x, y, math.floor(w * f), 1, "#ffffff55")
  if label then text(label, x + w / 2, y + math.floor((h - 7) / 2) + 1, UI.text, { align = "center", outline = "#0a0810" }) end
end

-- clickable button; returns true on click
function Util.button(x, y, w, h, label, enabled)
  enabled = enabled ~= false
  local over = enabled and hit(x, y, w, h)
  rect(x, y, w, h, if not enabled then "#1a1522" elseif over then "#3a2e58" else "#251e36")
  rectline(x, y, w, h, if over then UI.gold else UI.line)
  text(label, x + w / 2, y + math.floor((h - 7) / 2), if enabled then UI.text else UI.dim, { align = "center" })
  return over and mouse.pressed
end

-- item slot box with rarity border; returns hovered
function Util.slot(x, y, item, size, placeholder)
  size = size or 26
  local over = hit(x, y, size, size)
  rect(x, y, size, size, if over then "#2e2545" else "#1a1526")
  local border = UI.line
  if item then border = RARITY[item.rarity or 1].color end
  rectline(x, y, size, size, if over then UI.gold else border)
  if item then
    local base = ITEMS[item.id]
    if (item.rarity or 1) > 1 then rect(x + 1, y + size - 3, size - 2, 2, Util.alpha(RARITY[item.rarity].color, 0.6)) end
    spr(base.icon, x + size / 2, y + size / 2, { ox = 0.5, oy = 0.5 })
    if base.stack and (item.n or 1) > 1 then text(tostring(item.n), x + size - 2, y + size - 9, UI.text, { align = "right", outline = "#000000" }) end
  elseif placeholder then
    text(placeholder, x + size / 2, y + size / 2 - 3, "#4a4060", { align = "center" })
  end
  return over
end

-- wrap text to a pixel width
function Util.wrap(s, width)
  local lines, line = {}, ""
  for word in string.gmatch(s, "%S+") do
    local try = if line == "" then word else line .. " " .. word
    if textw(try) > width and line ~= "" then
      table.insert(lines, line)
      line = word
    else
      line = try
    end
  end
  if line ~= "" then table.insert(lines, line) end
  return lines
end
