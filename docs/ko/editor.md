# 에디터

[English](../en/editor.md) · **한국어**

## 프로젝트 = 폴더

프로젝트는 평범한 파일들이 담긴 폴더다. Git으로 관리하고, 다른 그림 툴이나 텍스트 에디터로 열어도 된다.

```
my-game/
  slate.json              { "name", "title", "resolution": [320, 180], "background", "main": "scripts/main.luau" }
  scripts/                Luau 코드. main.luau가 먼저 실행되고, 나머지는 require("이름")으로 불러온다
    main.luau
    player.luau
    enemies/beetle.luau   → require("enemies/beetle")
  sprites/                스프라이트 = PNG 한 장 (프레임이 여러 개면 가로로 이어 붙인 시트)
    hero.png
    hero.json             (선택) { "w", "h", "fps", "durations", "tags", "flags", "box", "layers" }
    hero.layers.png       (선택) 에디터용 레이어 원본 (행 = 레이어, 열 = 프레임)
  maps/level1.json        타일맵 + 배치한 오브젝트
  music/theme.ogg         music("theme")
  sounds/jump.wav         sfx("jump")
```

- 하위 폴더는 정리용이다. 스프라이트/맵/소리의 이름은 파일 이름이다 (`sprites/enemies/beetle.png` → `spr("beetle", ...)`).
- 에디터에서 지운 파일은 저장할 때 프로젝트 안의 `.slate-trash/` 로 옮겨진다 (바로 삭제되지 않음).
- `.slate` 파일 = 프로젝트 전체를 한 파일로 묶은 카트리지 (예제, 공유, 실행용). File > Import로 열 수 있다.
- `slate.json`에는 프로젝트 팔레트, 파티클 프리셋, 오브젝트 템플릿도 저장된다.
- **화면 채우기** (Project settings, `slate.json`의 `"scale"`): `"pixel"`(기본)은 정수배로만 키워서 선명하지만 검은 여백이 생길 수 있다. `"fit"`은 아무 배율로 화면에 맞춘다. `"expand"`는 선명함을 유지하면서 게임 화면 자체를 넓혀 꽉 채운다. 이때 `W`, `H`가 해상도보다 커질 수 있으니 `W`, `H` 기준으로 그리거나, 원래 크기의 무대를 가운데에 둔다.
- `"touchControls": false`: 휴대폰에서 화면 방향키·버튼을 숨긴다 (탭으로 하는 게임).

## 화면 구성

| 영역 | 내용 |
|---|---|
| 탐색기 (왼쪽) | 프로젝트 폴더 트리. 클릭하면 열림(스크립트 → Code, 스프라이트 → Pixel, 맵 → Map). 우클릭/`+`: 새 스크립트·스프라이트·맵·폴더, 파일 가져오기, 이름 변경, 삭제, "Run first(main)". 저장 안 된 파일은 ● 표시. 파일을 창에 끌어다 놓아도 가져온다 |
| Pixel | 픽셀 에디터 (아래 표) |
| Map | 타일맵 칠하기 + 오브젝트 배치 |
| UI (`4`) | HUD·메뉴 화면 배치 (아래) |
| Code | 파일별 탭, Luau 문법 강조, 줄 번호, API·`require` 경로 자동완성, 찾기(`Ctrl+F`). 아래 **콘솔**에 게임의 `log()` 출력과 에러가 나오고, 에러를 클릭하면 그 파일의 그 줄로 이동 |
| Play (`Space`) | 게임이 오른쪽 **Game 패널**에서 실행된다 (View → Play in the Game view를 끄면 별도 창). 도트·맵 수정은 **게임을 끄지 않고** 바로 반영, 코드는 `Ctrl+Enter`로 재시작 |
| Game 패널 녹화 | Screenshot(`F8`): 지금 화면을 PNG로. Record GIF(`F9`): 다시 누르면 멈추고 GIF로 저장 (최대 20초, 보기 좋게 확대됨). itch.io 페이지·홍보용 |
| Game 패널 | Pause / Step(`F6` / `F7`): 게임 시간을 멈추고 한 프레임씩 넘긴다. Hitboxes: `Physics`를 거친 박스를 초록 테두리로, 단단한 타일을 빨갛게 보여 준다. Stats: FPS와 그리기 수 |
| File | 새 프로젝트, 폴더 열기(`Ctrl+O`), 다른 이름으로 저장, `.slate` 가져오기. `Ctrl+S` 저장(바뀐 파일만 씀) |
| Export | Windows 게임(.exe, 단독 실행 파일 하나), macOS / Linux 게임(.zip), Android 앱(.apk), 웹 게임(itch.io용 .zip), 카트리지(.slate) |

