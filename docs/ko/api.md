# 게임 코드 API

[English](../en/api.md) · **한국어**

```lua
-- scripts/main.luau
local player = require("player")      -- scripts/player.luau가 return한 테이블

function init() player.spawn(40, 100) end
function update(dt) player.update(dt) end
function draw()
  cls("#1d1b2a")
  player.draw()
  text(`GOLD {fmt(12345)}`, 4, 4, "#ffcc66")
end
```

- `require("이름")`: `scripts/` 기준 경로(`"enemies/beetle"`), 또는 지금 파일 기준 상대 경로(`"./helper"`, `"../lib/vec"`). 한 번만 실행되고 결과는 캐시된다(모듈끼리 상태 공유 가능). 순환 require는 에러.
- 에러는 `scripts/player.luau:42: ...` 처럼 파일과 줄이 나온다.
- 예시 두 가지: **모듈 방식**(파일마다 테이블을 return) → `games/jelly`, **전역 방식**(게임잼용, 공용 테이블을 전역에) → `games/star-barrage`.

## 함수 한눈에 보기

| 분류 | API |
|---|---|
| 그리기 | `cls(c)` `spr(name, x, y, {frame, anim, at, scale, sx, sy, rot, ox, oy, flipX, flipY, alpha, tint, add})` `rect` `rectline` `line` `circ` `text(s, x, y, c, {align, scale, outline})` `textw` `camera(x, y)` `blend("add")` `sprite(name)` → `{w, h, frames, fps, tags, durations}` |
| 애니메이션 | `spr(..., {anim = "walk"})` 태그 반복 재생 (프레임 시간 반영). 세밀한 제어는 `Anim` (아래) |
| 타일맵 | `map(name, x, y, {layer, tint})` `mget(name, tx, ty, layer)` `mset(name, tx, ty, tile, layer)` `mapinfo(name)` `fget(tileset, tile, bit)` `msolid(name, px, py, bit)` |
| 충돌 박스 | `hitbox(name, x, y, {flipX, ox, oy})` → `{x, y, w, h}`: 픽셀 에디터의 Hitbox 도구로 그린 박스를 `spr(name, x, y)` 위치에 맞춰 돌려준다 (없으면 스프라이트 전체). `sprite(name).box` |
| 길찾기 | `Path.find` `Path.toward` `Path.chase` `Path.dist` (아래) |
| 화면 효과 | `Fx.flash` `Fx.fade` `Fx.freeze` `Fx.tint`, 셰이더 `Fx.effect` `Fx.shockwave` `Fx.glitch` `Fx.shader` (아래) |
| 글자 효과 | `Text.draw(s, x, y, c, {wave, shake, rainbow, typing...})`, 글 안에 `{wave}...{/}` (아래) |
| 화면 | `UI.screen(name)`: UI 탭에서 만든 화면을 그린다, `UI.settings`, `UI.slots` (아래) |
| 레벨 | `Level.start` `Level.go(map, spawn)`, 맵 오브젝트의 행동 `Actors.update` / `Actors.draw` (아래) |
| 저장 슬롯 | `Save.use(n)` `Save.get` `Save.set` `Save.label` `Save.info` `Save.clear` (아래) |
| 테스트 | `playtest()` → `{map, x, y}`: 에디터의 "Play from here"로 실행했을 때만 값이 있다 (아래) |
| 오브젝트 | `objects(map, type?)` → `{id, type, sprite, x, y, props, ...props}` (x, y = 아래 가운데, 맵 픽셀) |
| 입력 | `btn(action)` `btnp(action)` `axis("x")` `bind(action, keys)` `pad()` (아래), `key(name)` `keyp(name)` `mouse.x/.y/.down/.pressed/.released/.wheel` `hit(x, y, w, h)` |
| 글꼴 | `font("erx")` 한글 픽셀 폰트로 전환 (아래), `text(s, x, y, c, {font = "erx_b"})`, `wrap(s, width)` → 줄 목록 (단어 단위 줄바꿈), `texth()` 줄 높이 |
| 소리 크기 | `volume("music" \| "sfx", v)` 전체 음량 0~1 (설정 화면용) |
| 창 | `fullscreen()` 상태, `fullscreen(true/false)` 전환. 플레이어는 언제든 F11 / Alt+Enter. `slate.json`에 `"fullscreen": true`면 전체 화면으로 시작 |
| 유틸 | `t()` `now()` `rnd` `irnd` `pick` `clamp` `lerp` `fmt(큰 수 → 1.23K)` `W` `H` `log(...)` |
| 저장 | `save(key, value)` `load(key, fallback)` `wipe(key)` → `%APPDATA%\Slate\<게임 이름>\` |
| 효과음 | `sfx(name, volume?)`: `sounds/`의 파일, 없으면 내장 프리셋 (`click` `coin` `buy` `error` `hit` `jump` `explode` `powerup`). `beep(freq, dur, wave, vol, slide)` |
| 음악 | `music(name, {volume, loop, fade})` 크로스페이드, `music()` / `music(nil, {fade})` 정지, `musicname()` |
| 모듈 | `require(path)` |

## 애니메이션 (`Anim`)

에디터에서 프레임·태그·프레임 시간을 정하고, 코드에서는 상태만 바꾼다.

```lua
local hero = Anim.new("hero", "idle")
hero:play("run")                                    -- 이미 run이면 그대로 (처음부터 다시 X)
hero:play("attack", { loop = false, onEnd = function() hero:play("idle") end })
hero:update(dt)
hero:draw(x, y, { flipX = facing < 0, ox = 0.5, oy = 1 })
-- hero.frame, hero.tag, hero.done, hero.speed (배속)
```

## 입력 액션과 게임패드

휴대폰·태블릿에서 웹 빌드를 열면 화면에 방향 패드, A, B, START 버튼이 나온다. 게임패드처럼 동작하므로 `btn("left")`, `btn("a")`가 그대로 된다 (게임 코드를 고칠 필요 없음).

키보드와 게임패드(XInput)를 같은 이름으로 읽는다. 기본 액션:

| 액션 | 키보드 | 게임패드 |
|---|---|---|
| `left` `right` `up` `down` | 방향키, WASD | 십자키, 왼쪽 스틱 |
| `a` `b` `x` `y` | Z/Space/J, X/K, C/L, V/I | A, B, X, Y |
| `start` `select` | Enter/Esc, Tab | Start, Back |

```lua
if btnp("a") then jump() end                        -- 키보드 Z든 패드 A든
local vx = axis("x") * speed                        -- -1..1, 아날로그 스틱 값 그대로
bind("dash", { "c", "shift", "pad_rb" })            -- 나만의 액션 (기본 액션도 덮어쓰기 가능)
```

패드 이름: `pad_a/b/x/y/start/select/lb/rb/lt/rt/l3/r3/up/down/left/right`, `lstick_left/right/up/down`. `axis("rx"/"ry"/"lt"/"rt")`로 오른쪽 스틱과 트리거 값.

## 표준 라이브러리

어디서나 쓸 수 있는 전역 모듈. `Timer` `Tween` `Cam`은 엔진이 매 프레임 `update` 전에 자동으로 갱신한다.

```lua
Timer.after(0.5, function() sfx("coin") end)
Timer.every(1, spawnEnemy, 10)                      -- 1초마다 10번
Tween.to(box, 0.4, { y = 20 }, { ease = "outBack", onDone = function() ... end })

