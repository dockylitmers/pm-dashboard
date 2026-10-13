# pm-dashboard

외주 개발 PM 시스템이다. PM이 어떤 프로젝트를 하든 이 대시보드만 보면 실제 업무 상황을 알 수 있다.

대시보드가 실제와 어긋나지 않게 하는 장치가 셋 있다.

- **값마다 확인일과 출처가 붙는다.** '확인 10/7 · Notion 요청 페이지'처럼 언제, 어디서 확인한 값인지 남는다. 추정한 값, 14일 넘게 확인하지 않은 값, 확인한 뒤 GitHub 이슈가 바뀐 값은 '다시 확인'으로 모인다.
- **업데이트가 원본을 다시 읽는다.** 대시보드 상단 '업데이트' 버튼을 누르거나 자동 실행을 켜 두면 매일 08:30 · 12:30 · 18:30에 돈다. 빠른 업데이트는 GitHub 이슈와 다시 확인할 값을 몇 초 만에 새로 맞춘다. 전체 업데이트는 Claude가 GitHub 코멘트와 Notion 요청 페이지를 읽고 바뀐 값을 이 워크스페이스에 반영한다. 원본에는 쓰지 않는다.
- **모르는 것은 PM에게 묻는다.** 원본에서 못 찾은 값은 비워 두지 않고 추정으로 표시하고, '답해 주실 것'으로 모은다. 상단 버튼에 '업데이트 오늘 08:30 · 답할 것 2'처럼 마지막 업데이트 시각과 답할 것 개수가 나오고, 12시간이 넘었거나 실패하면 주의 색으로 바뀐다.

Claude Code 플러그인으로 설치한다. PM이 만든 비공개 GitHub 저장소 하나(PM 워크스페이스)에 모든 프로젝트를 모은다. PM은 Claude에게 말로 시키고, `pm` CLI가 기록·계산하고, 대시보드로 본다.

## 할 수 있는 것

- **킥오프 4단계**: 계약 확인 → 범위·SRS → 고객사 요청 → 기본 세팅. 항목마다 필요 시점과 준비 기간으로 '언제까지 요청해야 하는지'를 계산해 이번 주 할 일을 뽑는다.
- **고객사 확인 요청 목록**: 개발 범위(앱, 결제, 소셜 로그인, 알림톡…)를 고르면 고객사에 받아야 할 목록이 정해진다. Notion 요청 페이지와 같은 모양이고, 우리 제안값은 분홍, 고객사 답은 노랑이다.
- **계약 점검**: 범위 부속서, 검수, 대금과 검수 연결, 고객사 지연 시 일정 순연 등 12항목과 대금 단계.
- **기본 세팅**: GitHub 라벨, 주 단위 스프린트, 고객사 QA·출시 마일스톤을 일정 예측이 읽는 규칙대로 만든다.
- **문서 초안**: 킥오프 회의 자료(고객사용·내부용), 주간 진행상황(팀용·고객사용), 요청서·리마인드. 보내는 것은 사람이 한다.
- **일정 예측**: GitHub 이슈로 처리·유입 속도를 계산해 예상 완료일을 범위로 보여 주고, 목표일에 남을 양과 필요한 처리량까지 낸다.
- **최신화**: 값마다 확인일과 출처를 남긴다. 업데이트(버튼·하루 3번 자동)가 다시 확인할 값을 찾고, 전체 업데이트나 "최신화해 줘"로 Claude가 원본과 대조해 반영한다.
- **대시보드**: 한 파일 HTML 또는 로컬 서버. 고객사 공유본은 내부 정보를 데이터에서 빼고 만든다. 캐릭터 에이전트 '리미'가 상태에 따라 색이 바뀌고 질문에 답한다.

설계는 [docs/DESIGN.md](docs/DESIGN.md)에 있다.

## 처음 쓰는 PM

설치 → 워크스페이스 → 프로젝트 등록 → 킥오프 → 전체 업데이트 세팅 → 매일 쓰기 순서다. 명령은 Claude가 실행하므로 PM은 말로 하면 된다.

### 1. 플러그인 설치 (PC마다 한 번)

Claude Code에서:

```
/plugin marketplace add dockylitmers/pm-dashboard
/plugin install pm-dashboard@pm-dashboard
```