## 픽셀 에디터

| 기능 | 내용 |
|---|---|
| 도구 | 펜 `B`, 지우개 `E`, 채우기 `G`(Shift: 같은 색 전부), 스포이트 `I`, 직선 `L`, 사각형 `U`, 원 `O`(Shift: 채움), 사각형 선택 `M`, 올가미 `Q`, 마술봉 `W`, 충돌 박스 `H` |
| 충돌 박스 | Hitbox 도구로 끌어서 그린다 (안쪽을 끌면 이동, 핸들로 크기). Fit to pixels = 그려진 픽셀에 딱 맞게. 코드에서 `hitbox("hero", x, y)` |
| 가져오기 | Sprite → Import Aseprite file: `.aseprite` / `.ase`의 레이어, 프레임 시간, 태그를 그대로 가져온다 |
| 펜 옵션 | 브러시 크기 `[` `]`, 사각형/원형 브러시, 픽셀 퍼펙트, 디더, 좌우/상하 대칭, 밝은 배경(Light BG) |
| 선택 | Shift: 영역 추가, Alt: 영역 빼기. 마술봉은 같은 색 영역(Contiguous를 끄면 그 색 전부). 선택하면 그 안에만 칠해진다 |
| 선택 영역 편집 | 안쪽을 끌어 이동, 방향키로 1px 이동, 모서리 핸들로 크기 조절(Shift: 비율 유지), 위쪽 동그란 손잡이로 자유 회전(Shift: 15° 단위, 픽셀이 깨지지 않게 다듬어 돌린다), 뒤집기/90° 회전, 스프라이트 바깥 빈 곳을 클릭하면 선택 해제, 채우기 `Alt+Backspace`, 지우기 `Del`, 반전 `Ctrl+Shift+I`, `Ctrl+C/X/V`, `Ctrl+A`, `Esc` |
| 화면 | 휠: 확대/축소(커서 기준), Shift+휠: 가로 스크롤, 휠 버튼 드래그: 화면 이동 |
| 레이어 | 추가/복제/삭제/순서/병합, 보이기, 불투명도, 잠금, 투명 잠금(칠해진 픽셀만 칠해짐, 음영용) |
| 프레임 | 추가/복제/삭제, 끌어서 순서 바꾸기(Shift+클릭으로 범위 선택), 어니언 스킨, `,` `.` 로 이동, `Enter` 로 재생. 우클릭, 또는 타임라인을 클릭한 뒤 `Ctrl+C/X/V` / `Del`: 복사, 잘라내기, 뒤에 붙여넣기, 복제, 삭제. 다른 스프라이트에도 붙여넣을 수 있다 (크기가 다르면 가운데 정렬) |
| 프레임 시간 | 프레임마다 지속 시간(ms) 지정. 비워 두면 FPS를 따른다. Shift+클릭으로 여러 프레임에 한 번에 |
| 태그 | 프레임 범위에 이름 붙이기 (`idle`, `walk`…). 정방향/역방향/핑퐁 |
| Image… | 뒤집기, 회전, 외곽선, 색 교체, 색 조정(색조/채도/명도/밝기/대비), ×2/×½, 캔버스 크기, 여백 자르기 |
| Sheet… | 스프라이트 시트 PNG + JSON(Aseprite 형식) 내보내기, GIF, 시트 가져오기 |
| 되돌리기 | `Ctrl+Z` / `Ctrl+Shift+Z` |

## UI 편집기

UI 탭에서 게임이 `UI.screen("hud")`로 그리는 화면(HUD, 타이틀 메뉴, 게임 오버 화면)을 배치한다.

