# pm-dashboard

외주 개발 프로젝트를 관리하는 PM 시스템이다. Claude Code 플러그인으로 설치하면 여러 프로젝트에서 같은 방식으로 쓸 수 있다.

- **킥오프 체크리스트**: 고객사에서 받아야 할 자료·계정·정책 36항목. 무엇이 없고, 공(다음 행동)이 누구에게 있고, 며칠째 기다리는지
- **고객사 요청서·리마인드**: 받을 곳과 진행 방식을 고르면, (제안) 값을 채운 요청서 초안이 나온다. 보내는 것은 사람
- **SRS 생성·보완**: 계약 범위·회의록·이슈로 9개 절 초안, 줄마다 확정·확인 요청·제안·준비 필요
- **일정 예측**: GitHub 이슈로 처리·유입 속도를 계산해 예상 완료일을 범위로, 목표일에 남을 양과 필요 처리량까지
- **대시보드**: 한 파일 HTML 또는 로컬 서버. 캐릭터 에이전트 '리미'가 상태에 따라 색이 바뀌고 대화한다. 고객사 공유본은 내부 정보를 빼고 만든다

설계는 [docs/DESIGN.md](docs/DESIGN.md)에 있다.

## 설치

### A. 플러그인 (권장)

Claude Code에서:

```
/plugin marketplace add dockylitmers/pm-dashboard
/plugin install pm-dashboard@pm-dashboard
```

비공개 저장소라 저장소에 초대받은 GitHub 계정으로 이 PC의 git이 접근할 수 있어야 한다(동료는 collaborator로 초대). SSH 키가 없으면 `gh auth login` 뒤 `gh auth setup-git`을 한 번 실행한다. 새 버전은 `/plugin marketplace update pm-dashboard`로 받는다.

스킬 이름은 `/pm-dashboard:pm`이다. 이름을 부르지 않아도 "고객사에 뭐 요청해야 해?", "마감 맞출 수 있어?" 같은 말에 Claude가 이 스킬을 쓴다.

### B. 개발용 (저장소를 직접 고칠 때)

```bash
git clone git@github.com:dockylitmers/pm-dashboard.git
cd pm-dashboard && ./install.sh
```

`~/.claude/skills/pm`에 링크를 걸고, 터미널용 `pm` 명령을 `~/.local/bin`에 만든다. 플러그인과 같이 설치하면 스킬이 두 번 보이니 하나만 쓴다.

필요한 것: Node 18 이상. GitHub 이슈를 받으려면 `gh auth login` 또는 `GITHUB_TOKEN`.

## 빠른 시작

Claude Code에서 프로젝트 폴더를 열고 말하면 된다.

> 이 프로젝트 PM 대시보드에 등록해 줘. 고객사는 ○○, 개발 10/26~12/18, QA 12/21~1/8, 출시 1/15야.
>
> 오늘 뭐부터 해?
>
> 환불 정책이 없는데 고객사에 요청서 써 줘.
>
> 10/30 맞출 수 있어? 안 되면 뭘 바꿔야 해?

터미널에서 직접 쓸 수도 있다(개발용 설치 기준, 플러그인이면 Claude가 대신 실행한다).

```bash
pm config company "회사 이름"
pm init myapp --client "고객사" --repo owner/repo --dev-start 2026-10-26 --dev-end 2026-12-18 --launch 2027-01-15
pm sync                       # GitHub 이슈·마일스톤 받기
pm status                     # 브리핑·예측·준비율·고객사 대기
pm list --status missing      # 없는 자료
pm request refund --mode draft   # 요청서 초안 (보내지 않음)
pm set refund --status requested --log "요청 DB로 요청"
pm forecast --inflow -30      # 유입이 30% 줄면?
pm build --open               # 대시보드 (모든 프로젝트)
pm serve --open               # 화면에서 바꾼 상태를 파일에 저장하는 로컬 서버
pm build --project myapp --client   # 고객사 공유본
```

데모를 보려면 `pm init demo --from sample && pm build --open`.

## 데이터

프로젝트 데이터는 고객사 저장소가 아니라 `~/.pm-dashboard/`(또는 `PM_DASHBOARD_HOME`)에 있다.

```
~/.pm-dashboard/
├─ config.json                    회사 이름
├─ projects/<id>/project.json     일정·체크리스트·결정·위험·리소스·승인 대기열
├─ projects/<id>/github.json      이슈 스냅샷 (pm sync)
└─ build/                         대시보드 파일
```

- `project.json`은 사람과 Claude가 고친다. 형식은 [skills/pm/references/data-model.md](skills/pm/references/data-model.md).
- 비밀번호·API 키·고객 개인정보는 넣지 않는다. 링크와 이름만 둔다(`pm validate`가 흔한 키 모양을 잡는다).
- 여러 PC에서 쓰려면 `~/.pm-dashboard`를 비공개 git 저장소로 만들어 동기화한다. `build/`와 `github.json`은 다시 만들 수 있으니 제외해도 된다.

## 대시보드의 리미 (Claude 모드)

키가 없으면 대시보드 데이터로 답하는 내장 모드다. Claude로 답하게 하려면:

- 권장: `ANTHROPIC_API_KEY=... pm serve --open` — 서버가 호출하고 브라우저에는 키가 없다.
- 또는 대화창의 '내장 모드' 버튼에서 키를 넣는다 — 그 브라우저에만 저장되고 브라우저에서 바로 호출한다. 개인 PC에서만.

리미는 읽기, 계산, 화면 열기, 요청서 초안까지만 한다. 보내지 않는다.

## 개발

```
.claude-plugin/          plugin.json, marketplace.json
skills/pm/SKILL.md       스킬 본문
skills/pm/references/    참고 문서
skills/pm/scripts/pm.mjs CLI
skills/pm/app/           대시보드 (index.html, js/forecast·core·app·agent)
skills/pm/templates/     표준 체크리스트, 데모
docs/DESIGN.md           설계
install.sh               개발용 설치
```

- `forecast.js`, `core.js`는 브라우저와 Node가 같이 쓴다. DOM에 의존하지 않게 둔다.
- 대시보드는 `pm build`가 `index.html`의 `<!-- PM:SCRIPTS -->` 자리에 데이터와 스크립트를 넣어 한 파일로 만든다.
- 검증: `claude plugin validate .`, `node --check skills/pm/scripts/pm.mjs`, 데모로 `pm build`·`pm serve`를 띄워 본다.
- 배포: `.claude-plugin/plugin.json`의 `version`을 올리고 push한다. 버전이 같으면 사용자에게 새 판이 가지 않는다.
