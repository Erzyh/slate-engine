# 에디터

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
    hero.json             (선택) { "w", "h", "fps", "durations", "tags", "flags", "layers" }
    hero.layers.png       (선택) 에디터용 레이어 원본 (행 = 레이어, 열 = 프레임)
  maps/level1.json        타일맵 + 배치한 오브젝트
  music/theme.ogg         music("theme")
  sounds/jump.wav         sfx("jump")
```

- 하위 폴더는 정리용이다. 스프라이트/맵/소리의 이름은 파일 이름이다 (`sprites/enemies/beetle.png` → `spr("beetle", ...)`).
- 에디터에서 지운 파일은 저장할 때 프로젝트 안의 `.slate-trash/` 로 옮겨진다 (바로 삭제되지 않음).
- `.slate` 파일 = 프로젝트 전체를 한 파일로 묶은 카트리지 (예제, 공유, 실행용). File > Import로 열 수 있다.

## 화면 구성

| 영역 | 내용 |
|---|---|
| 탐색기 (왼쪽) | 프로젝트 폴더 트리. 클릭하면 열림(스크립트 → Code, 스프라이트 → Pixel, 맵 → Map). 우클릭/`+`: 새 스크립트·스프라이트·맵·폴더, 파일 가져오기, 이름 변경, 삭제, "Run first(main)". 저장 안 된 파일은 ● 표시. 파일을 창에 끌어다 놓아도 가져온다 |
| Pixel | 픽셀 에디터 (아래 표) |
| Map | 타일맵 칠하기 + 오브젝트 배치 |
| Code | 파일별 탭, Luau 문법 강조, 줄 번호, API·`require` 경로 자동완성, 찾기(`Ctrl+F`). 아래 **콘솔**에 게임의 `log()` 출력과 에러가 나오고, 에러를 클릭하면 그 파일의 그 줄로 이동 |
| Play (`Space`) | 게임이 별도 창으로 실행된다. 도트·맵 수정은 **게임을 끄지 않고** 바로 반영, 코드는 `Ctrl+Enter`로 재시작 |
| File | 새 프로젝트, 폴더 열기(`Ctrl+O`), 다른 이름으로 저장, `.slate` 가져오기. `Ctrl+S` 저장(바뀐 파일만 씀) |
| Export | Windows 게임(.exe, 단독 실행 파일 하나), 웹 게임(itch.io용 .zip), 카트리지(.slate) |

## 픽셀 에디터

| 기능 | 내용 |
|---|---|
| 도구 | 펜 `B`, 지우개 `E`, 채우기 `G`(Shift: 같은 색 전부), 스포이트 `I`, 직선 `L`, 사각형 `U`, 원 `O`(Shift: 채움), 사각형 선택 `M`, 올가미 `Q`, 마술봉 `W` |
| 펜 옵션 | 브러시 크기 `[` `]`, 사각형/원형 브러시, 픽셀 퍼펙트, 디더, 좌우/상하 대칭, 밝은 배경(Light BG) |
| 선택 | Shift: 영역 추가, Alt: 영역 빼기. 마술봉은 같은 색 영역(Contiguous를 끄면 그 색 전부). 선택하면 그 안에만 칠해진다 |
| 선택 영역 편집 | 안쪽을 끌어 이동, 방향키로 1px 이동, 모서리 핸들로 크기 조절(Shift: 비율 유지), 뒤집기/90° 회전, 채우기 `Alt+Backspace`, 지우기 `Del`, 반전 `Ctrl+Shift+I`, `Ctrl+C/X/V`, `Ctrl+A`, `Esc` |
| 화면 | 휠: 확대/축소(커서 기준), Shift+휠: 가로 스크롤, 휠 버튼 드래그: 화면 이동 |
| 레이어 | 추가/복제/삭제/순서/병합, 보이기, 불투명도, 잠금, 투명 잠금(칠해진 픽셀만 칠해짐, 음영용) |
| 프레임 | 추가/복제/삭제/이동, 어니언 스킨, `,` `.` 로 이동, `Enter` 로 재생 |
| 프레임 시간 | 프레임마다 지속 시간(ms) 지정. 비워 두면 FPS를 따른다. Shift+클릭으로 여러 프레임에 한 번에 |
| 태그 | 프레임 범위에 이름 붙이기 (`idle`, `walk`…). 정방향/역방향/핑퐁 |
| Image… | 뒤집기, 회전, 외곽선, 색 교체, 색 조정(색조/채도/명도/밝기/대비), ×2/×½, 캔버스 크기, 여백 자르기 |
| Sheet… | 스프라이트 시트 PNG + JSON(Aseprite 형식) 내보내기, GIF, 시트 가져오기 |
| 되돌리기 | `Ctrl+Z` / `Ctrl+Shift+Z` |

## 맵 에디터

- **타일셋 = 프레임이 여러 개인 스프라이트** (프레임 1개 = 타일 1개). 타일 플래그(bit 0 = 단단함 등)는 `sprites/tiles.json`의 `flags`.
- **Map 탭**: 칠하기 `B`, 지우기 `E`(우클릭), 채우기 `G`, 사각형 `U`, 스포이트 `I`. 팔레트에서 Shift+드래그로 여러 타일 브러시. 맵 레이어 여러 개. 휠로 확대/축소, 휠 버튼 드래그로 화면 이동.
- **오브젝트 도구 `O`**: 적/아이템/시작점을 맵에 놓는다. 클릭 = 배치, 드래그 = 이동, 우클릭/`Del` = 삭제. Type, Sprite, Props(`hp=10`) 편집. 코드에서 `for _, o in objects("level1", "enemy") do ... end`.

## 소리

- 효과음: `sounds/`에 `.wav`/`.ogg`를 넣고 `sfx("이름")`.
- **효과음 만들기**: 탐색기에서 `sounds` 우클릭 → *New sound effect…*. 프리셋(coin, laser, explosion, powerup, hit, jump, blip)을 고르고 슬라이더로 다듬거나 Mutate / Random → *Save to sounds/* (`.wav`). 탐색기에서 소리 파일을 클릭하면 들어볼 수 있다.
- 음악: `music/`에 `.ogg`/`.wav`를 넣고 `music("이름")`.

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

## 웹 게임으로 내보내기 (itch.io)

웹 빌드는 exe와 같은 플레이어를 WebAssembly로 옮긴 것이라 동작이 똑같다.

- Export > **Web game for itch.io (.zip)**
- itch.io: 새 프로젝트 > Kind of project = **HTML** > zip 업로드 > "This file will be played in the browser" 체크 > Viewport는 해상도의 정수배 (320×180이면 960×540).
- 첫 화면에서 클릭이나 키 입력을 한 번 받는다 (브라우저는 그 전에는 소리를 낼 수 없다).
- 저장(`save`)은 브라우저에 남는다.
- 최신 Chrome, Edge, Firefox, Safari(18.4 이상)에서 동작한다.
