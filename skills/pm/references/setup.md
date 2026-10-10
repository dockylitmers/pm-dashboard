# 세팅: 워크스페이스, 저장소, 소통·보고

## PM 워크스페이스 (PM 한 사람당 한 번)

1. GitHub에 **비공개** 저장소를 만든다. 이름은 자유(예: `pm-workspace`). 고객사 정보와 내부 메모가 들어가므로 공개하지 않는다.
   ```bash
   gh repo create pm-workspace --private --clone && cd pm-workspace
   ```
2. 워크스페이스로 만든다.
   ```bash
   pm setup --company "회사 이름"
   pm setup --company "회사 이름" --import ~/.pm-dashboard   # 예전 데이터가 있으면
   ```
   `pm-workspace.json`, `projects/`, `.gitignore`, `README.md`가 생기고, 이 폴더가 기본 워크스페이스로 등록된다(`~/.config/pm-dashboard/config.json`). 이후 어느 폴더에서 `pm`을 실행해도 이 워크스페이스를 쓴다.
3. commit·push 한다. 다른 PC에서는 같은 저장소를 내려받아 `pm setup`을 한 번 더 하면 된다.

워크스페이스를 고르는 순서: `--workspace 폴더` → `PM_DASHBOARD_HOME` → 지금 폴더(또는 상위)의 `pm-workspace.json` → 등록된 워크스페이스 → 예전 기본 위치 `~/.pm-dashboard`.

`.gitignore`는 `build/`와 `projects/*/github.json`(이슈 스냅샷, 다시 받을 수 있음)을 뺀다.

## 개발 저장소 (프로젝트마다)

일정 예측과 이슈 화면은 GitHub 이슈·마일스톤을 읽는다. 규칙이 맞아야 숫자가 나온다.

- `project.json`의 `github.repo`에 `owner/repo`를 적는다(`pm init --repo` 또는 개발 저장소 폴더에서 `pm init`).
- 라벨과 마일스톤을 만든다.
  ```bash
  pm setup-repo           # 계획만 보여 준다
  pm setup-repo --apply   # 사용자 확인 뒤에 만든다(이미 있는 것은 건너뜀)
  ```

| 라벨 | 뜻 | 예측에서 |
|---|---|---|
| `epic` | 기능 묶음(하위 이슈를 묶는 이슈) | 뺀다 |
| `descope` | 범위에서 뺌 | 뺀다 |
| `bug`, `enhancement` | 버그, 기능 | 센다 |
| `확인요청` | 고객사 확인이 필요함 | 이슈 화면의 '고객사·논의 대기'에 모인다 |
| `blocked` | 고객사·공급사 때문에 막힘 | 센다 |

| 마일스톤 | 형식 | 예 |
|---|---|---|
| 스프린트 | `SP-NN · M/D~M/D` (주 단위, 월~금, 마감=금요일) | `SP-01 · 10/26~10/30` |
| 고객사 QA | `QA · M/D~M/D 고객사 QA` | `QA · 12/21~1/8 고객사 QA` |
| 출시 | `R · M/D 출시` | `R · 1/15 출시` |

다른 이름을 이미 쓰고 있으면 `forecastConfig.sprintPattern`(정규식)과 `releasePattern`을 바꾼다.

- 개발팀에 알릴 규칙: 이슈는 스프린트 마일스톤에 넣는다, 큰 일은 epic으로 묶고 하위 이슈로 쪼갠다, 범위에서 빼면 닫지 말고 `descope`를 붙이거나 not planned로 닫는다.
- 프로젝트 초기에 기존 작업을 한꺼번에 등록하면 그 이슈들은 '새 이슈 유입'이 아니다. 그 날짜를 `forecastConfig.baselineEnd`에 적는다(기본: 개발 시작 + 3일).

## 고객 소통 채널

- 요청·답·합의를 남기는 곳을 하나로 정한다. 권장은 Notion 요청 DB(요청 1건 = 1행, 상태·태그·날짜 속성).
- 고객사 확인 요청 목록은 그 DB의 한 행(예: '개발 관련 요청사항')에 표로 둔다. 추가 요청은 같은 표에 '추가 확인 요청 (날짜)' 구분 줄로 이어 붙인다.
- 메신저 대화도 결론은 요청 DB에 옮긴다. 원본이 하나여야 "그때 그렇게 말했잖아요"를 막을 수 있다.
- `project.json`의 `channels.notion.url`에 링크를 적으면 요청서의 '전달 방법'에 들어간다.

## 정기 보고

- 주간 진행상황: `pm report --save`(팀용, 속도·위험·결정 포함), `pm report --client --save`(고객사용, 진행률·다음 주·고객사 확인 필요).
- 보고 요일은 킥오프에서 정한다(기본 제안: 매주 금요일). 고객사 확인이 필요한 것과 회신 기한을 매번 넣으면 대기가 줄어든다.
- 팀 메신저에 자동으로 보내려면 저장소의 예약 작업(GitHub Actions 등)에서 `pm report`를 실행해 웹훅으로 보내는 방식으로 확장한다.