Scene.add("title", { enter = function() end, update = function(dt) if btnp("a") then Scene.go("play", nil, { fade = 0.3 }) end end, draw = function() cls("#000") end })
Scene.go("title")                                   -- update/draw를 직접 정의하지 않으면 Scene이 맡는다

Cam.follow(p.x, p.y, dt, { bounds = "level1" })     -- 부드럽게 따라가고 맵 밖은 안 보이게
Cam.shake(3, 0.2)
Cam.apply()  map("level1", 0, 0)  spr("hero", p.x, p.y)  Cam.reset()  -- HUD는 reset 후

local hit = Physics.move(p, p.vx * dt, p.vy * dt, "level1", { oneway = 1 })  -- 타일 충돌 (flag 0 = 벽, 1 = 위로만 통과)
if hit.down then p.vy = 0 end
Physics.grounded(p, "level1")  Physics.overlap(a, b)  -- 박스는 {x, y, w, h}

local fx = Particles.new()
fx:burst(x, y, 20, { colors = { "#ffcc66", "#ff6644" }, speed = 90, life = 0.5, gravity = 200 })
fx:burst(x, y, "explosion")          -- Project → Particles에서 만든 프리셋
fx:emit(x, y, "smoke", dt)           -- 계속 뿜기 (프리셋의 Rate = 초당 개수). 횃불, 연기
fx:update(dt)  fx:draw()
```

## 대화창과 UI

```lua
-- 대화: 타자 효과, 이름표, 초상화, 선택지. 긴 글은 단어 단위로 줄바꿈되고 다음 페이지로 넘어간다
Dialog.say("오랜만이야! 마을에 온 걸 환영해.", { name = "촌장", portrait = "elder" })
Dialog.say({ "첫 페이지", "두 번째 페이지" }, { onDone = function() ... end })
Dialog.ask("숲으로 갈래?", { "갈게요", "나중에요" }, function(i) ... end)