비공개 저장소라 저장소에 초대받은 GitHub 계정으로 이 PC의 git이 접근할 수 있어야 한다(SSH 키, 또는 `gh auth login` 뒤 `gh auth setup-git`). 새 버전은 `/plugin marketplace update pm-dashboard`로 받는다.

필요한 것: Node 18 이상. GitHub 이슈를 받으려면 `gh auth login` 또는 `GITHUB_TOKEN`.

### 2. PM 워크스페이스 만들기 (PM 한 사람당 한 번)

GitHub에 **비공개** 저장소를 하나 만들어 내려받고, 그 폴더에서 Claude Code를 연다.

```bash
gh repo create pm-workspace --private --clone && cd pm-workspace && claude
```

> PM 워크스페이스로 세팅해 줘. 회사 이름은 ○○야.

Claude가 `pm setup`을 실행해 `pm-workspace.json`, `projects/`, `.gitignore`, `README.md`를 만들고 이 폴더를 기본 워크스페이스로 등록한다. 이후 어느 폴더에서 일해도 PM 데이터는 여기에 쌓인다. 고객사 저장소에서 일해도 내부 메모가 고객사 저장소에 섞이지 않는다.

- 저장소가 공개면 경고한다. 고객 정보가 들어가므로 비공개로 바꾼다(`gh repo edit --visibility private`).
- 변경은 평소처럼 commit·push 한다. 다른 PC에서는 같은 저장소를 내려받아 `pm setup`을 한 번 더 하면 된다.
- 예전 데이터(`~/.pm-dashboard`)가 있으면 `pm setup --import ~/.pm-dashboard`로 옮긴다.

### 3. 프로젝트 등록

> 새 프로젝트 등록해 줘. 이름은 예약 앱, 고객사는 ○○, 앱·관리자 웹·결제·카카오 로그인·알림톡. 킥오프 10/12, 개발 10/26~12/18, 고객사 QA 12/21~1/8, 출시 1/15. 저장소는 ○○/○○.

Claude가 모르는 것만 묻고 `pm init`을 실행한다. 견적서나 기능 목록을 주면 범위를 제안하고 확인받는다. 범위로 체크리스트와 고객사 확인 요청 목록이 정해지고, 날짜로 '언제까지 요청해야 하는지'가 계산된다. 날짜가 비어 있으면 계산되지 않는다.

고를 수 있는 범위(`pm scope --list`):

| 묶음 | 범위 |
|---|---|
| 플랫폼 | 모바일 앱 `app`, 고객 웹 `web`, 관리자 웹 `admin` |
| 결제 | 결제·환불 `payment` |
| 로그인 | 카카오 `social-kakao`, 네이버 `social-naver`, Apple `social-apple`, Google `social-google` |
| 발송 | 문자 `sms`, 카카오 알림톡 `alimtalk`, 이메일 `email`, 앱 푸시 `push`, 광고성 메시지 `marketing` |
| 기능 | 회원 등급·포인트·쿠폰 `membership`, 공지·FAQ·이벤트 `content`, 1:1 문의·고객센터 `support`, 상품 판매 `commerce`, 위치 정보 `location` |
| 연동 | 외부 공급사 API `vendor` |

범위가 바뀌면 "결제 기능 추가해 줘"라고 말한다(`pm scope --add payment`). 새 항목이 추가되고, 범위에서 뺀 기능의 항목은 아직 손대지 않았을 때만 '해당 없음'이 된다.

### 4. 킥오프

> 이번 주 킥오프 할 일 알려 줘.

`pm kickoff`가 단계마다 남은 항목과 이번 주 할 일을 보여 준다. 대시보드의 '킥오프 체크리스트' 화면도 같은 내용이다.

| 단계 | 끝난 것으로 보는 기준 | 이렇게 말한다 |
|---|---|---|
| 1. 계약 확인 | 계약서·견적서와 범위 기준선 확정, 계약 점검 12항목 확인 | "계약서 점검하자" (파일을 주면 읽고 점검한다) |
| 2. 범위·SRS | SRS, 일정 합의, 검수 기준, 변경 요청 절차를 받음 이상 | "SRS 만들어 줘" |
| 3. 고객사 요청 | 고객사 확인 요청 목록의 모든 항목을 보냄 | "고객사에 보낼 요청 목록 만들어 줘. Notion에 올릴 수 있게." |
| 4. 기본 세팅 | 담당자·소통 채널·보고 방식 확정, 저장소·라벨·스프린트 준비 | "저장소 라벨이랑 스프린트 만들어 줘" |

