# 데이터 형식

## config.json (`~/.pm-dashboard/config.json`)

```json
{ "company": "회사 이름" }
```

`company`는 요청서 서명("○○ PM입니다"), 공(ball)의 `us` 이름, 대시보드 부제목에 쓰인다.

## project.json (`~/.pm-dashboard/projects/<id>/project.json`)

빈 필드는 `pm`이 읽을 때 채운다(`core.js`의 `normalize`). 날짜는 모두 `YYYY-MM-DD`.

| 필드 | 형식 | 설명 |
|---|---|---|
| `id` | 문자열 | 폴더 이름과 같다. 영문 소문자·숫자·하이픈 |
| `name`, `client`, `kind`, `summary` | 문자열 | 프로젝트 이름, 고객사, 종류(예: 앱·웹 외주 개발), 한 줄 설명 |
| `asOf` | 날짜 | 체크리스트 상태를 마지막으로 확인한 날 |
| `github.repo` | `owner/repo` | `pm sync`가 이슈를 받는 저장소. 지금 폴더의 git 저장소와 같으면 `--project` 없이 찾는다 |
| `repos` | 문자열 배열 | 같은 프로젝트로 볼 다른 저장소(선택) |
| `dates` | 객체 | `kickoff`, `devStart`, `devEnd`, `qaStart`, `qaEnd`, `launch` |
| `phases` | 배열 | `{ name, kind, start, end }`. kind는 `kickoff`·`dev`·`qa`·`review`. 비우면 dates로 만든다 |
| `milestones` | 배열 | `{ name, date }` 타임라인의 주요 일정. 비우면 출시일 |
| `timeline` | 객체 | `{ start, end }` 타임라인 범위. 비우면 날짜로 만든다 |
| `forecastConfig` | 객체 | `baselineEnd`, `epicLabel`, `descopeLabel`, `sprintPattern`, `releasePattern` (`references/forecast.md`) |
| `clientLabels` | 문자열 배열 | 고객사·논의 대기를 뜻하는 이슈 라벨(예: `확인요청`) |
| `receiveDefault` | 문자열 | 요청서의 기본 받을 곳: `notion`·`drive`·`email`·`repo` |
| `channels.notion` | `{ label, url }` | 고객 요청 DB 링크. 요청서의 전달 방법에 들어간다 |
| `categories` | 배열 | `{ id, name }` 체크리스트 분류 |
| `checklist` | 배열 | 아래 '체크리스트 항목' |
| `decisions` | 배열 | `{ title, recommend, due }` 결정이 필요한 일. 결정되면 뺀다 |
| `risks` | 배열 | `{ title, level, detail, mitigation }`. level은 `high`·`mid`·`low` |
| `resources` | 배열 | `{ id, name, glyph, desc, url }` 원본 위치(저장소, 요청 DB, 계약 폴더, 디자인 파일…) |
| `srs` | 객체 | `{ exists, location, url, summary, counts: { ask, prop, prep }, platforms, roles, features: [{ id, name, desc, status }] }` |
| `queue` | 배열 | 승인 대기열. 대시보드와 `pm request --queue`가 넣는다 |
| `sample` | 불리언 | 데모 프로젝트 표시 |

### 체크리스트 항목

| 필드 | 설명 | 고객사 공유본 |
|---|---|---|
| `id`, `cat`, `title` | 식별자, 분류 id, 이름 | 보임 |
| `status` | `missing`·`requested`·`received`·`confirmed`·`not_needed` | 보임 |
| `ball` | `client`·`us`·`dev` | 보임 |
| `res` | `{ label, url }` 원본 위치. 비밀값은 넣지 않는다 | 보임 |
| `requested` | 요청한 날. 대기 일수(D+n)를 센다 | 보임 |
| `due`, `updated` | 기한, 최근 확인일 | 보임 |
| `blocks`, `blocksDate` | 이 항목이 막는 일정과 그 날짜 | 보임 |
| `need`, `proposal` | 요청서의 필요한 내용, (제안) 값 | 보임 |
| `note` | 고객사도 봐도 되는 결론 한 줄 | 보임 |
| `internal` | 내부 메모(이슈 번호, 담당자, 사정) | **빠짐** |
| `history` | `[{ date, text }]` 기록 | **빠짐** |
| `helper` | `srs`이면 SRS 도우미 버튼을 보여 준다 | 보임 |
| `mode`, `receiveAt` | 요청서 기본 진행 방식, 받을 곳 | 보임 |

### 예

```json
{
  "id": "refund",
  "cat": "policy",
  "title": "취소·환불 정책",
  "status": "requested",
  "ball": "client",
  "requested": "2026-10-10",
  "due": "2026-10-17",
  "blocks": "결제 개발",
  "blocksDate": "2026-11-16",
  "mode": "draft",
  "need": "취소 시점별 환불 기준과 예외",
  "proposal": "이용 24시간 전 전액, 이후 50%, 노쇼 환불 없음",
  "res": { "label": "Notion 요청 DB '환불 정책'", "url": "https://..." },
  "internal": "결제 모듈 이슈와 같이 볼 것",
  "history": [{ "date": "2026-10-10", "text": "상태 없음 → 요청함 · Notion 요청 DB로 요청" }]
}
```

## github.json

`pm sync`가 만든다. 직접 고치지 않는다. `{ repo, syncedAt, milestones: [{ number, title, state, due, open, closed }], issues: [{ n, t, s, r, c, x, m, l, a }] }` — 이슈는 번호, 제목, 상태, 닫힌 이유, 만든 시각, 닫힌 시각, 마일스톤 번호, 라벨, 담당자.