function update(dt)
  if Dialog.active() then return end     -- 대화 중에는 게임을 멈춘다
  ...
end
function draw()
  ...
  Dialog.draw()                          -- 맨 마지막에 (화면 좌표로 그린다)
end
```

- 넘기기: Z / Space / 패드 A / 클릭. 선택지: 위아래 또는 마우스. 모양은 `Dialog.style` (`font`, `lines`, `speed`, 색, `sound`).

```lua
-- 메뉴: 키보드·패드·마우스. 슬라이더와 토글도 된다
local menu = UI.menu({ "새 게임", { label = "음악", value = 1, min = 0, max = 1, onChange = function(v) volume("music", v) end }, "끝내기" })
local pick = menu:update()          -- 고른 항목 번호 (없으면 nil)
menu:draw(W / 2, 80)

-- 일시정지 화면 (Enter / Esc / 패드 Start): 계속하기, 음악·효과음 크기, 전체 화면
if UI.pause.update() then return end  -- update 맨 앞
UI.pause.draw()                       -- draw 맨 끝

UI.button("OK", x, y, w, h)           -- 클릭하면 true
UI.bar(x, y, w, h, hp, maxHp, "#b13e53")
UI.toast("저장했습니다")                -- 잠깐 뜨는 알림, UI.draw()로 그린다
```

- 일시정지 중에는 `Timer`, `Tween`, 카메라 흔들림, 대화가 멈춘다. 문구는 바꿀 수 있다 (`UI.pause.title = "일시정지"`, `UI.pause.menu.items[1].label = "계속하기"`).
- 템플릿 3종에는 일시정지 화면이 이미 들어 있다.

```lua
-- 에디터 UI 탭에서 만든 화면
function draw()
  ...
  Cam.reset()
  local clicked = UI.screen("hud")      -- 버튼이 눌린 프레임에 그 버튼의 id를 돌려준다
end

-- 설정 화면 (음악, 효과음, 전체 화면; 다음 실행에도 유지)
UI.settings.show()
if UI.settings.update() then return end   -- 열려 있는 동안 update에서
UI.settings.draw()                         -- draw 마지막에

-- 저장 슬롯 화면
UI.slots.show({ title = "LOAD", allowEmpty = false, onPick = function(n, empty) ... end })
if UI.slots.update() then return end
UI.slots.draw()
```

- 화면 속 텍스트는 게임 값을 보여 준다: `{score}`, `{G.coins}` (전역 변수나 그 필드).
- `UI.settings`나 일시정지 화면에서 바꾼 설정은 저장되어 다음 실행 때 적용된다.

### 저장 슬롯 (`Save`)

```lua
Save.use(2)                          -- 쓸 슬롯 (기본 1; Save.slots = 3)
Save.set("level", "level3")         -- 바로 저장된다
Save.get("level", "level1")         -- 없으면 기본값
Save.label("레벨 3 · 보석 12개")     -- 슬롯 화면에 표시
Save.info(n)                         -- { time, label }, 비어 있으면 nil
Save.clear(n)
```

## 레벨, 문, 행동

```lua
Level.player = hero                  -- 박스 {x, y, w, h}
Level.start("level1")                -- 첫 맵 (테스트 중에는 "Play from here" 위치)
Level.go("cave", "entrance")         -- 다른 맵의, 이름(또는 종류)이 "entrance"인 오브젝트 위치로
Level.onEnter = function(map) ... end

function update(dt)
  Actors.update(dt, hero)             -- 행동이 있는 오브젝트를 모두 움직인다
end
function draw()
  Cam.apply()
  map(Level.current)
  Actors.draw()
