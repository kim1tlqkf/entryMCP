# 엔트리 MCP

Claude Code·Codex 같은 로컬 MCP 클라이언트가 평소 쓰는 Chrome에 열린 [엔트리](https://playentry.org) 작품 만들기 화면을 읽고 고치게 해 주는 MCP 서버와 Chrome 확장입니다.

- 블록 읽기·고치기·끼워 넣기, 오브젝트·변수·신호·함수·그림·소리 편집, 실행·정지, 무대 미리보기를 도구로 제공합니다.
- 편집은 엔트리 되돌리기(Ctrl+Z)에 들어가고, 편집 전 백업을 내 컴퓨터에 남깁니다.
- 사람이 같은 작품을 고치는 동안에도 쓸 수 있습니다(아래 "사람과 같이 편집할 때").
- 온라인 저장은 하지 않습니다. 저장은 사용자가 편집기에서 합니다.

## 구성

```
MCP 클라이언트 ──stdio── server_bridge.mjs ──WebSocket(127.0.0.1)── Chrome 확장 ── playentry.org/ws/ 탭
```

| 파일 | 하는 일 |
| --- | --- |
| `server_bridge.mjs` | MCP 서버 진입점 |
| `authoring-tools.mjs` | 편집 도구 정의와 안내문 |
| `bridge_runtime.mjs` | 확장과의 로컬 WebSocket 연결 |
| `project.mjs` | `.ent` 읽기, 작품 해시·변경 경로 비교 |
| `extension/` | 엔트리 탭 안에서 실제로 읽고 쓰는 Chrome 확장(MV3) |
| `pair.mjs` | 서버와 확장이 공유하는 연결 비밀값 만들기 |
| `perf.mjs` | 엔트리 탭의 플레이 기록 켜기·회수(읽기 전용) |
| `authoring_check.mjs`, `smoke_bridge.mjs` | 엔트리 없이 도는 시험 |

## 설치

Node.js 20 이상과 Chrome 120 이상이 필요합니다.

```bash
npm ci --ignore-scripts
npm run pair
```

`pair`는 로컬 연결 비밀값을 만들어 `pairing-secret`과 `extension/pairing.js`에 저장합니다. 두 파일은 Git에서 제외됩니다. 이 값이 맞는 확장만 서버에 붙을 수 있습니다.

평소 쓰는 Chrome에서 `chrome://extensions` → 개발자 모드 → **압축해제된 확장 프로그램을 로드합니다**로 이 저장소의 `extension` 폴더를 한 번 선택합니다. 확장은 `playentry.org` 편집기와 `127.0.0.1` 로컬 서버에만 접근 권한을 요청합니다. MCP 서버가 시작되면 확장이 자동으로 다시 연결하므로 별도 Chrome이나 디버그 포트는 필요 없습니다.

### MCP 클라이언트에 등록

`<경로>`는 이 저장소를 받은 폴더입니다.

Claude Code:

```bash
claude mcp add personalEntry -- node <경로>/server_bridge.mjs
```

Codex:

```bash
codex mcp add personalEntry -- node <경로>/server_bridge.mjs
```

여러 작업이 동시에 이 MCP를 시작하면 첫 프로세스가 Chrome 확장 연결을 맡고 나머지는 같은 로컬 브리지에 붙습니다. 작업별 탭 선택은 따로 유지됩니다. 옛 버전 프로세스가 포트를 잡고 있으면 이 공유가 안 되므로 그 프로세스를 끈 뒤 다시 시작합니다.

### 환경 변수

| 이름 | 뜻 |
| --- | --- |
| `ENTRY_MCP_OUTPUT` | 체크포인트·백업 폴더(기본: `%LOCALAPPDATA%\EntryPersonalMCP`, 없으면 시스템 임시 폴더 아래) |
| `ENTRY_MCP_BRIDGE_PORT` | 로컬 연결 포트(기본 9442). 바꾸면 `extension/background.js`의 `ADDRESS`도 맞춰야 합니다 |
| `ENTRY_MCP_EDIT_TIMEOUT_MS` | `entry_edit` 응답 대기 시간(기본 45초) |
| `ENTRY_MCP_MAX_MESSAGE_MIB` | 브리지 메시지 하나의 상한(기본 256, 최대 384) |

## 작업 흐름

1. `entry_help`, `entry_tabs`, `entry_select_tab`으로 대상 편집기를 고릅니다.
2. `entry_context`, `entry_script`, `entry_block_schema`로 현재 작품과 지금 엔트리 버전의 블록 정의를 읽습니다.
3. `entry_checkpoint`로 로컬 JSON 스냅샷과 해시를 남깁니다.
4. `entry_edit`로 편집합니다. 편집 뒤 `entry_diff_checkpoint`로 전체 저장 데이터의 변경 경로를 확인합니다. 사용자가 같은 때 고친 곳도 함께 나옵니다.
5. `entry_control`·`entry_state`로 실행을 관찰하고, `entry_preview`로 무대를 봅니다.
6. `entry_read_ent`는 이미 있는 `.ent` 파일을 읽습니다.

체크포인트는 사용자 컴퓨터에만 기록됩니다. 편집기 연결이 없어도 서버는 시작되며, 도구는 `BLOCKED`로 연결 조건을 알려 줍니다. 서버 시작 자체는 작품을 바꾸지 않습니다.

## 사람과 같이 편집할 때

- 사용자는 MCP가 작업하는 동안에도 같은 작품을 계속 고칠 수 있습니다. 작품 전체 해시 조건은 없습니다. 블록 고치기(`patch_blocks`)·끼워 넣기(`insert_blocks`)·오브젝트 속성·변수·신호 편집은 편집하는 순간의 편집기 상태에 그대로 적용되므로, 다른 오브젝트나 같은 오브젝트의 다른 스레드에서 사용자가 한 변경은 남습니다.
- 목록을 통째로 바꾸는 작업(`set_script`, `set_function`, `set_pictures`, `set_sounds`)만 그 대상의 버전을 `expectedVersions`로 받습니다. 키는 `script:<오브젝트>`, `function:<함수>`, `pictures:<오브젝트>`, `sounds:<오브젝트>`이고 값은 `entry_context`(`objects[].versions`, `functions[].version`)나 `entry_script`(`version`)에서 읽습니다. 읽은 뒤 사용자가 그 대상을 고쳤으면 덮어쓰지 않고 `TARGET_CHANGED`로 거절합니다.
- 편집 적용과 대상 밖 변경 검사는 페이지에서 기다림 없이 한 번에 돌아, 그 사이에 사용자 조작이 끼어들지 않습니다. 같은 블록의 같은 칸을 사용자와 MCP가 둘 다 고치면 나중에 쓴 쪽이 남습니다.
- `entry_undo`는 되돌리기 목록 맨 위가 MCP 편집일 때만 동작합니다. 그 뒤에 사용자가 무언가 했으면 사용자 작업을 지키려고 거절합니다.
- `applied:true`는 그 순간 편집기에 들어갔다는 뜻입니다. 뒤에 Ctrl+Z나 다른 도구가 되돌릴 수 있으므로, 사라진 편집은 다음 `entry_context`·`entry_edit`·`entry_checkpoint`의 `revertedEdits`로 한 번 알립니다. `cause:"undo"`는 되돌리기, `"external"`은 그 밖의 원인입니다. 그림·소리 목록 변경은 이 알림 대상이 아닙니다.
- 편집 뒤에는 엔트리 명령과 같은 변경 신호를 보냅니다. 편집기 변경을 지켜보는 다른 확장(예: 실시간 공동 편집)도 이 신호로 편집을 알아챌 수 있습니다.
- `remove_object`는 어느 장면의 오브젝트든 지웁니다. `add_object`와 `order_objects`는 지금 장면 기준이라, 다른 장면에는 `entry_control(action:"select_scene", sceneId)`로 옮긴 뒤 씁니다. 이때 사용자가 보는 장면도 같이 옮겨집니다.
- 해시는 표의 `updated`와 행 `key`를 뺍니다. 작품을 다시 불러올 때 새로 정해지는 값이라 내용이 아닙니다.
- `entry_edit`는 바뀐 스레드만 바꾸고 최대 45초 기다립니다. 그래도 넘기면 `PENDING`과 `requestId`를 돌려줍니다. 페이지에서는 편집이 계속 돌기 때문에 같은 편집을 다시 보내면 안 됩니다. 다음 `entry_context`의 `lastEdits`에서 그 `requestId`의 `applied`를 확인합니다. 번호가 아예 없으면 편집이 페이지에 닿지 않았거나 탭이 새로 열린 것이니, `entry_diff_checkpoint`로 함께 받은 체크포인트와 비교한 뒤 정합니다.
- 체크포인트와 편집 전 백업은 작품 전체를 브리지 메시지 하나로 받습니다. 상한을 넘으면 그 요청만 `BRIDGE_MESSAGE_TOO_LARGE`로 실패하고 서버는 계속 돕니다.
- 엔트리가 글 코딩(텍스트 코딩) 화면이면 편집과 되돌리기를 `TEXT_CODING_MODE`로 거절합니다. 엔트리는 실행할 때 화면의 글로 코드를 다시 불러오므로, 그동안 바꾼 블록이 사라지기 때문입니다.

에이전트가 작업할 때의 판정 순서와 기능을 늘리는 기준은 [HARNESS.md](HARNESS.md)에 있습니다.

## 확인한 범위와 한계

- 확인함: 일반 Chrome의 시험용 새 작품에서 연결 → 탭 선택 → 체크포인트 → 이름 변경 → 화면 반영 → 전체 저장 데이터 비교(이름 외 변경 0건), 실제 실행·정지에서 X값 `0 → 100 → 0`.
- 첫 실행 뒤에는 저장 데이터 3개 필드가 바뀝니다. 확장 없는 순정 새 작품에서도 같은 값으로 바뀌는 엔트리 동작이고, 두 번째 실행부터는 해시가 유지됩니다.
- 사람과 동시에 편집하는 방식은 엔트리 없는 시험(`npm run check`)으로만 확인했고, 실제 Chrome에서 사람이 편집하는 도중에 시험한 기록은 아직 없습니다.
- 포함하지 않음: 온라인 저장, `.ent` 내려받기 검증.
- 엔트리 사이트가 바뀌면 동작이 깨질 수 있습니다. 엔트리 공식 도구가 아닙니다.

## 시험

```bash
npm run check
node smoke_bridge.mjs <내려받은 작품.ent>
```

`npm run check`는 문법 검사와 가짜 엔트리 위에서 도는 편집 시험입니다. `smoke_bridge.mjs`의 브라우저 응답은 시험 클라이언트가 흉내 내므로, 실제 Chrome 확장 동작은 따로 확인해야 합니다.

## 라이선스

[MIT](LICENSE)