'이번 주 할 일'은 요청 시작일(필요 시점 − 준비 기간)이 지났거나 7일 안인 항목, D+7을 넘긴 고객사 대기, 검토할 답, 남은 계약 점검, 저장소 세팅을 모은다. 요청 시작일이 지났는데 요청하지 않은 항목은 '늦음'이다.

**계약 점검.** 범위 부속서, 검수 방법·기간, 대금 단계와 검수 연결, 변경 요청 비용, 고객사 지연 시 일정 순연, 산출물·소스·계정 인도, 지식재산권, 하자 보수, 유지보수, 제3자 비용, 개인정보 처리 위탁, 해지·정산을 있음·불리/모호·없음·해당 없음으로 표시한다. 불리하거나 없는 항목은 보완 방법을 한 줄로 제안한다. 대금 단계(기본: 착수금 30%·중도금 40%·잔금 30%)는 일정에 묶여 예정일이 계산되고, 청구·수령을 기록한다. 법률 검토를 대신하지 않는다.

**고객사 확인 요청 목록.** 외주를 맡긴 고객사에 "개발에 무엇이 필요한지"를 안내하고 답을 모으는 표다.

| 분야 | 항목 | 확인/요청 내용 | 정보 | 비고사항 |
|---|---|---|---|---|

- 정보 칸은 `• 라벨: 값` 입력 줄이다. 우리가 미리 채운 제안값은 분홍, 고객사 답은 노랑이다. 제안값의 날짜는 프로젝트 일정으로 채운다. 고객사는 맞으면 그대로 두고, 다른 곳만 고친다.
- 일정상 먼저 필요한 분야에 ⭐, 비고에 회신 기한과 대기 일수(D+n)가 붙는다.
- 처음 보낸 뒤 추가로 보내는 것은 '추가 확인 요청 (날짜)' 구분 줄로 이어 붙인다.
- 계정은 비밀번호를 받지 않고, 개발사 계정을 권한 초대로 받는다.

쓰는 순서:

1. "요청 목록 만들어 줘" → `pm sheet`(Markdown, 메일·문서에 붙여 넣기) 또는 `pm sheet --format notion`(Notion 요청 페이지 형식, 분홍·노랑 배경).
2. "Notion에 올려 줘" → Claude가 내용과 올릴 위치를 먼저 보여 주고, 확인을 받은 뒤 요청 페이지에 만든다.
3. 보낸 뒤 "보냈어" → `pm sheet --mark-sent`. 항목이 '요청함'으로 바뀌고 대기 일수가 시작된다. 대시보드 '고객사 요청' 화면의 '보낸 것으로 표시'와 같다.
4. 고객사가 Notion에 노랑으로 답을 적으면 "고객사 답 읽어 와" → Claude가 읽고 `pm answer`로 기록한다. 대시보드에서 항목을 눌러 적어도 된다.
5. 나중에 더 보낼 것은 `pm sheet --only-new`로 아직 안 보낸 것만 뽑는다.

**기본 세팅.** `pm setup-repo`는 만들 라벨(`epic`, `descope`, `확인요청`, `blocked`)과 마일스톤(`SP-01 · 10/26~10/30` 같은 주 단위 스프린트, 고객사 QA, 출시)을 보여 주기만 한다. PM이 확인하면 `--apply`로 만든다. 이미 있는 것은 건너뛴다. 이름 규칙은 [skills/pm/references/setup.md](skills/pm/references/setup.md)에 있다.

**킥오프 회의 자료.** "킥오프 회의 자료 만들어 줘" → 고객사와 함께 보는 판(개요, 일정, 소통 방식, 검수와 변경 관리, 고객사에 요청할 것, 첫 2주 계획, 회의에서 정할 것). "내부용도 만들어 줘" → 계약 점검·대금·위험이 들어간 내부 준비 판. 내부 판은 고객사에 보내지 않는다.

워크스페이스가 바뀌면 commit·push 한다.

### 5. 전체 업데이트 세팅 (PC마다 한 번)

> 전체 업데이트 세팅해 줘. 하루 세 번 자동으로.

Claude가 `pm doctor`로 점검하고, 빠진 것마다 할 일을 알려 준다.

