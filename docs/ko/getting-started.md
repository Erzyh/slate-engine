# 10분 안에 첫 게임 만들기

[English](../en/getting-started.md) · **한국어**

게임잼 첫날, 팀원 모두가 Slate를 처음 쓴다고 가정한 안내서다.

## 1. 템플릿으로 시작하기

1. Slate를 설치하고 실행한다 ([Releases](https://github.com/Erzyh/slate-engine/releases)).
2. **File > New from template > Platformer**를 고르고 이름을 정한다.
3. **File > Save project as…**로 폴더를 고른다. 이 폴더가 곧 프로젝트다 (Git으로 관리하면 된다).
4. **Space**(Play)를 누르면 오른쪽 Game 패널에서 게임이 실행된다. 방향키로 움직이고 Z로 점프한다.

템플릿은 세 가지다.

| 템플릿 | 이런 게임에 |
|---|---|
| Platformer | 횡스크롤 액션, 퍼즐 플랫포머 |
| Top-down | 젤다풍 탐험, 로그라이크, 탑다운 슈터 |
| Shooter | 세로 슈팅, 탄막, 무한 생존 |

## 2. 그림 바꾸기 (Pixel 탭)

- 왼쪽 탐색기에서 `sprites/hero`를 클릭한다.
- 연필(`B`)로 찍고, 지우개(`E`), 채우기(`G`), 스포이트(`I`)를 쓴다.
- **게임을 켜 둔 채로** 그려도 된다. 그리는 대로 게임 화면에 바로 반영된다 (재시작 없음).
- 애니메이션: 아래 타임라인에서 프레임을 추가하고, 프레임마다 시간(ms)을 정하고, 구간에 태그(`idle`, `run`…)를 붙인다. 코드에서는 태그 이름으로 재생한다.

```lua
local anim = Anim.new("hero", "idle")
anim:play("run")          -- 태그 바꾸기
anim:update(dt)
anim:draw(x, y, { flipX = facingLeft })
```

## 3. 레벨 바꾸기 (Map 탭)

- `maps/level1`을 클릭한다. 팔레트에서 타일을 골라 칠한다.
- **오브젝트 도구(`O`)**로 동전, 적, 시작점, 골을 놓는다. Type 이름이 코드에서 찾는 이름이다 (`objects("level1", "coin")`).
- 어떤 타일이 벽인지는 **타일 플래그**로 정한다: 플래그 0 = 단단함, 1 = 위로만 통과하는 발판, 2 = 가시(템플릿 기준).

## 4. 코드 바꾸기 (Code 탭)

- `scripts/player.luau` 맨 위의 숫자를 바꿔 본다: `JUMP = 285` → `400`.
- **Ctrl+Enter**로 게임을 다시 시작하면 반영된다.
- 에러가 나면 아래 콘솔에 `scripts/player.luau:42: ...`처럼 나오고, 클릭하면 그 줄로 간다.
- `log(값)`은 콘솔에 찍힌다.

파일 나누기: `scripts/enemies/bat.luau`를 만들고 맨 끝에 `return Bat`, 쓰는 쪽에서 `local Bat = require("enemies/bat")`.

## 5. 소리

- 효과음: 탐색기에서 `sounds` 우클릭 → **New sound effect** → 프리셋 고르고 다듬어서 저장 → `sfx("이름")`.
- 음악: `music` 우클릭 → **New music**으로 곡을 만들거나, `.ogg` 파일을 `music/`에 넣고 `music("이름")`.

## 6. 제출하기

| 어디에 | 방법 |
|---|---|
| itch.io (브라우저에서 바로 플레이) | Export > **Web game for itch.io (.zip)** → itch.io에서 Kind = HTML로 zip 업로드 |
| Windows 실행 파일 | Export > **Windows game (.exe)** → exe 하나만 보내면 된다 |
| 소스 공유 | 프로젝트 폴더를 Git에 올리거나 Export > Cartridge (.slate) |

## 팀으로 작업할 때

- 프로젝트 폴더를 Git 저장소로 만든다. 그림·맵·코드가 모두 따로 된 파일이라 충돌이 적다.
- 역할을 파일 단위로 나눈다: 아트는 `sprites/`, 레벨 디자인은 `maps/`, 프로그래머는 `scripts/`.
- 큰 그림 파일 하나를 여럿이 동시에 고치지 않는다 (PNG는 병합이 안 된다).

## 한 장 요약

| 하고 싶은 것 | 코드 |
|---|---|
| 입력 | `btn("a")` 누르는 중, `btnp("a")` 이번에 누름, `axis("x")` -1..1 (키보드·게임패드 공통) |
| 그리기 | `cls(c)` `spr(name, x, y, opts)` `map(name, x, y)` `text(s, x, y, c)` `rect` `circ` `line` |
| 충돌 | `Physics.move(box, dx, dy, map)` `Physics.grounded(box, map)` `Physics.overlap(a, b)` |
| 카메라 | `Cam.follow(x, y, dt, { bounds = map })` `Cam.shake(3, 0.2)` `Cam.apply()` … `Cam.reset()` |
| 시간 | `Timer.after(1, fn)` `Timer.every(0.5, fn)` `Tween.to(obj, 0.3, { y = 10 }, { ease = "outBack" })` |
| 화면 전환 | `Scene.add("title", { enter, update, draw })` `Scene.go("play", nil, { fade = 0.3 })` |
| 효과 | `local fx = Particles.new()` `fx:burst(x, y, "explosion")` `Fx.flash()` `Fx.effect("crt", 1)` |
| 소리 | `sfx("jump")` `music("theme", { fade = 1 })` |
| 저장 | `save("best", 1200)` `load("best", 0)` |
| 한글 | `font("erx")` 후 `text("안녕", x, y, c)` |
| 대화 | `Dialog.say("안녕!", { name = "촌장" })` `Dialog.ask("갈래?", { "응", "아니" }, fn)` `Dialog.draw()` |
| 메뉴 | `UI.menu(items)` `UI.pause.update()` / `UI.pause.draw()` `UI.toast("저장!")` |
| 적이 쫓아오기 | `Path.chase(enemy, player.x, player.y, 40, dt, "level1")` |

전체 API는 [게임 코드 API](api.md)에 있다.
