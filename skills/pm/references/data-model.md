# 데이터 형식

## pm-workspace.json (워크스페이스 맨 위)

```json
{ "version": 1, "company": "회사 이름", "createdAt": "..." }
```

`company`는 요청서 서명("○○ PM입니다"), 공(ball)의 `us` 이름, 대시보드 부제목에 쓰인다. 예전 위치(`~/.pm-dashboard`)는 `config.json`에 같은 값을 둔다.

## project.json (`projects/<id>/project.json`)

빈 필드는 `pm`이 읽을 때 채운다(`core.js`의 `normalize`). 날짜는 모두 `YYYY-MM-DD`.

| 필드 | 형식 | 설명 |
|---|---|---|
| `id` | 문자열 | 폴더 이름과 같다. 영문 소문자·숫자·하이픈 |
| `name`, `client`, `kind`, `summary` | 문자열 | 이름, 고객사, 종류, 한 줄 설명 |
| `asOf` | 날짜 | 상태를 마지막으로 확인한 날 |
| `github.repo`, `repos` | `owner/repo` | 이슈 스냅샷을 받는 저장소, 같은 프로젝트로 볼 다른 저장소 |
| `dates` | 객체 | `kickoff`, `devStart`, `devEnd`, `qaStart`, `qaEnd`, `storeSubmit`, `launch` |
| `scope.features` | 문자열 배열 | 개발 범위(기능 키). `pm scope`로 바꾼다 |
| `phases`, `milestones`, `timeline` | | 타임라인. 비우면 날짜로 만든다 |
| `forecastConfig` | 객체 | `baselineEnd`, `epicLabel`, `descopeLabel`, `sprintPattern`, `releasePattern` |
| `clientLabels` | 문자열 배열 | 고객사·논의 대기를 뜻하는 이슈 라벨 |
| `receiveDefault`, `channels.notion` | | 요청서 기본 받을 곳, 고객 요청 DB 링크 |
| `categories` | `[{ id, name }]` | 분류 |
| `checklist` | 배열 | 아래 '체크리스트 항목' |
| `contract` | 객체 | 아래 '계약' |
| `decisions` | `[{ title, recommend, due, checked }]` | 결정이 필요한 일. 아래 '결정·위험' |
| `resolvedDecisions` | `[{ title, recommend, due, result, decidedAt, recordedAt, src }]` | 해결된 결정(무엇으로 언제 정했는지). `pm decision done`이 옮긴다. 고객사 공유본에서 빠짐 |
| `risks` | `[{ title, level, detail, mitigation, owner, due, checked }]` | level: `high`·`mid`·`low`. 아래 '결정·위험' |
| `resources` | `[{ id, name, glyph, desc, url }]` | 원본 위치 |
| `srs` | 객체 | `{ exists, location, url, summary, counts, platforms, roles, features }` |
| `queue` | 배열 | 승인 대기열(대시보드, `pm request --queue`) |
| `sprints` | `{ "SP-05": { goal, updated } }` | 스프린트 목표. 키는 GitHub 마일스톤 제목의 첫 낱말. `pm sprint`, 대시보드 스프린트 창. 고객사 공유본에서 빠짐 |

### 체크리스트 항목

