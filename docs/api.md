# 게임 코드 API

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

## 글꼴

- 기본은 영문 픽셀 폰트(`pico`)이고, 한글 등 그 밖의 글자는 자동으로 ERXPIXEL로 그린다.
- `font("erx")`: 전체를 ERXPIXEL A로 (`erx_b` = B, `erx_gl` = 확장 글리프). 12px.
- ERXPIXEL은 **SIL Open Font License 1.1**: 게임에 넣어 배포·판매해도 된다. 글꼴 파일만 따로 파는 것은 안 됨. 내보낸 게임에서 `게임.exe --licenses`로 라이선스 전문을 `slate-licenses.txt`에 쓴다.

## 타일맵과 오브젝트 (코드)

- 타일 플래그는 `sprites/tiles.json`의 `flags` (bit 0 = 단단함 등). `msolid(map, px, py, bit)`, `fget(tileset, tile, bit)`로 읽는다.
- 맵에 놓은 오브젝트: `for _, o in objects("level1", "enemy") do ... end` (x, y = 아래 가운데, 맵 픽셀).
