# pm-dashboard

외주 개발 프로젝트를 관리하는 PM 시스템이다. Claude Code 플러그인으로 설치하고, PM이 만든 비공개 GitHub 저장소 하나(PM 워크스페이스)에서 모든 프로젝트를 관리한다.

- **킥오프 4단계**: 계약 확인 → 범위·SRS → 고객사 요청 → 기본 세팅. 항목마다 필요 시점과 준비 기간으로 '언제까지 요청해야 하는지'를 계산해 이번 주 할 일을 뽑는다
- **고객사 확인 요청 목록**: 개발 범위(앱, 결제, 소셜 로그인, 알림톡…)를 고르면 고객사에 받아야 할 목록이 나온다. Notion 요청 페이지와 같은 모양(분야·항목·확인/요청 내용·정보·비고), 우리 제안값은 분홍, 고객사 답은 노랑, 추가 요청은 '추가 확인 요청 (날짜)'로 이어 붙인다
- **계약 점검**: 범위 부속서, 검수, 대금과 검수 연결, 고객사 지연 시 일정 순연 등 12항목과 대금 단계
- **기본 세팅**: GitHub 라벨·주 단위 스프린트·출시 마일스톤을 일정 예측 규칙에 맞게 만든다
- **문서 초안**: 킥오프 회의 자료(고객사용·내부용), 주간 진행상황(팀용·고객사용), 요청서·리마인드
- **일정 예측**: GitHub 이슈로 처리·유입 속도를 계산해 예상 완료일을 범위로, 목표일에 남을 양과 필요 처리량까지
- **대시보드**: 한 파일 HTML 또는 로컬 서버. 캐릭터 에이전트 '리미'가 상태에 따라 색이 바뀌고 대화한다. 고객사 공유본은 내부 정보를 데이터에서 빼고 '개발 관련 요청사항' 화면을 보여 준다

설계는 [docs/DESIGN.md](docs/DESIGN.md)에 있다.

## 처음 쓰는 PM

### 1. 플러그인 설치 (PC마다 한 번)

Claude Code에서:

```
/plugin marketplace add dockylitmers/pm-dashboard
/plugin install pm-dashboard@pm-dashboard
```

비공개 저장소라 저장소에 초대받은 GitHub 계정으로 이 PC의 git이 접근할 수 있어야 한다(SSH 키, 또는 `gh auth login` 뒤 `gh auth setup-git`). 새 버전은 `/plugin marketplace update pm-dashboard`.

필요한 것: Node 18 이상. GitHub 이슈를 받으려면 `gh auth login` 또는 `GITHUB_TOKEN`.

### 2. PM 워크스페이스 만들기 (PM 한 사람당 한 번)

GitHub에 **비공개** 저장소를 하나 만들어 내려받고, 그 폴더에서 Claude Code를 연다.

```bash
gh repo create pm-workspace --private --clone && cd pm-workspace && claude
```

> PM 워크스페이스로 세팅해 줘. 회사 이름은 ○○야.

Claude가 `pm setup`을 실행해 `pm-workspace.json`, `projects/`, `.gitignore`, `README.md`를 만들고 이 폴더를 기본 워크스페이스로 등록한다. 이후 어느 폴더에서 일해도 PM 데이터는 여기에 쌓인다. 변경은 평소처럼 commit·push 하면 다른 PC와 맞춰진다.

### 3. 프로젝트 등록과 킥오프

> 새 프로젝트 등록해 줘. 고객사는 ○○, 앱·관리자 웹·결제·카카오 로그인·알림톡, 개발 10/26~12/18, 고객사 QA 12/21~1/8, 출시 1/15. 저장소는 ○○/○○.
>
> 이번 주 킥오프 할 일 알려 줘.
>
> 계약서 점검하자. (계약서 파일을 주면 읽고 12항목을 점검한다)
>
> 고객사에 보낼 요청 목록 만들어 줘. Notion에 올릴 수 있게.
>
> 킥오프 회의 자료 만들어 줘.
>
> 저장소 라벨이랑 스프린트 만들어 줘. (계획을 먼저 보여 주고 확인 뒤 만든다)

### 4. 진행 중

> 오늘 뭐부터 해? · 고객사 답 기다리는 거 정리해 줘 · 10/30 맞출 수 있어? · 주간 보고 써 줘 · 대시보드 열어 줘

## 명령 (터미널)

Claude가 대신 실행하지만, 터미널에서 쓰려면 `pm install-cli`로 `~/.local/bin/pm`을 만든다.

```bash
pm setup --company "회사"                 # 워크스페이스 (--import ~/.pm-dashboard)
pm init myapp --client "고객사" --scope app,admin,payment --dev-start 2026-10-26 --dev-end 2026-12-18 --launch 2027-01-15
pm scope --list | --add payment | --remove web
pm kickoff                                # 4단계와 이번 주 할 일
pm contract | contract check <id> --status ok|risk|missing|na | contract pay 잔금 --status paid
pm sheet [--format notion] [--only-new] [--save]   # 고객사 확인 요청 목록
pm sheet --mark-sent                      # 보낸 뒤
pm answer cs "대표 전화번호=02-000-0000" [--confirm]
pm setup-repo [--apply]                   # 라벨·스프린트 마일스톤
pm kickoff-kit [--internal] [--save]      # 킥오프 회의 자료
pm report [--client] [--save]             # 주간 진행상황
pm sync && pm status                      # 이슈 스냅샷, 브리핑
pm forecast --inflow -30                  # 가정 바꿔 예측
pm build --open | serve --open | build --project myapp --client
```

데모: `pm init demo --from sample && pm build --open`.

## 워크스페이스 구조

```
pm-workspace/                     (PM의 비공개 GitHub 저장소)
├─ pm-workspace.json              회사 이름 등
├─ projects/<id>/project.json     일정·범위·체크리스트·요청 목록·계약·결정·위험
├─ projects/<id>/docs/            요청 목록·킥오프 자료·주간 보고 초안
├─ projects/<id>/github.json      이슈 스냅샷 (git 제외)
└─ build/                         대시보드 파일 (git 제외)
```

비밀번호·API 키·고객 개인정보는 넣지 않는다. 계정은 권한 초대로 받는다(`pm validate`가 흔한 키 모양과 비밀번호 표기를 잡는다).

## 대시보드의 리미 (Claude 모드)

키가 없으면 대시보드 데이터로 답하는 내장 모드다. Claude로 답하게 하려면 `ANTHROPIC_API_KEY=... pm serve --open`(서버가 호출, 브라우저에 키 없음) 또는 대화창에서 키를 넣는다(그 브라우저에만 저장, 개인 PC에서만). 리미는 읽기, 계산, 화면 열기, 초안까지만 하고 보내지 않는다.

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
- 표준 항목을 바꾸려면 `templates/library.json`을 고친다. 이미 만든 프로젝트에는 `pm scope`를 다시 적용할 때 새 항목만 추가된다.
- 검증: `claude plugin validate .`, `node --check`, 임시 워크스페이스(`PM_DASHBOARD_HOME=/tmp/ws`)에서 데모로 `pm build`·`pm serve`.
- 배포: `.claude-plugin/plugin.json`의 `version`을 올리고 push한다. 버전이 같으면 사용자에게 새 판이 가지 않는다.