| 필드 | 설명 | 고객사 공유본 |
|---|---|---|
| `id`, `cat`, `title` | 식별자, 분류 id, 이름 | 보임 |
| `status`, `ball` | 상태, 공(`client`·`us`·`dev`) | 보임 |
| `needBy`, `leadDays` | 필요 시점(kickoff·devStart·devMid·devEnd·qaStart·qaEnd·storeSubmit·launch), 준비 기간(일) | 보임 |
| `blocks`, `blocksDate` | 막는 일정 이름과 날짜. 비우면 needBy로 정한다 | 보임 |
| `sheet` | 고객사 확인 요청 목록에 나오는지(비우면 ball이 client일 때) | — |
| `need` | 확인/요청 내용(왜 필요한지) | 보임 |
| `fields` | `[{ label, proposal, answer }]` 정보 칸. proposal의 `{devStart}` 같은 자리는 날짜로 채워진다 | 보임 |
| `answer`, `answeredAt` | 칸에 맞지 않는 답(ㄴ), 답 받은 날 | 보임 |
| `proposal`, `note` | 항목 전체의 (제안), 고객사도 봐도 되는 결론 | 보임 |
| `requested`, `due`, `updated` | 요청일(대기 일수·차수), 기한, 최근 확인일 | 보임 |
| `res` | `{ label, url }` 원본 위치. 비밀값 금지 | 보임 |
| `mode`, `receiveAt`, `helper` | 요청서 기본 진행 방식, 받을 곳, `srs`면 SRS 도우미 | 보임 |
| `lib`, `scopeOff` | 라이브러리에서 온 항목, 범위에서 빠져 해당 없음이 된 항목 | 보임 |
| `checked` | `{ at, src, guess? }` 마지막으로 원본에서 확인한 날, 확인한 곳, 추정 여부. `pm answer`·`pm set --src`·`pm check`·대시보드 저장이 고친다 | **빠짐** |
| `internal` | 내부 메모(이슈 번호, 담당자, 사정) | **빠짐** |
| `history` | `[{ date, text }]` 기록 | **빠짐** |

계산되는 값(파일에 쓰지 않음): `askBy`(요청 시작일), `waitDays`(대기 일수), `late`(요청 시작일 지남), `overdue`(기한 지남 또는 D+7 초과), `priority`(⭐, 요청 시작일까지 7일 이내), `inSheet`.
최신화 계산: `checkedAt`(checked.at·answeredAt·updated 중 가장 늦은 날), `ageDays`, `guess`, `stale`(확정·해당 없음이 아닌데 14일 넘게 확인 안 함. 아직 손대지 않은 '없음' 항목은 빼고 요청 시작일로 챙긴다), `recheck`(추정 또는 오래됨). `pm refresh`는 여기에 '확인 뒤 GitHub 이슈가 바뀜'을 더한다.

### 예

```json
{
  "id": "cs",
  "cat": "business",
  "title": "고객센터 운영 시간·전화번호",
  "status": "requested",
  "ball": "client",
  "needBy": "qaStart",
  "leadDays": 5,
  "sheet": true,
  "need": "고객에게 안내할 운영 시간과 대표 전화번호",
  "fields": [
    { "label": "운영 시간", "proposal": "평일 09:00~18:00", "answer": "" },
    { "label": "대표 전화번호" }
  ],
  "requested": "2026-10-12",
  "history": [{ "date": "2026-10-12", "text": "고객사 확인 요청 목록으로 요청" }]
}
```

### 결정·위험

| 필드 | 설명 |
|---|---|
| `title` | 결정할 일·위험 이름 |
| `recommend` | (결정) 권장안 |
| `level`, `detail`, `mitigation`, `owner` | (위험) 영향 `high`·`mid`·`low`, 내용, 대응, 담당(선택) |
| `due` | 기한 `YYYY-MM-DD`. 위험은 대응을 다시 볼 날. 화면은 오늘과 비교해 'D-2', '오늘', '2일 지남'으로 보여 주고, 지난 것은 할 일·브리핑 맨 앞에 올린다 |
| `checked` | `{ at, src, guess? }` 원본에서 마지막으로 확인한 날·출처·추정 여부(체크리스트 항목과 같은 형식) |

`pm decision`·`pm risk`가 쓴다. `--due`에 '오늘'·'내일'·'모레'·'이번 주'(그 주 금요일)·'다음 주'(다음 주 금요일)·'10/16'·'+3'을 주면 쓰는 날 기준 날짜로 바꿔 저장한다. 주말(토·일)에 쓰면 그 주가 끝났으므로 '이번 주'와 '다음 주' 모두 다가오는 주의 금요일이다. 달력에 없는 날짜(2026-02-30, 2026-13-45)와 값 없는 `--due`는 거부한다. 날짜가 아닌 옛 값(0.7 이전의 '이번 주' 같은 글자)과 달력에 없는 날짜는 화면에 글자 그대로 보이고 계산하지 않으며, `pm validate`가 경고한다. 결정·위험은 고객사 공유본에서 빠진다.