| 점검 | 갖출 것 |
|---|---|
| Claude Code | 이 PC에 설치하고, 터미널에서 `claude`를 한 번 실행해 로그인한다 |
| Notion 연결 | **사용자 범위**로 등록한다: `claude mcp add --scope user --transport http notion https://mcp.notion.com/mcp` → `claude` 실행 → `/mcp`에서 notion 인증 |
| GitHub 로그인 | `gh auth login` 또는 `GITHUB_TOKEN` |
| 프로젝트 원본 (경고) | 프로젝트마다 `project.json`의 `channels.notion.url`에 고객 요청 DB 링크를 넣는다. 없으면 Claude가 어디를 읽을지 모른다 |

Notion MCP를 특정 폴더에만 등록했으면 PM 워크스페이스에서 돌 때 Notion이 보이지 않는다. 꼭 `--scope user`로 등록한다.

다 갖췄으면 Claude가 시각, 전체·빠른, 서버를 켜 둘지 확인한 뒤 `pm schedule install --deep`을 실행한다. 이 명령도 먼저 점검하고, 빠진 것이 있으면 빠른 업데이트로 켠다. 전체 업데이트는 돌 때마다 Claude 사용량이 든다. 자세한 것은 [업데이트](#업데이트).

### 6. 매일 쓰기

| 이렇게 말하면 | Claude가 하는 일 |
|---|---|
| "오늘 뭐부터 해?" | GitHub 이슈를 받고(`pm sync`), 다시 확인할 값을 챙기고(`pm refresh`), 브리핑과 이번 주 할 일을 결론부터 말한다(`pm status`). 전체 업데이트가 남긴 '답해 주실 것'은 한 번에 묻는다 |
| "최신화해 줘" | 아래 [대화로 최신화하기](#대화로-최신화하기) |
| "하루 세 번 자동으로 업데이트되게 해 줘" | `pm doctor`로 점검하고, 시각·전체/빠른·서버를 확인한 뒤 `pm schedule install --deep` |
| "고객사 답 기다리는 거 정리해 줘" | 요청함 항목을 모으고, D+7을 넘긴 것부터 리마인드 초안을 쓴다(`pm request`) |
| "1/15 출시 맞출 수 있어?" | 예상일, 낙관~비관, 목표일에 남을 양을 말하고, 처리 속도·유입·범위를 바꿔 다시 계산한다(`pm forecast`) |
| "주간 보고 써 줘" | 팀용(`pm report`)과 고객사용(`pm report --client`) 초안 |
| "대시보드 열어 줘" | `pm build --open` 또는 `pm serve --open`. 자동 실행이 서버를 켜 두었으면 http://127.0.0.1:4477/ 을 연다 |
| "고객사에 공유할 화면 만들어 줘" | `pm build --project <id> --client`. PM이 열어 보고 보낸다 |

Claude는 고객사·팀으로 나가는 글과 GitHub·Notion 쓰기를 초안까지만 만든다. 실행은 PM이 확인한 뒤에만 한다.

## 대시보드를 실제와 맞추기

프로젝트 값은 한 번 채우면 낡는다. 고객사 답, 결정, 콘솔 설정은 대시보드 밖에서 바뀐다. 그래서 값마다 마지막으로 확인한 날과 출처(`checked`)를 남기고, 다시 볼 값을 모은다.

| 다시 확인할 값 | 뜻 |
|---|---|
| 추정 | 원본에서 직접 확인하지 못한 값. 담당자 확인 전이다 |
| 오래됨 | 끝나지 않은 항목을 14일 넘게 확인하지 않았다. 아직 손대지 않은 새 항목은 빼고 요청 시작일로 챙긴다 |
| 확인 뒤 GitHub 이슈가 바뀜 | 항목에 연결된 이슈가 마지막 확인 뒤에 바뀌었다. 업데이트나 `pm refresh`가 GitHub을 조회해 찾는다 |

이 값을 찾고 원본과 대조해 고치는 일은 업데이트가 한다. 대화 중에는 "최신화해 줘"로 같은 일을 Claude와 함께 한다.

### 업데이트

| 업데이트 | 하는 일 | 걸리는 시간 |
|---|---|---|
| 빠른 (`pm update`) | GitHub 이슈·마일스톤 스냅샷을 새로 받고 다시 확인할 값을 계산한다 | 몇 초 |
| 전체 (`pm update --deep`) | 빠른 업데이트를 한 뒤, Claude Code를 headless로 띄워 GitHub 코멘트와 Notion 요청 페이지를 읽고 `pm answer`·`pm set`·`pm check --src`로 이 워크스페이스의 값을 고친다. 못 찾은 값은 추정으로 두고 '답해 주실 것'으로 남긴다 | 몇 분. Claude 사용량이 든다 |

결과는 `projects/<id>/update.json`에 남는다. 어느 쪽도 원본(GitHub·Notion)에는 쓰지 않는다.

전체 업데이트의 Claude가 쓸 수 있는 도구는 읽기 도구(`gh issue`·`gh pr`의 view·list, Notion fetch·search·comments, `dig`, Read·Grep·Glob)와 이 워크스페이스의 `pm` CLI뿐이다. 나머지는 묻지 않고 거절된다(`--permission-mode dontAsk`). 워크스페이스 설정 `pm-workspace.json`의 `update`로 읽기 도구를 더하거나(`allowedTools`), 모델(`model`)과 한 번에 쓸 비용 한도(`maxBudgetUsd`)를 정할 수 있다.

| 방법 | 하는 법 |
|---|---|
| 대시보드 | 상단 '업데이트' 버튼 → '원본에서 다시 읽기' 창 → '빠른 업데이트' 또는 '전체 업데이트' (`pm serve`로 열었을 때만. '전체 업데이트'는 서버가 이 PC에서 claude를 찾을 때만 보인다) |
| 터미널 | `pm update [--deep]` (모든 프로젝트는 `--all`) |
| 자동 | `pm schedule install --deep` → 매일 08:30 · 12:30 · 18:30 전체 업데이트. `--deep`을 빼면 빠른 업데이트 |

상단 버튼에는 '업데이트 오늘 08:30 · 답할 것 2'처럼 마지막 업데이트 시각과 답할 것 개수가 나온다. 12시간 넘게 업데이트하지 않았거나 마지막 업데이트가 실패했으면 글자가 주의 색으로 바뀐다. 버튼을 누르면 '원본에서 다시 읽기' 창이 열린다.

- 자동 업데이트 상태 (켜져 있으면 '매일 08:30 · 12:30 · 18:30 · 전체')
- '빠른 업데이트'·'전체 업데이트' 버튼. `pm build`로 만든 파일에서는 만들 때의 기록만 보이고 버튼이 없다
- 마지막 업데이트: 언제, 누가 돌렸는지(자동·대시보드·터미널), 전체·빠른, 걸린 시간, 단계별 결과
- 전체 업데이트의 요약, '답해 주실 것 N개', '이번에 바뀐 값 N개'
- 다시 확인할 값 목록. 항목마다 추정·GitHub 바뀜·오래됨 표시가 붙는다
- 기록

**자동 업데이트.** "하루 세 번 자동으로 업데이트되게 해 줘"라고 하면 Claude가 `pm doctor`로 점검하고, 시각·전체/빠른·서버를 켜 둘지 확인한 뒤 등록한다.

```bash
pm doctor                                 # 전체 업데이트에 필요한 것 점검
pm schedule install --deep                # 매일 08:30 · 12:30 · 18:30 전체 업데이트, 대시보드 서버도 계속 켜 둠
pm schedule install --deep --times 09:00,17:00   # 시각 바꾸기
pm schedule install --deep --no-serve     # 서버는 켜 두지 않음
pm schedule install                       # 빠른 업데이트로 켜기
pm schedule                               # 상태와 프로젝트별 마지막 업데이트
pm schedule remove                        # 자동 업데이트·서버 끄기
```

- macOS launchd에 등록한다. 대시보드 서버(127.0.0.1:4477)도 로그인해 있는 동안 계속 켜 두므로, 브라우저에서 http://127.0.0.1:4477/ 을 열면 바로 최신 대시보드다. 이때 `pm serve --open`을 하면 새로 띄우지 않고 켜져 있는 서버를 연다.
- `--deep`이면 먼저 점검하고, 빠진 것이 있으면 빠른 업데이트로 켠다. launchd에는 셸 설정이 없으므로 설치할 때 찾은 claude 경로를 고정해 둔다.
- 이 PC의 자동 실행은 하나다. 다른 워크스페이스에 켜져 있으면 `pm schedule`이 알려 준다.
- Mac이 잠자기 중이면 그 시각은 건너뛰고, 깨어난 뒤 한 번 실행한다.
- 실행 기록은 `<워크스페이스>/.pm-logs/`에 남는다.
- 다른 OS에서는 등록하지 않고 crontab에 넣을 줄을 보여 준다.

### 대화로 최신화하기

전체 업데이트를 켜지 않았거나 지금 바로 맞추고 싶으면 Claude에게 "최신화해 줘"라고 한다. 전체 업데이트가 하는 일을 대화 중에 함께 하고, 모르는 것은 그 자리에서 묻는다. Claude는 이렇게 한다.

1. `pm refresh`로 다시 볼 값을 모은다.
2. GitHub 이슈가 바뀐 항목은 확인일 뒤의 이슈 코멘트를 읽고 반영한다.
3. Notion 요청 페이지가 출처인 항목은 그 페이지의 고객사 답(노랑)과 댓글을 읽고 반영한다.
4. 값이 바뀌었으면 `pm answer`·`pm set`으로, 그대로면 `pm check`로 기록한다. 어느 쪽이든 `--src`로 출처가 남는다.
5. 원본에서 못 찾은 값은 '없음'으로 적지 않고 추정(`--guess`)으로 둔다. 찾아본 곳과 함께 PM에게 한 번에 묻는다.
6. 바뀐 것, 아직 모르는 것, 그 때문에 막히는 일정을 보고한다.

### 대시보드에서 보는 법

- '킥오프 체크리스트'의 항목마다 '확인 10/7 · 출처'가 붙고, 추정·오래됨 표시가 뜬다. 확인 기록이 없으면 '확인 기록 없음'이다.
- 추정이나 오래된 값이 있으면 상태 거르기 옆에 '다시 확인' 버튼이 생긴다. 누르면 그 항목만 남는다. '오늘' 브리핑에도 개수가 나온다.
- 항목을 열어 확인한 곳을 적고 '지금 확인함'을 누르면 오늘 날짜와 출처가 남는다.

## 대시보드

| 목적 | 명령 |
|---|---|
| 내가 보기 (모든 프로젝트) | `pm build --open` → `build/dashboard.html` (프로젝트가 하나면 `build/<id>.html`) |
| 화면에서 답·상태·계약 점검을 바꾸고 파일에 저장, 업데이트 버튼 쓰기 | `pm serve --open` (127.0.0.1:4477). 자동 실행이 켜 두었으면 그 주소를 연다 |
| 고객사에 공유 | `pm build --project <id> --client` → `build/<id>-client-<날짜>.html` |

`pm build` 파일에서 바꾼 상태는 그 브라우저에만 남는다. 계속 쓸 거면 `pm serve`로 연다. 바꾼 내용이 `project.json`에 바로 저장된다.

상단에는 프로젝트 선택, 상태, 출시 D-day, '업데이트', '승인 대기', '고객사 공유 보기'가 있다.

| 화면 | 보이는 것 |
|---|---|
| 오늘 | 상태와 리미 브리핑, 킥오프 진행·이번 주 할 일, 출시까지 남은 날, 처리·유입, 준비율, 고객사 대기 |
| 킥오프 체크리스트 | 4단계, 이번 주 할 일, 개발 범위, 계약 점검·대금 단계, 분야별 항목(상태·공·확인일·출처) |
| 고객사 요청 | 요청 목록(차수별, 분홍·노랑), 답 기록, Markdown·Notion 형식 복사, 보낸 것으로 표시 |
| 일정·속도 | 예측 띠, 남은 이슈 추이, 가정 바꿔 보기, 스프린트, 주간 흐름 |
| 이슈 | 담당자별, 고객사·논의 대기, 오래된 이슈 |
| 리소스·연결 | 문서 만들기, SRS, 연결 상태, 원본 링크 |

일정·속도와 이슈 화면은 GitHub 저장소를 연결하고 `pm sync`를 한 뒤에 채워진다.

**고객사 공유본.** 화면은 '오늘'과 '고객사 요청' 둘이고, 열면 보낸 항목만 담긴 '개발 관련 요청사항'이 먼저 나온다. 내부 메모, 확인 기록, 계약, 결정, 위험, 이슈 제목은 화면에서 숨기는 것이 아니라 데이터에서 뺀다. 출처 링크는 Notion 링크만 남고, 리미도 없다. 보내기 전에 대시보드 상단 '고객사 공유 보기'로 고객사에게 보일 모습을 미리 본다.

### 리미

대시보드의 캐릭터 에이전트다. 리트머스 시험지 모양이고, 색이 상태(파랑 순항·보라 주의·빨강 위험)를, 물든 높이가 진행률을 나타낸다. 킥오프, 요청 목록, 계약, 주간 보고, 회의 자료, 일정, 대기, 위험을 물어보면 답한다.

- **내장 모드**: 키가 없으면 대시보드 데이터로 답한다.
- **Claude 모드**: `ANTHROPIC_API_KEY=... pm serve --open`으로 띄우면 서버가 Claude를 부른다(브라우저에 키가 가지 않는다). 대화창에서 키를 넣을 수도 있는데, 그 브라우저에만 저장되므로 개인 PC에서만 쓴다.

리미는 읽기, 계산, 화면 열기, 초안까지만 한다. 요청서·리마인드 초안은 상단 '승인 대기'에 넣고, 보내는 것은 PM이 한다.

## 명령 (터미널)

Claude가 대신 실행하지만, 터미널에서 직접 쓰려면 `pm install-cli`로 `~/.local/bin/pm`을 만든다. 전체 명령은 `pm help`.

```bash
# 시작 (PM 한 사람당 한 번)
pm setup --company "회사 이름" [--import ~/.pm-dashboard]
pm workspace                              # 지금 쓰는 워크스페이스와 프로젝트
pm config company "회사 이름"

# 프로젝트
pm init booking --name "예약 앱" --client "고객사" --repo owner/repo \
  --scope app,admin,payment,social-kakao,alimtalk \
  --kickoff 2026-10-12 --dev-start 2026-10-26 --dev-end 2026-12-18 \
  --qa-start 2026-12-21 --qa-end 2027-01-08 --launch 2027-01-15
pm scope --list                           # 고를 수 있는 범위
pm scope --add payment --remove web       # 범위 바꾸기
pm projects
pm validate [--all]                       # 형식 점검, 비밀번호·키처럼 보이는 값 찾기

# 최신화
pm update [--all] [--offline]             # 빠른: GitHub 이슈 스냅샷 + 다시 확인할 값 → 대시보드 '업데이트' 창
pm update --deep [--all]                  # 전체: Claude가 원본을 읽고 이 워크스페이스의 값을 고친다
pm doctor                                 # 전체 업데이트에 필요한 것 점검
pm schedule install [--times 08:30,12:30,18:30] [--deep] [--no-serve]   # 자동 업데이트 (macOS)
pm schedule                               # 상태
pm schedule remove                        # 끄기
pm refresh [--offline]                    # 다시 확인할 값 (추정 · 14일 넘음 · 확인 뒤 GitHub 이슈가 바뀜)
pm check business-info cs --src "Notion 요청 페이지"   # 값이 그대로일 때 확인일만 새로
pm check cloud --src "PM" --guess         # 추정으로 표시
pm list --recheck

# 킥오프·현황
pm kickoff                                # 4단계와 이번 주 할 일
pm status                                 # 브리핑·예측·고객사 대기
pm kickoff-kit [--internal] [--save]      # 킥오프 회의 자료
pm report [--client] [--save]             # 주간 진행상황
pm sync [--all]                           # GitHub 이슈·마일스톤 스냅샷
pm forecast --velocity 20 --inflow -30 --descope 5   # 가정 바꿔 예측
pm setup-repo [--apply]                   # 라벨·스프린트 마일스톤 (기본은 계획만)

# 고객사 요청
pm sheet [--format notion] [--only-new] [--save]
pm sheet --mark-sent                      # 보낸 뒤
pm answer cs "대표 전화번호=02-000-0000" --src "Notion 요청 페이지" [--confirm]
pm request domain --due 2026-10-30 [--queue]   # 요청서·리마인드 초안 (보내지 않음)
pm list --status requested --ball client
pm set srs --status received --src "고객사 메일"
pm set domain --internal "DNS 담당자 확인 중"   # 내부 메모 (고객사 공유본에서 빠짐)

# 계약
pm contract
pm contract check delay-liability --status missing --note "고객사 지연 시 순연 조항 없음"
pm contract signed --date 2026-10-08
pm contract pay 착수금 --status paid

# 대시보드
pm build --open                           # 한 파일 HTML
pm serve --open                           # 로컬 서버, 화면에서 바꾼 것을 저장
pm build --project booking --client       # 고객사 공유본
```

날짜는 `YYYY-MM-DD`. `--project`를 빼면 지금 폴더의 git 저장소와 연결된 프로젝트를 쓰고, `--workspace 폴더`로 워크스페이스를 직접 정할 수 있다.

데모는 임시 폴더에서 본다. 등록된 워크스페이스는 그대로 둔다.

```bash
pm init demo --from sample --workspace /tmp/pm-demo && pm build --workspace /tmp/pm-demo --open
```

## 워크스페이스 구조

```
pm-workspace/                     (PM의 비공개 GitHub 저장소)
├─ pm-workspace.json              회사 이름, 자동 실행(schedule)·전체 업데이트(update) 설정
├─ projects/<id>/project.json     일정·범위·체크리스트·요청 목록·계약·결정·위험, 값마다 확인일·출처
├─ projects/<id>/docs/            요청 목록·킥오프 자료·주간 보고 초안 (--save)
├─ projects/<id>/github.json      이슈 스냅샷 (git 제외)
├─ projects/<id>/update.json      마지막 업데이트 결과와 기록 (git 제외)
├─ .pm-logs/                      자동 업데이트·서버 실행 기록 (git 제외)
└─ build/                         대시보드 파일 (git 제외)
```

예전 버전으로 만든 워크스페이스는 `pm setup`을 한 번 더 하면 `.gitignore`에 새 제외 항목이 덧붙는다.

워크스페이스를 고르는 순서: `--workspace` → `PM_DASHBOARD_HOME` → 지금 폴더(또는 상위)의 `pm-workspace.json` → `pm setup`이 등록한 워크스페이스(`~/.config/pm-dashboard/config.json`) → 예전 기본 위치 `~/.pm-dashboard`.

비밀번호·API 키·고객 개인정보는 넣지 않는다. 계정은 권한 초대로 받는다. `pm validate`가 흔한 키 모양과 비밀번호 표기를 잡는다.

## 개발

```
.claude-plugin/              plugin.json, marketplace.json
skills/pm/SKILL.md           스킬 본문
skills/pm/references/        세팅·체크리스트·요청 목록·계약·SRS·예측·데이터 형식
skills/pm/scripts/pm.mjs     CLI 진입점 (scripts/lib/: 워크스페이스·범위·GitHub·빌드·서버)
skills/pm/app/               대시보드 (index.html, js/forecast·core·docs·app·agent)
skills/pm/templates/         항목 라이브러리, 계약 점검, 새 프로젝트 뼈대, 데모
docs/DESIGN.md               설계
install.sh                   개발용 설치 (~/.claude/skills/pm 링크 + pm 명령)
```

- `forecast.js`, `core.js`, `docs.js`는 브라우저와 Node가 같이 쓴다. DOM에 의존하지 않게 둔다.
- 대시보드는 `pm build`가 `index.html`의 `<!-- PM:SCRIPTS -->` 자리에 데이터와 스크립트를 넣어 한 파일로 만든다.
- 표준 항목을 바꾸려면 `skills/pm/templates/library.json`을 고친다. 이미 만든 프로젝트에는 `pm scope`를 다시 적용할 때 새 항목만 추가된다.
- 검증: `claude plugin validate .`, `node --check`, 임시 워크스페이스에서 데모로 `pm build`·`pm serve`. `pm setup`은 기본 워크스페이스를 등록하므로 설정 폴더도 임시로 둔다.

  ```bash
  XDG_CONFIG_HOME=$(mktemp -d) node skills/pm/scripts/pm.mjs setup /tmp/pmws --company 데모회사
  node skills/pm/scripts/pm.mjs init demo --from sample --workspace /tmp/pmws
  node skills/pm/scripts/pm.mjs build --workspace /tmp/pmws --open
  ```

  `pm schedule install`은 설정 폴더와 상관없이 이 PC의 launchd(`~/Library/LaunchAgents`)에 등록하므로 검증에서 돌리지 않는다. `pm update --deep`은 Claude 사용량이 든다.

- 배포: `.claude-plugin/plugin.json`의 `version`을 올리고 push한다. 버전이 같으면 사용자에게 새 판이 가지 않는다.