- 위쪽에서 화면 추가 / 이름 변경 / 삭제. 미리보기는 게임 해상도로, 첫 번째 맵 위에 화면을 보여 준다.
- 도구 막대에서 요소 추가: **panel**(상자), **text**, **sprite**, **bar**, **button**. 끌어서 이동, 모서리 핸들로 크기 조절. 방향키 1px 이동(Shift: 8), `Ctrl+D` 복제, `Del` 삭제, `Ctrl+Z` 되돌리기.
- 게임 값 표시: 텍스트에 `{score}`, `{G.coins}`라고 쓰면 지금 값이 나온다. 스프라이트의 **Repeat**는 그 수만큼 반복해서 그린다(`hp` → 체력 하나당 하트 하나). 바는 **Value** / **Max**(`hp`, `maxHp`)만큼 찬다. **Visible**에 값을 적으면 그 값이 false나 0일 때 숨는다.
- 버튼에는 **id**가 있다: 버튼이 눌린 프레임에 `UI.screen("title")`이 그 id를 돌려준다.
- **Anchor(기준점)**: X / Y를 화면의 어느 모서리·변·가운데에서 잴지. 오른쪽 위 점수에 Top right를 주면 해상도를 바꿔도 오른쪽 위에 붙어 있다.
- **Preview values**: 한 줄에 `이름=값` 하나씩(`G.score=1200`) 적으면 그 값일 때 화면이 어떻게 보이는지 확인할 수 있다 (게임에는 저장되지 않음).

## 파티클 편집기

Project → Particles. 왼쪽 Start from(폭발, 반짝임, 타격, 먼지, 연기, 불)에서 시작해서 슬라이더로 다듬는다. 미리보기를 클릭하면 그 자리에서 터진다. 만든 프리셋은 `slate.json`에 저장되고 코드에서 `fx:burst(x, y, "이름")` (Rate가 있으면 `fx:emit(x, y, "이름", dt)`)로 쓴다.

## 코드 편집기

- 자동완성: `Path.`까지 치면 그 모듈의 함수가, `spr("`·`map("`·`sfx("`·`music("`·`Fx.effect("`·`Scene.go("` 안에서는 프로젝트의 스프라이트·맵·소리·효과·장면 이름이 나온다.
- 함수 이름에 마우스를 올리면 사용법과 설명이 뜬다.

## 맵 에디터