결정이 내려지면 `pm decision done <번호> --result "무엇으로 정했는지" --date 결정한날 --src 출처`로 결정 필요 목록에서 빼고 `resolvedDecisions`에 남긴다(`recordedAt`은 기록한 날). 화면의 '결정 필요' 카드 아래 '최근 정한 것'(30일 안, 5건)과 주간 보고(내부용)의 '이번 주 정한 것'에 나온다. 결과는 체크리스트·일정에도 반영한다. 목록은 `pm decision resolved`.

```json
{ "title": "로그인 방식", "recommend": "카카오·네이버·Apple 로그인, 이메일 가입은 2차", "due": "2026-10-16", "checked": { "at": "2026-10-12", "src": "킥오프 회의" } }
```

### 계약

```json
{
  "signedAt": "2026-10-08",
  "review": [{ "id": "acceptance", "title": "검수 방법·기간·통과 기준이 있다", "why": "...", "status": "risk", "note": "검수 기간 없음" }],
  "payments": [{ "name": "잔금", "ratio": 30, "trigger": "최종 검수 완료", "anchor": "qaEnd", "status": "planned" }]
}
```

review.status: `unchecked`·`ok`·`risk`·`missing`·`na`. payments.status: `planned`·`invoiced`·`paid`. 계약은 고객사 공유본에서 빠진다.

## github.json

`pm sync`가 만든다. 직접 고치지 않는다. `{ repo, syncedAt, milestones: [{ number, title, state, due, open, closed }], issues: [{ n, t, s, r, c, x, m, l, a }] }`.

## update.json

`pm update`(대시보드 버튼, 자동 실행 포함)가 만든다. git에 올리지 않는다. `{ last: { at, mode(quick·deep), trigger(manual·dashboard·schedule), ok, durationSec, steps: [{ key(github·recheck·deep), name, ok, detail }], recheck: { total, guess, moved, stale }, recheckItems: [{ id, title, kind, github }], summary, changed: [{ id, what }], asks: [{ id, question }], cost, error, sources: { github, client } }, history: [{ at, mode, trigger, ok, summary, error? }] }` (기록은 30개까지). `changed`·`asks`·`cost`는 전체 업데이트일 때만 채워진다.

`sources`는 원본별로 마지막으로 읽기에 성공한 시각이다(`github`: GitHub 이슈, `client`: 전체 업데이트가 고객사 답(Notion)·GitHub 코멘트를 읽은 때). 한 단계가 실패하면 그 원본은 앞의 시각을 그대로 두므로, 대시보드는 'GitHub 08:30 · 고객사 답 10/13 18:34'처럼 원본마다 기준 시각을 따로 보여 준다. 0.8 이전 기록에는 없어서, 화면은 기록에서 마지막으로 성공한 전체 업데이트와 GitHub 스냅샷 시각으로 대신 계산한다.

`pm-workspace.json`의 설정: `schedule`(`{ times, deep, serve, installedAt }`, 자동 실행), `update`(`{ allowedTools, model, maxBudgetUsd }`, 전체 업데이트에 더할 읽기 도구·모델·비용 한도, 모두 선택).

## templates/

| 파일 | 내용 |
|---|---|
| `library.json` | 범위 기능 목록과 표준 항목 51개(`when`, `needBy`, `leadDays`, `fields`) |
| `contract.json` | 계약 점검 12항목, 기본 대금 단계 |
| `project.json` | 새 프로젝트 뼈대 |
| `sample-project.json` | 데모 (`pm init demo --from sample`) |