end
```

Map 탭에서 오브젝트의 행동을 고르거나 prop `behavior`를 적는다. 나머지 prop으로 조절한다.

| 행동 | 하는 일 | Props (기본값) |
|---|---|---|
| `patrol` | 걸어 다니다 벽·낭떠러지에서 돈다 | `speed=30` `gravity=500` |
| `chase` | 플레이어가 가까우면 쫓아온다 | `speed=40` `range=120` |
| `shoot` | 플레이어가 가까우면 쏜다 | `rate=1.5` `range=150` `bulletSpeed=100` `bullet=(스프라이트)` |
| `pickup` | 닿으면 획득 | `value=1` `sound=coin` |
| `hazard` | 닿으면 피해 | |
| `door` | 다른 맵으로 이동 | `target=(맵)` `to=(시작 위치 이름)` `key=up` (또는 `none`) |
| `bob` | 위아래로 둥실둥실 | `height=3` |

- 이벤트: `Actors.onPickup(a)`, `Actors.onHurt(a)`, `Actors.onStomp(a)` (횡스크롤에서 적을 밟았을 때), `Actors.onDoor(a)`. `Actors.collected[type]`에 획득 수가 쌓인다.
- 탑다운 게임은 `Actors.view = "top"` (중력 없음, 추적은 `Path`로 벽을 돌아간다). 기본값은 `"side"`.

## 길찾기 (`Path`)

벽(타일 플래그 bit 0, `Physics`와 같은 기준)을 피해 가는 길을 찾는다.

```lua
-- 적이 플레이어를 쫓아간다: 이 한 줄이면 벽을 돌아서 온다
Path.chase(enemy, player.x, player.y, 40, dt, "level1")   -- enemy = {x, y, w, h}, 속도 40px/초