- **타일셋 = 프레임이 여러 개인 스프라이트** (프레임 1개 = 타일 1개). 타일 플래그(bit 0 = 단단함 등)는 `sprites/tiles.json`의 `flags`.
- **Map 탭**: 칠하기 `B`, 지우기 `E`(우클릭), 채우기 `G`, 사각형 `U`, 스포이트 `I`. 팔레트에서 Shift+드래그로 여러 타일 브러시. 맵 레이어 여러 개. 휠로 확대/축소, 휠 버튼 드래그로 화면 이동.
- **타일셋 여러 개**: Tiles 옆 `+`로, 또는 파일 목록의 스프라이트를 Tiles 칸으로 끌어다 놓아 타일셋을 더한다 (타일 크기가 같은 것만). 위의 탭으로 칠할 타일셋을 고르고, 이미 칠한 타일은 바뀌지 않는다. 탭 우클릭 → 맵에서 빼기.
- **오토타일**: 16칸을 4×4로 그린다 (왼쪽 위 3×3 = 넓은 면의 모서리·가장자리·가운데, 오른쪽 열 = 1칸 폭 기둥의 위·가운데·아래, 아래 행 = 1칸 높이 발판의 왼쪽·가운데·오른쪽, 오른쪽 아래 = 홀로). 팔레트에서 그 4×4를 Shift+드래그로 고르고 우클릭 → Make autotile. Autotile이 켜져 있으면 그중 아무 타일로 칠해도 이웃에 맞는 조각이 알아서 골라진다.
- **움직이는 타일**: 팔레트에서 프레임이 될 타일들을 Shift+드래그로 고르고 우클릭 → Make animated tile. 그 타일들이 놓인 곳마다 차례로 바뀐다 (물, 용암, 횃불).
- **배경 레이어**: 레이어를 더블클릭(또는 우클릭 → Layer settings) → Scroll speed. 0.5면 카메라의 절반 속도로 움직이는 먼 배경, 0이면 고정. Repeat sideways를 켜면 가로로 끝없이 반복된다. 배경 레이어는 충돌하지 않는다.
- **오브젝트 템플릿**: 오브젝트를 고르고 Save as template → Object 칸에 템플릿이 생긴다. 템플릿을 누르고 맵을 클릭하거나 맵으로 끌어다 놓으면 복사본이 놓이고, 템플릿의 종류·스프라이트를 바꾸면 모든 복사본이 바뀐다. Props 칸은 그 복사본만의 값. Detach = 일반 오브젝트로.
- **행동(Behavior)**: Object 칸에서 고르면(patrol, chase, shoot, pickup, hazard, door, bob) `Actors`가 오브젝트를 알아서 움직인다 ([API](api.md#레벨-문-행동)). 필요한 설정이 기본값과 함께 Props에 적히므로 숫자만 고치면 된다.
- **새 맵**: 타일 목록에서 기본 타일셋(platformer, top-down)을 고르면 프로젝트에 복사되어 바로 칠할 수 있다.
- **스프라이트 끌어다 놓기**: 왼쪽 파일 목록의 스프라이트를 맵 위로 끌어다 놓으면 그 자리에 오브젝트로 놓인다 (종류 = 스프라이트 이름).
- **Play from here** (`P`): 맵에서 시작할 곳을 클릭하면 거기서 게임이 시작된다 ([API](api.md#play-from-here-테스트)).
- **벽 도구 `C`**: 타일을 클릭하거나 드래그하면 그 타일이 벽이 되거나 풀린다 (타일의 플래그를 바꾸므로 같은 타일은 모두 바뀐다). 맵 위쪽의 **Collision**을 켜면 벽 칸이 빨갛게 보인다.
- **오브젝트 도구 `O`**: 적/아이템/시작점을 맵에 놓는다. 클릭 = 배치, 드래그 = 이동, 우클릭/`Del` = 삭제. Type, Sprite, Props(`hp=10`) 편집. Type 아래에는 코드가 찾는 종류(`objects(map, "enemy")`, `o.type == "coin"`)와 이미 놓인 종류가 추천 칩으로 뜬다. 코드에서 `for _, o in objects("level1", "enemy") do ... end`.

## 소리

- 효과음: `sounds/`에 `.wav`/`.ogg`를 넣고 `sfx("이름")`.
- **효과음 만들기**: 탐색기에서 `sounds` 우클릭 → *New sound effect*. 프리셋(coin, laser, explosion, powerup, hit, jump, blip)을 고르고 슬라이더로 다듬거나 Mutate / Random → *Save to sounds/* (`.wav`). 탐색기에서 소리 파일을 클릭하면 들어볼 수 있다.
- **음악 만들기**: 탐색기에서 `music` 우클릭 → *New music*. 스타일을 고르고 마음에 들 때까지 New melody를 누른 뒤, 곡과 악기를 다듬어 저장한다.
- 음악 파일: `music/`에 `.ogg`/`.wav`를 넣고 `music("이름")`.

## Grid Stamp와 플러그인

- **Grid Stamp**: "픽셀아트 풍" 이미지(AI 생성 등)를 진짜 픽셀 격자에 맞춰 찍는다. 배경 제거 → 격자 검출(푸리에 + Viterbi) → 칸마다 대표색 → OKLab 팔레트 → 정리. 이음새 없는 타일 만들기도 지원.
- **플러그인**: 선택 설치(Plugins → Install from folder…). 샌드박스 iframe에서 실행되고, 선언한 호스트로만 네트워크 접근 가능.

## 템플릿

File > **New from template**로 바로 돌아가는 게임 하나를 받아서 고쳐 나간다. 셋 다 그림은 손으로 찍은 도트이고, 코드는 파일 3~4개.

| 템플릿 | 내용 |
|---|---|
| `templates/platformer` | 달리기·점프(코요테 타임, 점프 버퍼, 길게 누르면 높이), 밟아서 잡는 슬라임, 동전, 가시, 깃발 골인, 하트 3개, 패럴랙스 배경. `player.luau` 맨 위 숫자로 조작감 조절 |
| `templates/topdown` | 8방향 이동, 칼 휘두르기, 쫓아오는 박쥐(2방), 보석 모으기, 물·벽·나무 충돌 |
| `templates/shmup` | 세로 슈팅. 자동 발사, 작은 피격 판정, 점점 어려워지는 웨이브, 최고 점수 저장(`save`/`load`) |

## 예제

상단의 Examples 메뉴에서 연다.

| 프로젝트 | 내용 |
|---|---|
| `games/jelly` | **Jelly Jump**: 플랫포머. 도트는 전부 손으로 설계(AI 없음). 젤리는 스프라이트 1장에 찌그러짐·늘어남·출렁임을 코드로, 딱정벌레는 2프레임 걷기 애니메이션(`Anim`). 모듈 방식 스크립트 7개. 개발용 F2 깃발로, F8 자동 조종 |
| `games/star-barrage` | **Star Barrage**: 세로 탄막 슈팅. 스테이지 5개 + 무한 루프, 보스 10마리(페이즈 31개), 탄막 패턴 17종, 영구 업그레이드 16종, 사운드트랙 10곡(Slate Synth). 스테이지 = 맵 `stage1~5`의 오브젝트. 개발용 F2/F3/F4/F6 (`scripts/data.luau` 참고) |

## 언어

파일 목록 우클릭 → **New language**로 `lang/<코드>.json`을 만든다 (번역하기 쉽게 첫 언어를 복사). 코드 탭에서 고치고, 게임에서는 `tr("key")`로 플레이어 언어의 문장을 쓴다 ([API](api.md#언어)).

## 명령줄

에디터 없이 프로젝트를 빌드·실행·테스트한다 (`slate.json`이 있는 폴더라면 Slate 폴더 밖이어도 된다):

```
node <slate>/tools/slate.mjs new my-game --template topdown
node <slate>/tools/slate.mjs run my-game --watch      # 아무 편집기에서 저장해도 실행 중인 게임에 반영
node <slate>/tools/slate.mjs test my-game --script tests/balance.luau
node <slate>/tools/slate.mjs export my-game --exe     # my-game/build/<제목>.exe
```

Slate 폴더 안에서는 `npx slate ...`도 된다.

## macOS, Linux, Android로 내보내기

- **macOS game (.zip)**: 압축을 풀면 나오는 `.app`이 게임이다. Apple 서명이 없어서 처음 실행할 때는 우클릭 → 열기.
- **Linux game (.zip)**: 압축을 풀고 안의 프로그램을 실행한다 (`game.slate`가 옆에 있어야 한다).
- macOS·Linux 내보내기에는 그 시스템용 플레이어가 필요하다: macOS·Linux용 Slate에는 세 플레이어가 모두 들어 있고, 플레이어가 없는 빌드에서는 메뉴가 회색으로 표시된다.
- **Android app (.apk)**: 웹 플레이어를 담은 휴대폰 앱. 휴대폰으로 옮겨서 열면 설치된다 (처음에는 그 앱의 설치 허용 필요). 세로가 더 긴 해상도는 세로 화면, 나머지는 가로 화면으로 고정된다. 터치 화면에서는 화면 방향키와 버튼이 나오고, 길게 누르기는 `mouse.long`(휴대폰의 우클릭)이다.
- 앱은 Slate가 `~/.slate/`에 한 번 만들어 두는 키(`android-signing-key.der`)로 서명된다. **꼭 백업해 두자**: 같은 키로 서명해야 새 버전이 기존 앱 위에 업데이트된다. 패키지 이름은 `dev.slate.game.<저장 이름>`.

## 웹 게임으로 내보내기 (itch.io)

웹 빌드는 exe와 같은 플레이어를 WebAssembly로 옮긴 것이라 동작이 똑같다.

- Export > **Web game for itch.io (.zip)**
- itch.io: 새 프로젝트 > Kind of project = **HTML** > zip 업로드 > "This file will be played in the browser" 체크 > Viewport는 해상도의 정수배 (320×180이면 960×540).
- 첫 화면에서 클릭이나 키 입력을 한 번 받는다 (브라우저는 그 전에는 소리를 낼 수 없다).
- 저장(`save`)은 브라우저에 남는다.
- 휴대폰·태블릿에서는 화면에 방향 패드와 A / B / START 버튼이 나온다.
- 최신 Chrome, Edge, Firefox, Safari(18.4 이상)에서 동작한다.