local dx, dy, dist = Path.toward("level1", ex, ey, px, py) -- 지금 움직일 방향 (길이 없으면 nil)
local pts = Path.find("level1", ex, ey, px, py)           -- 경유점 { {x, y}, ... } 또는 nil
local tiles = Path.dist("level1", ex, ey, px, py)         -- 걸어서 몇 타일인지, 못 가면 nil
```

- 옵션: `{ bit = 0, diagonal = true }`. `diagonal = false`면 상하좌우로만 다닌다 (턴제·로그라이크).
- 목표가 보이면 곧장 직선으로 간다. 안 보이면 목표 쪽에서 거리 지도를 한 번 펼쳐서 **같은 목표를 쫓는 적 전부가 함께 쓴다** (적이 100마리여도 계산은 한 번). 각자 지도를 따라 내려가면서 보이는 가장 먼 칸을 향해 움직이므로 계단처럼 꺾이지 않고 비스듬히 자연스럽게 움직인다.
- `Path.find`는 A*로 찾은 길을 서로 보이는 지점끼리 이어서 짧은 직선 몇 개로 돌려준다.
- 맵이 바뀌면 (`mset`, 에디터 수정) 자동으로 다시 계산한다.

## 화면 효과 (`Fx`)

`draw()` 다음에 화면 전체에 적용된다 (HUD 포함).

```lua
Fx.flash("#ffffff", 0.1)        -- 번쩍 (피격, 폭발)
Fx.freeze(0.06)                 -- 히트스톱: 아주 잠깐 게임이 멈춘다. 타격감의 핵심
Fx.fade("#000000", 0.5, function() Scene.go("next") end)  -- 그 색으로 어두워지고 유지, Fx.fade(nil, 0.5)로 다시 밝게
Fx.tint("#1a2a6c", 0.35)        -- 화면에 색을 덮는다 (밤, 물속). Fx.tint()로 끔
```

### 셰이더 효과

GPU 셰이더로 화면 전체를 바꾼다. 창 크기와 상관없이 매끄럽고, 다 꺼져 있으면 비용이 없다.

```lua
Fx.effect("crt", 1)                       -- 켜기. 0이나 nil이면 끔
Fx.effect("grayscale", 1, 0.5)            -- 0.5초 동안 서서히
Fx.effect({ vignette = 0.6, bloom = 0.5 })
Fx.shockwave(x, y)                        -- 그 지점에서 퍼지는 충격파 (맵 좌표, 카메라 반영). { speed, size, strength }
Fx.glitch(0.3)                            -- 잠깐 화면이 지직거린다
Fx.reset()                                -- 전부 끄기
```

| 효과 | 값 | 설명 |
|---|---|---|
| `crt` | 0~1 | 브라운관: 휘어진 화면 + 주사선 + 가장자리 어둡게 |
| `scanlines` `vignette` | 0~1 | 주사선만 / 가장자리 어둡게만 |
| `aberration` | 픽셀 (1~3) | 빨강·파랑이 어긋나는 색수차 |
| `bloom` | 0~1 | 밝은 곳이 번져 빛난다 |
| `grayscale` `sepia` `invert` | 0~1 | 흑백 / 세피아 / 반전 |
| `brightness` `contrast` `saturation` | 1 = 그대로 | 밝기 / 대비 / 채도 |
| `hue` | 0~1 | 색상 회전 |
| `posterize` | 단계 수 (예: 4) | 색 단계를 줄인다 |
| `pixelate` | 픽셀 크기 (예: 4) | 모자이크 |
| `wave` | 픽셀 | 화면이 물결처럼 흔들린다 |
| `noise` | 0~1 | 필름 노이즈 |

직접 쓴 셰이더도 된다 (GLSL ES 1.0, `main()`만 쓰면 된다). `uv`, `Texture`, `time`, `resolution`과 `tex(uv)`, `rand(p)`를 쓸 수 있다. `Fx.shader(nil)`로 원래대로.

```lua
Fx.shader([[
void main() {
  vec3 c = tex(uv);
  gl_FragColor = vec4(c * (0.8 + 0.2 * sin(time * 3.0)), 1.0);
}
]])
```

## 글자 효과 (`Text`)

```lua
Text.draw("GAME OVER", W / 2, 40, "#ffffff", { align = "center", wave = 2 })
Text.draw("{shake}무서워!{/} 저기 {rainbow}무지개{/}가 있어", 8, 8, "#ffffff")
local done = Text.draw(story, 8, 60, "#ffffff", { typing = 30, start = shownAt })  -- 한 글자씩 (start = 시작한 t())
```

- 효과: `wave` (물결), `shake` (덜덜), `rainbow` (무지개), `bounce` (통통), `blink` (깜빡). 옵션으로 문자열 전체에, 또는 글 안에 `{wave}...{/}`로 일부에만. 숫자로 세기: `{wave=4}` `{shake=2}`.
- 색: `{#ff0044}빨강{/}` 또는 `{color=#ff0044}`.
- 그 밖의 옵션: `scale`, `font`, `outline`, `align`. `typing`이면 막 나온 글자가 살짝 올라오며 나타난다 (`pop = false`로 끔).
- `Dialog.say`의 글에도 같은 표시를 쓸 수 있다: `Dialog.say("{shake}으악!{/} 살려줘")`.
- `Text.width(s)`, `Text.len(s)` (표시 빼고 글자 수), `Text.strip(s)`.

## "Play from here" 테스트

맵 탭에서 **Play from here**(또는 맵 위에서 `P`)를 누르고 시작할 곳을 클릭하면 게임이 그 맵, 그 위치에서 시작한다.

- 그 맵의 `player` / `start` / `spawn` / `hero` 오브젝트가 클릭한 곳으로 옮겨진 채로 실행된다. 플레이어를 이 오브젝트에서 만드는 게임이라면 코드를 고치지 않아도 된다.
- 타이틀 화면을 건너뛰려면 `playtest()`를 확인한다. 템플릿은 이미 이렇게 되어 있다.

```lua
Scene.go(if playtest() then "play" else "title")
local pt = playtest()     -- { map = "level1", x = 120, y = 64 } 또는 nil
```

## 글꼴

- 기본은 영문 픽셀 폰트(`pico`)이고, 한글 등 그 밖의 글자는 자동으로 ERXPIXEL로 그린다.
- `font("erx")`: 전체를 ERXPIXEL A로 (`erx_b` = B, `erx_gl` = 확장 글리프). 12px.
- ERXPIXEL은 **SIL Open Font License 1.1**: 게임에 넣어 배포·판매해도 된다. 글꼴 파일만 따로 파는 것은 안 됨. 내보낸 게임에서 `게임.exe --licenses`로 라이선스 전문을 `slate-licenses.txt`에 쓴다.

## 타일맵과 오브젝트 (코드)

- 타일 플래그는 `sprites/tiles.json`의 `flags` (bit 0 = 단단함 등). `msolid(map, px, py, bit)`, `fget(tileset, tile, bit)`로 읽는다.
- 맵 하나에 타일셋을 여러 개 쓰면 `mget` 값은 `타일셋 순서 × 4096 + 프레임`이다 (첫 타일셋은 그냥 프레임 번호). 플래그는 `fget(맵 이름, mget 값, bit)`로 읽으면 알아서 맞는 타일셋을 본다. `mapinfo(name).tilesets`에 순서대로 들어 있다.
- 맵에 놓은 오브젝트: `for _, o in objects("level1", "enemy") do ... end` (x, y = 아래 가운데, 맵 픽셀).
- 오브젝트 템플릿으로 놓은 것은 템플릿의 종류·스프라이트·속성이 채워져서 오고, `o.template`에 템플릿 이름이 있다.
- 배경 레이어(스크롤 속도가 1이 아닌 레이어)는 `msolid`·`Physics`·`Path`에서 벽으로 치지 않는다.
