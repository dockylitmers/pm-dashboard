#!/usr/bin/env node
/**
 * pm — 외주 개발 프로젝트 PM 도구. Node 18 이상, 설치할 의존성 없음.
 *
 * PM이 만든 비공개 저장소를 내려받아 `pm setup`하면 그 폴더가 워크스페이스가 되고,
 * 모든 프로젝트를 그 안에서 관리한다(lib/workspace.mjs). 명령은 `pm help`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BALLS, Core, DATE_RE, Docs, F, fmt, gitRemoteRepo, ID_RE, isDate, list, openFile, pad, parseArgs, parseDate, parseDue, SKILL_DIR, today, UsageError } from "./lib/common.mjs";
import { dashboardHtml } from "./lib/build.mjs";
import { setupRepo, sync } from "./lib/github.mjs";
import { applyScope, library, newProject } from "./lib/library.mjs";
import { markSent, serve } from "./lib/server.mjs";
import { scheduleInstall, scheduleRemove, scheduleStatus } from "./lib/schedule.mjs";
import { buildModel, deepCheck, readUpdate, refreshReport, runUpdate, runningUpdate } from "./lib/update.mjs";
import { locate, registered, setup, Workspace } from "./lib/workspace.mjs";

const commands = {};
const ws = (args) => Workspace.open(args);

// ---------------------------------------------------------------- 전체 업데이트 중 막는 변경
// 전체 업데이트(headless Claude)가 도는 동안에는 지우거나 되돌리기 어려운 변경(결정 해결 처리, 위험 지우기, 범위 바꾸기,
// '보냄' 표시, 계약 바꾸기, GitHub 쓰기, --out 파일 쓰기, 설정·자동 실행 바꾸기)을 막는다. 두 가지로 안다:
// - 그 Claude가 부르는 CLI에 붙는 PM_DEEP_UPDATE=1
// - 워크스페이스의 .pm-update.lock이 전체 업데이트(mode deep)이고 그 프로세스가 살아 있을 때(오래된 잠금은 무시)
// 인자 모양이 아니라 실제로 실행될 동작 바로 앞에서 확인한다(guardDeep을 그 자리에서 부른다)
function deepLock(w, args) {
  try {
    const target = w || (() => {
      const found = locate(args || {});
      return found ? new Workspace(found.dir, found.source) : null;
    })();
    const lock = target ? runningUpdate(target) : null;
    return lock && lock.mode === "deep" ? lock : null;
  } catch {
    return null;
  }
}
function guardDeep(what, { w = null, args = null } = {}) {
  if (process.env.PM_DEEP_UPDATE === "1")
    throw new UsageError(`전체 업데이트 중에는 ${what}을(를) 할 수 없습니다(지우거나 되돌리기 어려운 변경). 전체 업데이트 안이라면 asks로 PM에게 물으세요.`);
  const lock = deepLock(w, args);
  if (lock)
    throw new UsageError(`전체 업데이트 중이라(${localTime(lock.at)} 시작) 지금은 ${what}을(를) 할 수 없습니다. 끝난 뒤 다시 하세요(보통 몇 분, 상태는 pm schedule).`);
}

const target = (args) => {
  const w = ws(args);
  return { w, id: w.resolveId(args, gitRemoteRepo()) };
};
const syncAge = (iso) => {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return hours < 1 ? "1시간 안" : hours < 48 ? `${Math.round(hours)}시간 전` : `${Math.round(hours / 24)}일 전`;
};

commands.help = () => {
  console.log(`pm — 외주 개발 프로젝트 PM 도구

시작 (PM 한 사람당 한 번)
  setup [폴더] [--company 회사] [--import ~/.pm-dashboard]
                                  내려받은 PM 저장소를 워크스페이스로 만든다
  workspace                       지금 쓰는 워크스페이스와 프로젝트
  config [key [value]]            공통 설정 (company: 회사 이름)
  install-cli                     터미널에서 쓸 pm 명령을 ~/.local/bin에 만든다

프로젝트
  init <id> --name 이름 --client 고객사 [--repo owner/repo] [--scope app,admin,payment,...]
            [--kickoff D] [--dev-start D] [--dev-end D] [--qa-start D] [--qa-end D] [--store-submit D] [--launch D]
            [--from sample]       새 프로젝트 (범위로 체크리스트·요청 목록이 정해진다)
  scope [--list] [--set a,b] [--add a] [--remove b]   개발 범위(플랫폼·기능) 보기·바꾸기
  projects                        등록된 프로젝트
  validate [--all]                project.json 점검

최신화 (값마다 언제·어디서 확인했는지 남기고, 오래되거나 추정한 값을 다시 확인)
  refresh [--json] [--offline]    다시 확인할 값: 추정 · ${Core.STALE_DAYS}일 넘게 확인 안 함 · 확인 뒤 GitHub 이슈가 바뀜
  check <item...> --src 출처 [--guess] [--note 메모]
                                  값을 원본에서 확인함으로 기록(값이 그대로일 때). --guess는 추정으로 표시
  update [--all] [--deep] [--offline]
                                  빠른: GitHub 이슈 스냅샷 + 다시 확인할 값. --deep: Claude가 원본(GitHub 코멘트,
                                  Notion 요청 페이지)을 읽고 이 워크스페이스의 값을 고친다(원본에는 쓰지 않음)
  doctor                          전체 업데이트에 필요한 것(Claude Code, Notion 연결, GitHub 로그인) 점검
  schedule [status]               자동 업데이트 상태와 프로젝트별 마지막 업데이트
  schedule install [--times 08:30,12:30,18:30] [--deep] [--no-serve]
                                  매일 정해진 시각에 pm update --all [--deep] (macOS). 대시보드 서버도 계속 켜 둔다
  schedule remove                 자동 업데이트·서버 끄기

킥오프·현황
  status [--json]                 브리핑·킥오프 단계·예측·고객사 대기
  kickoff [--json]                킥오프 4단계와 이번 주 할 일
  kickoff-kit [--internal] [--save]   킥오프 회의 자료 (안건·요청·첫 2주 계획)
  report [--client] [--save]      주간 진행상황 보고 초안
  sync [--all]                    GitHub 이슈·마일스톤 스냅샷
  forecast [--velocity %] [--inflow %] [--descope n]   가정을 바꿔 일정 예측
  setup-repo [--apply]            GitHub 라벨·스프린트 마일스톤 (기본은 계획만 보여 줌)

고객사 요청
  sheet [--format md|notion] [--only-new] [--save] [--mark-sent [--date D]]
                                  고객사 확인 요청 목록 (분홍=제안값, 노랑=고객사 답)
  answer <item> "라벨=값" ... [--note 답] [--confirm] [--src 출처]   고객사 답 기록
  request <item> [--receive notion|drive|email|repo] [--mode ask|draft|meeting] [--due D] [--queue]
                                  항목 하나의 요청서·리마인드 초안 (보내지 않음)
  list [--status s] [--ball client|us|dev] [--cat c] [--recheck] [--json]
  sprint [<SP-05> --goal "목표"]    스프린트 목록과 목표 보기·입력
  set <item> [--status s] [--ball b] [--requested today|D] [--due D] [--res-label t] [--res-url u] [--log 기록]
             [--src 출처] [--guess] [--note 결론] [--internal 내부 메모]

결정·위험 (기한은 날짜로 저장: YYYY-MM-DD, 10/16, 오늘, 내일, "이번 주"=그 주 금요일, "다음 주"는 쓰는 날 기준으로 바꾼다.
          주말에 쓰면 "이번 주"·"다음 주" 모두 다가오는 주의 금요일)
  decision [--json]               결정 필요 목록 (번호 · 기한 D-n/n일 지남 · 확인일)
  decision add "제목" --recommend 권장안 --due 기한 [--src 출처] [--guess]
  decision set <번호> [--title t] [--recommend r] [--due 기한 | --no-due] [--src 출처] [--guess]
  decision check <번호...> --src 출처 [--guess]    원본에서 다시 확인함(값은 그대로)
  decision done <번호> --result 결과 [--date 결정한 날] [--src 출처]
                                  결정됨: 목록에서 빼고 결과·날짜를 해결된 결정에 남긴다
  decision resolved [--json]      해결된 결정 (최근 것부터)
  risk [--json]                   위험 목록
  risk add "제목" --level high|mid|low [--detail 내용] [--mitigation 대응] [--owner 담당] [--due 기한] [--src 출처]
  risk set <번호> [--title] [--level] [--detail] [--mitigation] [--owner] [--due] [--src] [--guess]
  risk check <번호...> --src 출처 [--guess]
  risk remove <번호>

계약
  contract                        계약 점검·대금 단계 보기
  contract check <id> --status ok|risk|missing|na [--note 메모]
  contract pay <이름> --status invoiced|paid [--date D]
  contract signed --date D

대시보드
  build [--project id] [--client] [--out 파일] [--open]   한 파일 HTML (--client: 고객사 공유본)
  serve [--port 4477] [--open]    로컬 서버. 화면에서 바꾼 상태를 project.json에 저장

D는 YYYY-MM-DD. --project를 빼면 지금 폴더의 git 저장소와 연결된 프로젝트를 쓴다.
--workspace 폴더로 워크스페이스를 직접 정할 수 있다.`);
};

// ---------------------------------------------------------------- 시작

commands.setup = (args) => {
  const dir = path.resolve(args._[0] || process.cwd());
  guardDeep("워크스페이스 세팅(pm setup)", { w: new Workspace(dir, "setup"), args });
  const importFrom = typeof args.import === "string" ? args.import.replace(/^~(?=\/|$)/, os.homedir()) : null;
  const result = setup(dir, { company: typeof args.company === "string" ? args.company : undefined, importFrom });
  console.log(`${result.existed ? "워크스페이스를 갱신했습니다" : "워크스페이스를 만들었습니다"}: ${dir}`);
  if (result.imported.length) console.log(`- 가져온 프로젝트: ${result.imported.join(", ")}`);
  if (!result.isGit) console.log("- git 저장소가 아닙니다. GitHub에 비공개 저장소를 만들고 내려받은 폴더에서 쓰기를 권합니다.");
  else if (!result.remote) console.log("- 원격 저장소가 없습니다. GitHub 비공개 저장소를 origin으로 연결하세요.");
  if (result.visibility === "PUBLIC") console.log("! 이 저장소는 공개(PUBLIC)입니다. 고객 정보가 들어가니 비공개로 바꾸세요: gh repo edit --visibility private");
  else if (result.visibility) console.log(`- 원격 저장소: ${result.visibility.toLowerCase()}`);
  if (!importFrom && fs.existsSync(path.join(os.homedir(), ".pm-dashboard", "projects")) && dir !== path.join(os.homedir(), ".pm-dashboard"))
    console.log("- 예전 위치(~/.pm-dashboard)에 프로젝트가 있습니다. 옮기려면: pm setup --import ~/.pm-dashboard");
  console.log("- 이제 어느 폴더에서든 pm이 이 워크스페이스를 씁니다.");
  console.log("- 다음: pm init <id> ... → git add -A && git commit -m 'pm: <id> 등록' && git push");
};

commands.workspace = (args) => {
  const found = locate(args);
  if (!found) return console.log("워크스페이스가 없습니다. PM 저장소를 내려받은 폴더에서 pm setup을 실행하세요.");
  const w = new Workspace(found.dir, found.source);
  console.log(`워크스페이스  ${w.dir} (${w.source})`);
  console.log(`회사         ${w.config.company}`);
  if (registered() && registered() !== w.dir) console.log(`등록된 곳     ${registered()}`);
  commands.projects(args);
};

commands.projects = (args) => {
  const w = ws(args);
  const ids = w.ids();
  if (!ids.length) return console.log("등록된 프로젝트가 없습니다. pm init <id>로 만드세요.");
  for (const id of ids) {
    const p = w.load(id);
    console.log(`${pad(id, 22)}${pad(p.name, 24)}${p.client || ""}${p.github?.repo ? ` · ${p.github.repo}` : ""}`);
  }
};
commands["list-projects"] = commands.projects;
commands.where = commands.workspace;

commands.config = (args) => {
  const w = ws(args);
  const [key, value] = args._;
  if (!key) return console.log(JSON.stringify(w.config, null, 2));
  if (value === undefined) return console.log(w.config[key] ?? "");
  guardDeep("설정 바꾸기(pm config)", { w });
  w.setConfig({ [key]: value });
  console.log(`${key} = ${value}`);
};

commands["install-cli"] = (args) => {
  guardDeep("pm 명령 설치(pm install-cli)", { args });
  const bin = process.env.PM_BIN_DIR || path.join(os.homedir(), ".local", "bin");
  fs.mkdirSync(bin, { recursive: true });
  // 플러그인은 버전마다 폴더가 바뀌므로, 실행할 때 가장 새 버전을 찾는다
  const cache = path.join(os.homedir(), ".claude", "plugins", "cache", "pm-dashboard", "pm-dashboard");
  const script = `#!/usr/bin/env bash
latest="$(ls -d "${cache}"/*/skills/pm/scripts/pm.mjs 2>/dev/null | sort -V | tail -1)"
exec node "\${latest:-${path.join(SKILL_DIR, "scripts", "pm.mjs")}}" "$@"
`;
  fs.writeFileSync(path.join(bin, "pm"), script, { mode: 0o755 });
  console.log(`만들었습니다: ${path.join(bin, "pm")}`);
  if (!(process.env.PATH || "").split(":").includes(bin)) console.log(`PATH에 ${bin}을 추가하세요.`);
};

// ---------------------------------------------------------------- 프로젝트

commands.init = (args) => {
  const w = ws(args);
  const [id] = args._;
  if (!id || !ID_RE.test(id)) throw new UsageError("pm init <id> — id는 영문 소문자·숫자·하이픈 (예: my-app)");
  guardDeep("새 프로젝트 만들기(pm init)", { w });
  if (fs.existsSync(w.projectFile(id)) && !args.force) throw new UsageError(`${w.projectFile(id)}가 이미 있습니다. 덮어쓰려면 --force`);
  const dateFlags = { kickoff: "kickoff", devStart: "dev-start", devEnd: "dev-end", qaStart: "qa-start", qaEnd: "qa-end", launch: "launch", storeSubmit: "store-submit" };
  const dates = {};
  for (const [field, flag] of Object.entries(dateFlags)) if (args[flag] !== undefined) dates[field] = parseDate(args[flag], flag);
  const repo = typeof args.repo === "string" ? args.repo : args.from === "sample" ? null : gitRemoteRepo();
  const project = newProject({ id, name: args.name, client: args.client, repo, dates, features: list(args.scope), from: args.from });
  w.save(id, project);
  const counted = project.checklist.filter((i) => i.status !== "not_needed");
  console.log(`만들었습니다: ${w.projectFile(id)}`);
  console.log(`- 범위: ${(project.scope?.features || []).join(", ") || "(없음) → pm scope --set app,admin,... 로 고르세요"}`);
  console.log(`- 체크리스트 ${counted.length}개 · 고객사 확인 요청 ${counted.filter((i) => i.sheet).length}개${repo ? ` · GitHub ${repo}` : ""}`);
  const missing = ["devStart", "devEnd", "qaStart", "qaEnd", "launch"].filter((k) => !project.dates?.[k]);
  if (missing.length) console.log(`- 아직 없는 날짜: ${missing.join(", ")} → 날짜가 있어야 요청 시작일이 계산된다`);
  console.log("- 다음: pm kickoff → pm sheet → pm kickoff-kit");
};

commands.scope = (args) => {
  const lib = library();
  if (args.list) {
    let group = null;
    for (const f of lib.features) {
      if (f.group !== group) console.log(`\n${(group = f.group)}`);
      console.log(`  ${pad(f.key, 16)}${f.label}${f.note ? ` — ${f.note}` : ""}`);
    }
    return;
  }
  const { w, id } = target(args);
  const project = w.load(id);
  let features = [...(project.scope?.features || [])];
  if (args.set !== undefined) features = list(args.set);
  features.push(...list(args.add));
  features = features.filter((key) => !list(args.remove).includes(key));
  if (args.set !== undefined || args.add !== undefined || args.remove !== undefined) {
    guardDeep("개발 범위 바꾸기(pm scope)", { w });
    const diff = applyScope(project, features);
    w.save(id, project);
    if (diff.added.length) console.log(`추가: ${diff.added.join(", ")}`);
    if (diff.disabled.length) console.log(`해당 없음으로: ${diff.disabled.join(", ")}`);
    if (diff.enabled.length) console.log(`다시 필요: ${diff.enabled.join(", ")}`);
    if (!diff.added.length && !diff.disabled.length && !diff.enabled.length) console.log("체크리스트 변화 없음");
  }
  const on = new Set(project.scope?.features || []);
  console.log(`\n${project.name} 범위: ${lib.features.filter((f) => on.has(f.key)).map((f) => f.label).join(", ") || "(없음)"}`);
  console.log("빠진 기능은 pm scope --add <key>, 목록은 pm scope --list");
};

commands.validate = (args) => {
  const w = ws(args);
  const ids = args.all ? w.ids() : [w.resolveId(args, gitRemoteRepo())];
  let problems = 0;
  for (const id of ids) {
    const p = w.load(id);
    const issues = [];
    if (p.id !== id) issues.push(`id가 폴더 이름(${id})과 다름: ${p.id}`);
    for (const [key, value] of Object.entries(p.dates || {})) if (value && !isDate(value)) issues.push(`dates.${key} ${DATE_RE.test(value) ? "없는 날짜" : "형식"}: ${value}`);
    const catIds = new Set((p.categories || []).map((c) => c.id));
    const seen = new Set();
    for (const item of p.checklist || []) {
      const where = `checklist.${item.id || "?"}`;
      if (!item.id) issues.push("id 없는 체크리스트 항목");
      if (seen.has(item.id)) issues.push(`${where}: id 중복`);
      seen.add(item.id);
      if (!Core.STATUS[item.status]) issues.push(`${where}: status '${item.status}' (가능: ${Object.keys(Core.STATUS).join(", ")})`);
      if (!BALLS.includes(item.ball)) issues.push(`${where}: ball '${item.ball}' (가능: ${BALLS.join(", ")})`);
      if (!catIds.has(item.cat)) issues.push(`${where}: categories에 없는 cat '${item.cat}'`);
      for (const field of ["requested", "due", "updated", "blocksDate", "answeredAt"]) if (item[field] && !isDate(item[field])) issues.push(`${where}.${field} ${DATE_RE.test(item[field]) ? "없는 날짜" : "형식"}: ${item[field]}`);
      if (item.needBy && !Core.ANCHORS[item.needBy]) issues.push(`${where}.needBy '${item.needBy}' (가능: ${Object.keys(Core.ANCHORS).join(", ")})`);
      if (item.checked && (!isDate(item.checked.at) || typeof item.checked.src !== "string")) issues.push(`${where}.checked 형식: { at: YYYY-MM-DD, src: 출처, guess?: true }`);
      if (item.status === "requested" && !item.requested) issues.push(`${where}: 요청함인데 requested 날짜가 없음(대기 일수를 못 셈)`);
    }
    for (const r of p.contract?.review || []) if (!Core.CONTRACT_REVIEW[r.status || "unchecked"]) issues.push(`contract.review.${r.id}: status '${r.status}'`);
    // 결정·위험: 기한은 날짜여야 화면이 'D-n'·'n일 지남'을 계산한다. 옛 글자 기한은 오류가 아니라 경고로 알린다
    const warnings = [];
    const checkMark = (where, checked) => {
      if (checked && (!isDate(checked.at) || typeof checked.src !== "string")) issues.push(`${where}.checked 형식: { at: YYYY-MM-DD, src: 출처, guess?: true }`);
    };
    (p.decisions || []).forEach((d, i) => {
      const where = `decisions[${i + 1}] '${d.title || "?"}'`;
      if (!d.title) issues.push(`decisions[${i + 1}]: title 없음`);
      if (d.due && !isDate(d.due)) warnings.push(`${where}: 기한이 ${DATE_RE.test(d.due) ? "없는 날짜" : "날짜가 아님"}('${d.due}') — pm decision set ${i + 1} --due YYYY-MM-DD`);
      checkMark(`decisions[${i + 1}]`, d.checked);
    });
    (p.resolvedDecisions || []).forEach((d, i) => {
      const where = `resolvedDecisions[${i + 1}] '${d.title || "?"}'`;
      if (!d.title || !d.result) issues.push(`${where}: title과 result(무엇으로 정했는지)가 있어야 함`);
      if (!isDate(d.decidedAt)) issues.push(`${where}.decidedAt 형식: ${d.decidedAt}`);
    });
    (p.risks || []).forEach((r, i) => {
      const where = `risks[${i + 1}] '${r.title || "?"}'`;
      if (!r.title) issues.push(`risks[${i + 1}]: title 없음`);
      if (r.level && !Core.RISK_LEVEL[r.level]) issues.push(`${where}: level '${r.level}' (가능: ${Object.keys(Core.RISK_LEVEL).join(", ")})`);
      if (r.due && !isDate(r.due)) warnings.push(`${where}: 기한이 ${DATE_RE.test(r.due) ? "없는 날짜" : "날짜가 아님"}('${r.due}') — pm risk set ${i + 1} --due YYYY-MM-DD`);
      checkMark(`risks[${i + 1}]`, r.checked);
    });
    const text = JSON.stringify(p);
    if (/sk-ant-|ghp_|github_pat_|xox[bp]-|AKIA[0-9A-Z]{16}|(?:test|live)_(?:sk|ck|gsk)_/.test(text)) issues.push("비밀값처럼 보이는 문자열이 있음 — 링크·이름만 두고, 계정은 권한 초대로 받는다");
    if (/비밀번호\s*[:=]\s*\S|password\s*[:=]\s*\S/i.test(text)) issues.push("비밀번호가 적힌 것 같음 — 지우고 권한 초대로 받는다");
    problems += issues.length;
    console.log(issues.length ? `✗ ${id}\n${issues.map((x) => `  - ${x}`).join("\n")}` : `✓ ${id}`);
    if (warnings.length) console.log(warnings.map((x) => `  ! 경고: ${x}`).join("\n"));
  }
  if (problems) process.exitCode = 1;
};

// ---------------------------------------------------------------- 현황

function statusSummary(m) {
  const { project, forecast, readiness, waiting, missing, health, kickoff: ko, sheet: sh, contract } = m;
  const p = forecast?.project;
  const launch = project.dates?.launch;
  return {
    project: { id: project.id, name: project.name, client: project.client, dates: project.dates, scope: project.scope?.features || [], dataAsOf: project.asOf || null },
    health: { label: health.label, reasons: health.reasons },
    launch: launch ? { date: launch, daysLeft: F.daysBetween(m.today, launch) } : null,
    briefing: Core.briefing(m).map((item) => item.text),
    kickoff: ko.active ? { completed: ko.completed, stages: ko.stages.map((s) => ({ name: s.name, done: s.done, total: s.total, complete: s.complete })), current: ko.current?.name || null } : null,
    thisWeek: m.thisWeek.map((a) => ({ type: a.type, item: a.item || null, late: a.late, text: a.text })),
    forecast: p
      ? {
          snapshot: forecast.syncedAt,
          target: p.target,
          targetLabel: p.targetLabel,
          status: Core.FORECAST_STATUS[p.status].label,
          remaining: p.remaining,
          velocityPerWeek: Math.round(p.velocity * 10) / 10,
          inflowPerWeek: Math.round(p.inflow * 10) / 10,
          expected: p.expected,
          optimistic: p.optimistic,
          pessimistic: p.pessimistic,
          finishWithInflow: p.netFinish,
          remainingAtTarget: p.remainingAtTarget,
          requiredVelocityPerWeek: p.requiredVelocity == null ? null : Math.round(p.requiredVelocity),
        }
      : null,
    lateMilestones: forecast ? forecast.views.filter((v) => v.isLate).map((v) => ({ title: v.title, open: v.open, due: v.due })) : [],
    readiness,
    requestSheet: sh.stats,
    missing: missing.map((i) => ({ id: i.id, title: i.title, ball: i.ball, askBy: i.askBy, blocks: i.blocks || null })),
    waitingOnClient: waiting.map((i) => ({ id: i.id, title: i.title, waitDays: i.waitDays, overdue: i.overdue, noReply: i.noReply, needLate: i.needLate, blocks: i.blocks || null, blocksDate: i.blocksDate || null })),
    contract: contract ? { review: contract.review, nextPayment: contract.next ? { name: contract.next.name, trigger: contract.next.trigger, due: contract.next.dueDate } : null } : null,
    resolvedDecisions: m.resolvedDecisions.slice(0, 10),
    decisions: m.decisions.map(({ dueInfo, n, ...d }) => ({ ...d, dueLabel: dueInfo?.label || null, late: !!dueInfo?.late, dueInvalid: !!dueInfo?.invalid })),
    risks: m.risks.map(({ dueInfo, n, ...r }) => ({ ...r, dueLabel: dueInfo?.label || null, late: !!dueInfo?.late, dueInvalid: !!dueInfo?.invalid })),
    approvalQueue: (project.queue || []).map((q) => ({ id: q.id, title: q.title })),
  };
}

function printWeek(m) {
  if (!m.thisWeek.length) return console.log("이번 주 할 일  없음");
  console.log("이번 주 할 일 (필요일·기한 순)");
  const when = (a) => (a.date ? ` — ${a.date < m.today && a.dateKind === "필요" ? "필요일" : a.dateKind} ${F.monthDay(a.date)} · ${Core.dayLabel(F.daysBetween(m.today, a.date))}` : a.raw ? ` — 기한 ${a.raw}` : "");
  for (const a of m.thisWeek.slice(0, 12)) console.log(`  ${a.late ? "! " : "- "}${a.label || a.text}${when(a)}${a.why ? ` [${a.why}]` : ""}`);
  if (m.thisWeek.length > 12) console.log(`  외 ${m.thisWeek.length - 12}개`);
}

commands.status = (args) => {
  const { w, id } = target(args);
  const m = buildModel(w, id);
  const s = statusSummary(m);
  if (args.json) return console.log(JSON.stringify(s, null, 2));
  console.log(`${s.project.name} (${s.project.client || "-"}) · ${s.health.label}${s.launch ? ` · 출시 ${F.monthDay(s.launch.date)} D-${s.launch.daysLeft}` : ""}`);
  if (s.health.reasons.length) console.log(`  신호: ${s.health.reasons.join(" · ")}`);
  console.log("");
  s.briefing.forEach((line, i) => console.log(`${i + 1}. ${line}`));
  console.log("");
  if (s.kickoff) console.log(`킥오프  ${s.kickoff.stages.map((st) => `${st.complete ? "✓" : st.name === s.kickoff.current ? "▶" : "·"} ${st.name} ${st.done}/${st.total}`).join("  ")}`);
  if (s.forecast) {
    const f = s.forecast;
    console.log(`예측    남은 ${f.remaining} · 처리 ${fmt(f.velocityPerWeek)}/주 · 유입 ${fmt(f.inflowPerWeek)}/주 · 새 이슈가 멈추면 ${F.shortDate(f.expected)} (${F.monthDay(f.optimistic)}~${F.monthDay(f.pessimistic)})`);
    console.log(`        지금 추세면 ${F.monthDay(f.target)}에 ~${f.remainingAtTarget}건 남음 · 맞추려면 주 ${f.requiredVelocityPerWeek}건 · GitHub ${syncAge(f.snapshot)} 기준`);
  } else console.log(`예측    ${m.project.github ? "GitHub 이슈를 아직 받지 않음 (pm update)" : "GitHub 저장소 연결 전"}`);
  console.log(`준비    ${s.readiness.ready}/${s.readiness.total} 확정 (${s.readiness.percent}%) · 요청 목록 ${s.requestSheet.sent}/${s.requestSheet.total} 보냄, 답 ${s.requestSheet.answered} · 고객사 대기 ${s.waitingOnClient.length}${s.waitingOnClient[0] ? ` (최장 D+${s.waitingOnClient[0].waitDays} ${s.waitingOnClient[0].title})` : ""}`);
  if (s.contract) console.log(`계약    점검 있음 ${s.contract.review.ok}/${s.contract.review.total} · 불리·모호 ${s.contract.review.risk} · 없음 ${s.contract.review.missing} · 확인 전 ${s.contract.review.unchecked}${s.contract.nextPayment ? ` · 다음 대금 ${s.contract.nextPayment.name}(${s.contract.nextPayment.trigger})` : ""}`);
  if (s.approvalQueue.length) console.log(`승인 대기열 ${s.approvalQueue.length}건`);
  console.log("");
  printWeek(m);
};

commands.kickoff = (args) => {
  const { w, id } = target(args);
  const m = buildModel(w, id);
  if (args.json) {
    const s = statusSummary(m);
    return console.log(JSON.stringify({ kickoff: s.kickoff, thisWeek: s.thisWeek }, null, 2));
  }
  console.log(`${m.project.name} 킥오프 ${m.kickoff.completed}/${m.kickoff.stages.length}단계`);
  for (const [n, st] of m.kickoff.stages.entries()) {
    console.log(`\n${n + 1}. ${st.name} ${st.complete ? "✓ 끝" : `${st.done}/${st.total}`} — ${st.hint}`);
    for (const item of st.remaining.slice(0, 8)) console.log(`   · ${item.title} (${Core.STATUS[item.status].label}${item.askBy && item.status === "missing" ? `, ${F.monthDay(item.askBy)}까지 요청` : ""})`);
    if (st.remaining.length > 8) console.log(`   · 외 ${st.remaining.length - 8}개`);
    if (st.contractReview && m.contract && !m.contract.reviewDone) console.log(`   · 계약 점검 ${m.contract.review.unchecked}개 확인 전 (pm contract)`);
  }
  console.log("");
  printWeek(m);
};

commands.sync = async (args) => {
  const w = ws(args);
  const ids = args.all ? w.ids().filter((id) => w.load(id).github?.repo) : [w.resolveId(args, gitRemoteRepo())];
  for (const id of ids) {
    const repo = w.load(id).github?.repo;
    if (!repo) throw new UsageError(`${id}: project.json에 github.repo가 없습니다`);
    fs.mkdirSync(w.projectDir(id), { recursive: true });
    const snapshot = await sync(repo, w.githubFile(id));
    console.log(`${id} · ${repo} · 이슈 ${snapshot.issues.length} · 마일스톤 ${snapshot.milestones.length}`);
  }
};

commands.forecast = (args) => {
  const scenario = { velocityPct: Number(args.velocity) || 0, inflowPct: Number(args.inflow) || 0, descope: Math.max(0, Number(args.descope) || 0) };
  const { w, id } = target(args);
  const m = buildModel(w, id, scenario);
  const p = m.forecast?.project;
  if (!p) throw new UsageError("GitHub 스냅샷이 없거나 예측할 이슈가 없습니다. pm sync를 먼저 하세요.");
  const result = { scenario, ...statusSummary(m).forecast };
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`가정: 처리 ${scenario.velocityPct >= 0 ? "+" : ""}${scenario.velocityPct}% · 유입 ${scenario.inflowPct >= 0 ? "+" : ""}${scenario.inflowPct}% · 범위 -${scenario.descope}건`);
  console.log(`${p.targetLabel} ${F.shortDate(p.target)}: ${result.status} · 새 이슈가 멈추면 ${F.shortDate(p.expected)} · 지금 추세면 ~${p.remainingAtTarget}건 남음 · 유입까지 감안한 완료 ${p.netFinish ? F.shortDate(p.netFinish) : "계산 불가(유입 > 처리)"}`);
};

commands["setup-repo"] = async (args) => {
  const { w, id } = target(args);
  const project = w.load(id);
  const repo = project.github?.repo;
  if (!repo) throw new UsageError("project.json에 github.repo가 없습니다");
  if (args.apply) guardDeep("GitHub에 라벨·마일스톤 만들기(pm setup-repo --apply)", { w });
  const plan = await setupRepo(repo, Core.anchorDates(project.dates), { apply: !!args.apply });
  console.log(`${repo} — 이미 있는 라벨 ${plan.existing.labels}개, 마일스톤 ${plan.existing.milestones}개`);
  console.log(plan.labels.length ? `${args.apply ? "만든" : "만들"} 라벨: ${plan.labels.map((l) => l.name).join(", ")}` : "라벨: 모두 있음");
  if (plan.milestones.length) {
    console.log(`${args.apply ? "만든" : "만들"} 마일스톤:`);
    for (const m of plan.milestones) console.log(`  ${m.title} (마감 ${F.shortDate(m.due)})`);
  } else console.log("마일스톤: 모두 있음");
  if (!args.apply) {
    if (!project.dates?.devStart) console.log("개발 시작·마감 날짜가 없어 스프린트를 계획하지 못했습니다.");
    console.log("\n아직 아무것도 만들지 않았습니다. 확인 뒤 --apply를 붙이면 만듭니다.");
    return;
  }
  const labels = project.checklist.find((i) => i.id === "labels");
  if (labels && labels.status !== "confirmed") {
    labels.status = "confirmed";
    labels.updated = today();
    labels.history = [...(labels.history || []), { date: today(), text: "pm setup-repo로 라벨·스프린트 마일스톤 생성" }];
  }
  project.clientLabels = [...new Set([...(project.clientLabels || []), "확인요청"])];
  w.save(id, project);
};

// ---------------------------------------------------------------- 문서

function emit(args, w, id, name, text) {
  if (args.out !== undefined) guardDeep("--out으로 파일 쓰기", { w });
  if (args.save) console.error(`저장: ${w.saveDoc(id, `${name}-${today()}.md`, text)}`);
  if (typeof args.out === "string") {
    fs.writeFileSync(path.resolve(args.out), text);
    console.error(`저장: ${path.resolve(args.out)}`);
  }
  console.log(text);
}

commands.sheet = (args) => {
  const { w, id } = target(args);
  if (args["mark-sent"]) {
    guardDeep("'보냄' 표시(pm sheet --mark-sent)", { w });
    const project = w.load(id);
    const date = args.date ? parseDate(args.date, "date") : today();
    const sent = markSent(project, date);
    w.save(id, project);
    return console.log(sent.length ? `요청함으로 바꿨습니다 (${F.shortDate(date)}): ${sent.length}건` : "아직 안 보낸 항목이 없습니다");
  }
  const m = buildModel(w, id);
  const format = args.format === "notion" ? "notion" : "md";
  emit(args, w, id, format === "notion" ? "requests-notion" : "requests", Docs.sheetDocument(m, { format, onlyPending: !!args["only-new"], company: w.config.company }));
  const s = m.sheet.stats;
  console.error(`\n요청 목록 ${s.total}개 · 보냄 ${s.sent} · 답 ${s.answered} · 이번에 보낼 것 ${m.sheet.pending.length} · ⭐ ${s.priority}`);
  if (m.sheet.pending.length) console.error("보낸 뒤에는: pm sheet --mark-sent");
};

commands.answer = (args) => {
  const { w, id } = target(args);
  const [itemId, ...pairs] = args._;
  const project = w.load(id);
  const item = project.checklist.find((i) => i.id === itemId);
  if (!item) throw new UsageError(`체크리스트에 ${itemId}가 없습니다`);
  const done = [];
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at < 1) throw new UsageError(`"라벨=값" 형식이 아닙니다: ${pair}`);
    const label = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    const field = (item.fields || []).find((f) => f.label === label) || (item.fields || []).find((f) => f.label.startsWith(label) || f.label.includes(label));
    if (!field) throw new UsageError(`${itemId}에 '${label}' 칸이 없습니다. 있는 칸: ${(item.fields || []).map((f) => f.label).join(", ")}`);
    if (/비밀번호|password/i.test(field.label + value)) throw new UsageError("비밀번호는 기록하지 않습니다. 권한 초대로 받으세요");
    field.answer = value;
    done.push(field.label);
  }
  if (typeof args.note === "string") item.answer = args.note;
  item.checked = checkedMark(args, "고객사 답");
  item.answeredAt = today();
  item.updated = today();
  const before = item.status;
  item.status = args.confirm ? "confirmed" : "received";
  if (!args.confirm) item.ball = "us";
  item.history = [...(item.history || []), { date: today(), text: `고객사 답 기록${done.length ? `: ${done.join(", ")}` : ""} · ${Core.STATUS[before].label} → ${Core.STATUS[item.status].label}` }];
  w.save(id, project);
  console.log(`${itemId}: ${done.length ? `${done.join(", ")} 기록` : "답 기록"} · ${Core.STATUS[item.status].label}`);
};

commands.report = (args) => {
  const { w, id } = target(args);
  emit(args, w, id, args.client ? "report-client" : "report", Docs.weeklyReport(buildModel(w, id), { client: !!args.client }));
};

commands["kickoff-kit"] = (args) => {
  const { w, id } = target(args);
  const text = Docs.kickoffKit(buildModel(w, id), { internal: !!args.internal, company: w.config.company, features: library().features });
  emit(args, w, id, args.internal ? "kickoff-internal" : "kickoff", text);
};

// ---------------------------------------------------------------- 체크리스트

commands.list = (args) => {
  const { w, id } = target(args);
  const m = buildModel(w, id);
  const ballLabel = Core.labels(w.config.company).BALL;
  const items = m.checklist.filter((i) => (!args.status || i.status === args.status) && (!args.ball || i.ball === args.ball) && (!args.cat || i.cat === args.cat) && (!args.recheck || i.recheck));
  if (args.json) return console.log(JSON.stringify(items, null, 2));
  for (const cat of m.project.categories) {
    const rows = items.filter((i) => i.cat === cat.id).sort((a, b) => Core.STATUS[a.status].order - Core.STATUS[b.status].order || (a.askBy || "9999").localeCompare(b.askBy || "9999"));
    if (!rows.length) continue;
    console.log(`\n${cat.name}`);
    for (const i of rows)
      console.log(
        `  ${pad(i.id, 18)}${pad(Core.STATUS[i.status].label, 10)}${pad(ballLabel[i.ball] || i.ball, 10)}${pad(i.waitDays != null ? `D+${i.waitDays}` : i.askBy && i.status === "missing" ? `${i.late ? "!" : ""}~${F.monthDay(i.askBy)}` : "", 9)}${i.guess ? "[추정] " : i.stale ? "[오래됨] " : ""}${i.title}${i.blocks ? ` → ${i.blocks}${i.blocksDate ? ` ${F.monthDay(i.blocksDate)}` : ""}` : ""}`,
      );
  }
};

commands.set = (args) => {
  const { w, id } = target(args);
  const [itemId] = args._;
  if (!itemId) throw new UsageError("pm set <item> --status ...");
  const project = w.load(id);
  const item = project.checklist.find((i) => i.id === itemId);
  if (!item) throw new UsageError(`체크리스트에 ${itemId}가 없습니다. pm list로 확인하세요.`);
  const before = { status: item.status, ball: item.ball };
  if (args.status) {
    if (!Core.STATUS[args.status]) throw new UsageError(`--status: ${Object.keys(Core.STATUS).join(", ")}`);
    item.status = args.status;
    if (args.status === "requested" && !args.requested && before.status !== "requested") item.requested = today();
  }
  if (args.ball) {
    if (!BALLS.includes(args.ball)) throw new UsageError(`--ball: ${BALLS.join(", ")}`);
    item.ball = args.ball;
  }
  if (args.requested) item.requested = parseDate(args.requested, "requested");
  if (args.due) item.due = parseDate(args.due, "due");
  if (args["res-label"] || args["res-url"]) item.res = { label: args["res-label"] || item.res?.label || args["res-url"], url: args["res-url"] || item.res?.url || "" };
  for (const field of ["note", "need", "proposal", "internal"]) if (typeof args[field] === "string") item[field] = args[field];
  if (typeof args.src === "string" || args.guess) item.checked = checkedMark(args, "PM 확인");
  item.updated = today();
  const changes = [];
  if (before.status !== item.status) changes.push(`상태 ${Core.STATUS[before.status]?.label} → ${Core.STATUS[item.status].label}`);
  if (before.ball !== item.ball) changes.push(`공 ${before.ball} → ${item.ball}`);
  if (typeof args.log === "string") changes.push(args.log);
  if (changes.length) item.history = [...(item.history || []), { date: today(), text: changes.join(" · ") }];
  w.save(id, project);
  console.log(`${id}/${itemId}: ${changes.join(" · ") || "갱신"}`);
};

commands.request = (args) => {
  const { w, id } = target(args);
  const [itemId] = args._;
  const m = buildModel(w, id);
  const item = m.checklist.find((i) => i.id === itemId);
  if (!item) throw new UsageError(`체크리스트에 ${itemId}가 없습니다.`);
  const company = w.config.company;
  const { RECEIVE, MODES } = Core.labels(company);
  const receive = RECEIVE[args.receive] ? args.receive : item.receiveAt || m.project.receiveDefault;
  const mode = MODES[args.mode] ? args.mode : item.mode || "ask";
  const due = typeof args.due === "string" ? parseDate(args.due, "due") : item.due || item.askBy || F.addDays(today(), 5);
  const reminder = item.status === "requested";
  const text = reminder ? Core.reminderText(m.project, item) : Core.requestText(m.project, item, { receive, mode, due }, company);
  console.log(text);
  if (args.queue) {
    const project = w.load(id);
    const entry = { id: `q-${Date.now().toString(36)}`, createdAt: new Date().toISOString(), projectId: id, kind: reminder ? "reminder" : "request", itemId, title: `${item.title} ${reminder ? "리마인드" : "요청"}`, to: `${m.project.client} 담당자`, channel: RECEIVE[receive].label, receive, mode, due, text, by: "claude" };
    project.queue = [...(project.queue || []), entry];
    w.save(id, project);
    console.error(`\n승인 대기열에 넣었습니다 (${entry.id}). 보내지는 않았습니다.`);
  }
};

// ---------------------------------------------------------------- 최신화

// 값을 원본에서 확인한 기록. --guess는 직접 확인하지 못하고 추정한 값(담당자 확인 전)
function checkedMark(args, fallback) {
  const mark = { at: today(), src: typeof args.src === "string" && args.src.trim() ? args.src.trim() : fallback };
  if (args.guess) mark.guess = true;
  return mark;
}

commands.check = (args) => {
  const { w, id } = target(args);
  const ids = args._;
  if (!ids.length) throw new UsageError("pm check <item...> --src 출처 [--guess]");
  if (typeof args.src !== "string" || !args.src.trim()) throw new UsageError("--src로 확인한 곳을 적으세요 (예: \"Notion 요청 페이지\", \"GitHub #153\", \"고객사 통화\")");
  const project = w.load(id);
  for (const itemId of ids) {
    const item = project.checklist.find((i) => i.id === itemId);
    if (!item) throw new UsageError(`체크리스트에 ${itemId}가 없습니다`);
    item.checked = checkedMark(args, "PM 확인");
    if (typeof args.note === "string") item.note = args.note;
    item.history = [...(item.history || []), { date: today(), text: `${args.guess ? "추정" : "확인"}: ${item.checked.src}${typeof args.note === "string" ? ` · ${args.note}` : ""}` }];
  }
  w.save(id, project);
  console.log(`${ids.join(", ")}: ${args.guess ? "추정" : "확인"} ${F.shortDate(today())} · ${args.src.trim()}`);
};

commands.refresh = async (args) => {
  const { w, id } = target(args);
  const r = await refreshReport(w, id, { offline: !!args.offline });
  const m = r.model;
  const label = (x) => `${x.repo === r.repo ? "" : x.repo}#${x.n} ${x.state === "closed" ? `닫힘${x.closed ? ` ${F.monthDay(x.closed)}` : ""}` : `갱신 ${F.monthDay(x.updated)}`}`;
  if (args.json)
    return console.log(
      JSON.stringify(
        {
          project: id,
          today: m.today,
          staleDays: Core.STALE_DAYS,
          github: r.githubNote,
          items: r.picked.map(({ item, changed }) => ({
            id: item.id,
            title: item.title,
            status: item.status,
            checkedAt: item.checkedAt,
            src: item.checkedSrc,
            guess: item.guess,
            stale: item.stale,
            source: item.res || null,
            github: changed.map((x) => ({ ref: `${x.repo}#${x.n}`, state: x.state, reason: x.reason, updated: x.updated, closed: x.closed, title: x.title })),
          })),
        },
        null,
        2,
      ),
    );
  const by = (kind) => r.picked.filter((row) => r.kind(row) === kind);
  console.log(`${m.project.name} 최신화 점검 (${F.shortDate(m.today)})`);
  console.log(`다시 확인할 값 ${r.counts.total}개 — 추정 ${r.counts.guess} · 확인 뒤 GitHub 이슈가 바뀜 ${r.counts.moved} · ${Core.STALE_DAYS}일 넘게 확인 안 함 ${r.counts.stale}`);
  console.log(`(${r.githubNote})`);
  const when = (item) => (item.checkedAt ? `확인 ${F.monthDay(item.checkedAt)}${item.checkedSrc ? ` · ${item.checkedSrc}` : ""}` : "확인 기록 없음");
  const section = (title, list, extra) => {
    if (!list.length) return;
    console.log(`\n${title}`);
    for (const row of list) console.log(`  ${pad(row.item.id, 18)}${pad(Core.STATUS[row.item.status].label, 10)}${row.item.title} — ${extra(row)}`);
  };
  section("추정 값 (담당자에게 확인)", by("guess"), ({ item }) => `${item.note || when(item)}`);
  section("확인 뒤 GitHub 이슈가 바뀐 항목", by("moved"), ({ item, changed }) => `${changed.map(label).join(", ")} (${when(item)})`);
  section(`${Core.STALE_DAYS}일 넘게 확인 안 함`, by("stale"), ({ item }) => when(item));
  const bySource = new Map();
  for (const { item } of r.picked) {
    const key = item.res?.label || item.checkedSrc || "출처 없음";
    if (!bySource.has(key)) bySource.set(key, { url: item.res?.url, ids: [] });
    bySource.get(key).ids.push(item.id);
  }
  if (bySource.size) {
    console.log("\n볼 곳");
    for (const [key, v] of [...bySource.entries()].sort((a, b) => b[1].ids.length - a[1].ids.length)) console.log(`  ${key}${v.url ? ` (${v.url})` : ""}: ${v.ids.join(", ")}`);
  }
  console.log(
    r.picked.length
      ? "\n확인한 뒤: 값이 바뀌었으면 pm answer <item> \"라벨=값\" --src 출처, 그대로면 pm check <item...> --src 출처. 원본에서 못 찾은 값은 '없음'으로 두지 말고 --guess로 표시하고 담당자에게 묻는다."
      : "\n다시 확인할 값이 없습니다.",
  );
};

// 기록 시각은 ISO(UTC)로 두고, 보여 줄 때는 이 컴퓨터의 시각으로
const localTime = (iso) => {
  const d = new Date(iso);
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

commands.update = async (args) => {
  const w = ws(args);
  if (process.env.PM_DEEP_UPDATE === "1") throw new UsageError("전체 업데이트 중에는 pm update를 다시 부를 수 없습니다.");
  const ids = args.all || !w.ids().length ? w.ids() : [w.resolveId(args, gitRemoteRepo())];
  if (!ids.length) throw new UsageError("등록된 프로젝트가 없습니다. pm init <id>로 만드세요.");
  const trigger = ["schedule", "dashboard", "manual"].includes(args.trigger) ? args.trigger : "manual";
  const stamp = () => localTime(new Date().toISOString());
  const deep = !!args.deep;
  if (deep) {
    const check = deepCheck(w, { mcp: false });
    if (!check.ok) throw new UsageError(`전체 업데이트를 할 수 없습니다. pm doctor로 확인하세요: ${check.checks.filter((c) => !c.ok && !c.warn).map((c) => c.name).join(", ")}`);
  }
  const { busy, results } = await runUpdate(w, ids, { trigger, deep, offline: !!args.offline, log: (line) => console.error(`[${stamp()}] ${line}`) });
  if (busy) return console.log(`이미 업데이트 중입니다 (${busy.trigger}, ${busy.at} 시작). 끝난 뒤 다시 하세요.`);
  if (args.json) return console.log(JSON.stringify(results, null, 2));
  for (const r of results) {
    const took = r.durationSec >= 90 ? `${Math.round(r.durationSec / 60)}분` : `${r.durationSec}초`;
    console.log(`${r.id}: ${r.ok ? "업데이트함" : "일부 실패"} · ${r.mode === "deep" ? "전체" : "빠른"} · ${took}${r.cost != null ? ` · 약 $${r.cost.toFixed(2)}` : ""} · ${r.summary}`);
    for (const s of r.steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.name}: ${s.ok ? s.detail : `${Core.explainStep(s).text} (원문: ${s.detail})`}`);
    for (const c of r.changed || []) console.log(`  · 바뀜 ${c.id}: ${c.what}`);
    for (const a of r.asks || []) console.log(`  ? 물어볼 것 ${a.id}: ${a.question}`);
  }
  if (!deep && results.some((r) => r.recheck.total)) console.log("\n바뀐 값을 반영하려면 pm update --deep(Claude가 원본을 읽고 반영) 또는 Claude에게 \"최신화해 줘\"");
};

function printChecks(check) {
  console.log("전체 업데이트 점검");
  for (const c of check.checks) console.log(`  ${c.ok ? "✓" : c.warn ? "!" : "✗"} ${pad(c.name, 16)}${c.detail}${c.ok ? "" : `\n      할 일: ${c.fix}`}`);
}

commands.doctor = (args) => {
  const w = ws(args);
  console.log(`워크스페이스 ${w.dir} (${w.source}) · 회사 ${w.config.company} · 프로젝트 ${w.ids().join(", ") || "없음"}`);
  const check = deepCheck(w);
  printChecks(check);
  console.log(check.ok ? "\n전체 업데이트를 쓸 수 있습니다: pm update --deep, 자동은 pm schedule install --deep" : "\n'할 일'을 마치면 전체 업데이트(Claude가 원본을 읽고 반영)를 쓸 수 있습니다. 빠른 업데이트(pm update)는 지금도 됩니다.");
  commands.schedule({ ...args, _: ["status"] });
};

commands.schedule = (args) => {
  const w = ws(args);
  const [sub = "status"] = args._;
  if (sub === "install" || sub === "remove") guardDeep(`자동 실행 바꾸기(pm schedule ${sub})`, { w });
  if (sub === "install") {
    const times = list(args.times || "08:30,12:30,18:30");
    let deep = !!args.deep;
    if (deep) {
      const check = deepCheck(w);
      printChecks(check);
      if (!check.ok) {
        deep = false;
        console.log("\n전체 업데이트에 필요한 것이 빠져 있어 빠른 업데이트로 켭니다. 위 '할 일'을 마친 뒤 pm schedule install --deep을 다시 하세요.\n");
      }
    }
    const result = scheduleInstall(w, { times, deep, serve: args.serve !== "false" && !args["no-serve"], port: Number(args.port) || 4477 });
    for (const line of result.lines) console.log(line);
    return;
  }
  if (sub === "remove") return console.log(scheduleRemove(w).join("\n"));
  if (sub !== "status") throw new UsageError("pm schedule [status | install [--times 08:30,12:30,18:30] [--deep] [--no-serve] | remove]");
  const st = scheduleStatus(w);
  if (st.otherWorkspace) console.log(`자동 업데이트: 이 PC에서는 다른 워크스페이스(${st.workspace})에 켜져 있습니다. 여기로 옮기려면 이 워크스페이스에서 pm schedule install`);
  else console.log(st.installed ? `자동 업데이트: 매일 ${st.times.join(" · ")} ${st.deep ? "전체" : "빠른"} 업데이트 (${st.loaded ? "켜짐" : "등록됐지만 꺼짐"})` : "자동 업데이트: 꺼짐 — pm schedule install [--deep]");
  if (st.serve) console.log(`대시보드 서버: http://127.0.0.1:${st.serve.port}/ (${st.serve.loaded ? "켜짐" : "등록됐지만 꺼짐"})`);
  if (st.log) console.log(`기록: ${st.log}`);
  const busy = runningUpdate(w);
  if (busy) console.log(`지금 업데이트 중 (${busy.at} 시작)`);
  for (const id of w.ids()) {
    const rec = readUpdate(w, id);
    const u = rec?.last;
    const st = Core.updateState(rec, { githubAt: w.github(id)?.syncedAt || null });
    console.log(`  ${pad(id, 22)}${u ? `${localTime(u.at)} · ${u.trigger === "schedule" ? "자동" : "수동"} · ${u.ok ? "" : "일부 실패 · "}${u.summary}` : "업데이트 기록 없음"}`);
    for (const f of st.failures) console.log(`  ${pad("", 22)}✗ ${f.text}`);
    if (st.sources.github || st.sources.client) console.log(`  ${pad("", 22)}기준: ${[st.sources.github && `GitHub ${localTime(st.sources.github)}`, st.sources.client && `고객사 답 ${localTime(st.sources.client)}`].filter(Boolean).join(" · ")}`);
  }
};

// ---------------------------------------------------------------- 스프린트

commands.sprint = (args) => {
  const { w, id } = target(args);
  const [code] = args._;
  if (code && typeof args.goal === "string") {
    const project = w.load(id);
    if (!args.goal.trim()) guardDeep("스프린트 목표 지우기", { w });
    project.sprints = { ...(project.sprints || {}) };
    if (args.goal.trim()) project.sprints[code] = { ...(project.sprints[code] || {}), goal: args.goal.trim(), updated: today() };
    else delete project.sprints[code];
    w.save(id, project);
    return console.log(`${code} 목표: ${args.goal.trim() || "(지움)"}`);
  }
  const m = buildModel(w, id);
  const goals = m.project.sprints || {};
  const views = m.forecast?.views?.filter((v) => v.isSprint) || [];
  if (!views.length && !Object.keys(goals).length) return console.log("스프린트가 없습니다. GitHub 마일스톤(SP-01 · 10/26~10/30)을 만들고 pm sync 하세요.");
  for (const v of views) {
    const key = v.title.split(/\s/)[0];
    console.log(`${pad(key, 8)}${pad(`${v.start ? F.monthDay(v.start) : ""}~${v.due ? F.monthDay(v.due) : ""}`, 14)}${pad(`${v.closed}/${v.total}`, 9)}${v.isCurrent ? "▶ " : v.isLate ? "! " : "  "}${goals[key]?.goal || "(목표 없음)"}`);
  }
  for (const key of Object.keys(goals).filter((k) => !views.some((v) => v.title.split(/\s/)[0] === k))) console.log(`${pad(key, 8)}${pad("", 23)}  ${goals[key].goal}`);
  console.log("\n목표 입력: pm sprint SP-05 --goal \"결제·환불 흐름 끝내기\"");
};

// ---------------------------------------------------------------- 결정·위험

// '이번 주'를 따옴표 없이 쓰면 셸이 두 낱말로 나누므로 남은 '주'를 --due에 붙인다
function joinDueWords(args) {
  if (/^(이번|다음)$/.test(String(args.due)) && args._.includes("주")) {
    args._.splice(args._.lastIndexOf("주"), 1);
    args.due = `${args.due} 주`;
  }
}
// --due를 썼는데 값이 없으면(다음이 다른 옵션이거나 끝) 사용법 오류
function dueArg(args) {
  if (args.due === undefined) return undefined;
  return parseDue([].concat(args.due).at(-1), "due");
}

// 번호(목록 순서) 또는 제목 일부로 찾는다
function pickRows(rows, keys, what) {
  if (!keys.length) throw new UsageError(`${what} 번호를 적으세요 (목록: pm ${what === "결정" ? "decision" : "risk"})`);
  return keys.map((key) => {
    const n = Number(key);
    const index = Number.isInteger(n) && n >= 1 && n <= rows.length ? n - 1 : rows.findIndex((r) => (r.title || "").includes(key));
    if (index < 0) throw new UsageError(`${what} '${key}'를 찾지 못했습니다. 번호는 1~${rows.length}`);
    return index;
  });
}

const dueText = (due) => {
  const info = Core.dueInfo(due, today());
  return !info ? "기한 없음" : info.invalid ? `기한 '${info.raw}'(날짜 아님)` : `기한 ${F.shortDate(info.date)} · ${info.label}`;
};
const checkedText = (row) => (row.checked?.at ? `확인 ${F.monthDay(row.checked.at)}${row.checked.src ? ` · ${row.checked.src}` : ""}${row.checked.guess ? " (추정)" : ""}` : "확인 기록 없음");

function rowsCommand(args, kind) {
  const { w, id } = target(args);
  const project = w.load(id);
  const key = kind === "decision" ? "decisions" : "risks";
  const what = kind === "decision" ? "결정" : "위험";
  const rows = (project[key] ||= []);
  joinDueWords(args);
  const [sub = "list", ...rest] = args._;
  const fields = kind === "decision" ? ["title", "recommend"] : ["title", "detail", "mitigation", "owner"];
  const setFields = (row) => {
    for (const field of fields) if (typeof args[field] === "string") row[field] = args[field].trim();
    if (kind === "risk" && args.level !== undefined) {
      if (!Core.RISK_LEVEL[args.level]) throw new UsageError(`--level: ${Object.keys(Core.RISK_LEVEL).join(", ")}`);
      row.level = args.level;
    }
    if (args["no-due"]) delete row.due;
    else {
      const due = dueArg(args);
      if (due) row.due = due;
    }
  };
  if (sub === "list") {
    const list = Core.model(Core.normalize(project, today()), { today: today() })[key];
    if (args.json) return console.log(JSON.stringify(list.map(({ dueInfo, ...row }) => ({ ...row, dueLabel: dueInfo?.label || null, late: !!dueInfo?.late, dueInvalid: !!dueInfo?.invalid })), null, 2));
    if (!list.length) return console.log(`${what} 필요한 일이 없습니다. 추가: pm ${kind} add "제목" ...`);
    for (const row of list) {
      const head = kind === "decision" ? `${row.title} — 권장: ${row.recommend || "-"}` : `[${Core.RISK_LEVEL[row.level] || row.level || "-"}] ${row.title}${row.owner ? ` · 담당 ${row.owner}` : ""}`;
      console.log(`${pad(row.n, 3)}${row.dueInfo?.late ? "! " : "  "}${head}`);
      console.log(`     ${dueText(row.due)} · ${checkedText(row)}${kind === "risk" && row.mitigation ? `\n     → ${row.mitigation}` : ""}`);
    }
    return;
  }
  if (sub === "add") {
    const title = rest.join(" ").trim() || (typeof args.title === "string" ? args.title.trim() : "");
    if (!title) throw new UsageError(`pm ${kind} add "제목" ...`);
    const row = kind === "decision" ? { title, recommend: "" } : { title, level: "mid" };
    setFields(row);
    row.title = title;
    row.checked = checkedMark(args, "PM");
    rows.push(row);
    w.save(id, project);
    return console.log(`${what} ${rows.length}: ${row.title} · ${dueText(row.due)}`);
  }
  if (sub === "set" || sub === "check") {
    const indexes = pickRows(rows, rest, what);
    if (sub === "check" && (typeof args.src !== "string" || !args.src.trim())) throw new UsageError("--src로 확인한 곳을 적으세요 (예: \"Notion 요청 페이지\", \"GitHub #153\", \"PM\")");
    if (sub === "set" && indexes.length !== 1) throw new UsageError(`pm ${kind} set은 한 번에 하나씩`);
    for (const index of indexes) {
      const row = rows[index];
      if (sub === "set") setFields(row);
      row.checked = checkedMark(args, "PM");
      console.log(`${what} ${index + 1}: ${row.title} · ${dueText(row.due)} · ${checkedText(row)}`);
    }
    return w.save(id, project);
  }
  // 결정됨: 결정 필요 목록에서 빼고, 무엇으로 정했는지(결과)와 날짜를 해결된 결정(resolvedDecisions)에 남긴다
  if (kind === "decision" && sub === "done") {
    guardDeep("결정 해결 처리(pm decision done)", { w });
    const [index] = pickRows(rows, rest.slice(0, 1), what);
    const result = [args.result, args.note].find((v) => typeof v === "string" && v.trim());
    if (!result) throw new UsageError('무엇으로 정했는지 --result로 적으세요 (예: pm decision done 1 --result "웹 결제로 출시, 앱 결제는 2차" --date 2026-10-12 --src "주간 회의")');
    const decidedAt = args.date === undefined ? today() : parseDate(args.date, "date");
    if (decidedAt > today()) throw new UsageError(`--date는 결정한 날입니다. 오늘(${today()}) 뒤의 날짜는 쓸 수 없습니다: ${decidedAt}`);
    const [row] = rows.splice(index, 1);
    const done = { title: row.title, recommend: row.recommend || "", ...(row.due ? { due: row.due } : {}), result: result.trim(), decidedAt, recordedAt: today(), src: typeof args.src === "string" && args.src.trim() ? args.src.trim() : "PM" };
    project.resolvedDecisions = [done, ...(project.resolvedDecisions || [])];
    w.save(id, project);
    return console.log(`결정됨으로 옮겼습니다: ${done.title} — ${done.result} (${F.shortDate(decidedAt)} 결정)\n결정 내용은 체크리스트·일정에도 반영하세요 (pm set, project.json).`);
  }
  if (kind === "risk" && sub === "remove") {
    guardDeep("위험 지우기(pm risk remove)", { w });
    const [index] = pickRows(rows, rest.slice(0, 1), what);
    const [row] = rows.splice(index, 1);
    w.save(id, project);
    return console.log(`${what} 목록에서 뺐습니다: ${row.title}${typeof args.note === "string" ? ` — ${args.note}` : ""}`);
  }
  if (kind === "decision" && sub === "resolved") {
    // 제목·결과·결정일이 맞지 않는 항목은 빼고 보여 준다(core.js가 거른다). 몇 개를 뺐는지는 알린다
    const done = Core.model(Core.normalize(project, today()), { today: today() }).resolvedDecisions;
    const skipped = (project.resolvedDecisions || []).length - done.length;
    if (args.json) return console.log(JSON.stringify(done, null, 2));
    if (!done.length) console.log("해결된 결정이 없습니다.");
    for (const d of done) console.log(`${F.monthDay(d.decidedAt)}  ${d.title} — ${d.result}${d.src ? ` (${d.src})` : ""}`);
    if (skipped > 0) console.log(`(형식이 맞지 않는 항목 ${skipped}개는 뺐습니다 — pm validate로 확인)`);
    return;
  }
  throw new UsageError(`pm ${kind} [list | add | set | check | ${kind === "decision" ? "done | resolved" : "remove"}] — pm help`);
}

commands.decision = (args) => rowsCommand(args, "decision");
commands.decisions = commands.decision;
commands.risk = (args) => rowsCommand(args, "risk");
commands.risks = commands.risk;

// ---------------------------------------------------------------- 계약

commands.contract = (args) => {
  const { w, id } = target(args);
  const project = w.load(id);
  if (!project.contract) project.contract = { signedAt: null, review: [], payments: [] };
  const [sub, key] = args._;
  if (sub) guardDeep(`계약 점검·대금 바꾸기(pm contract ${sub})`, { w });
  if (sub === "check") {
    const row = project.contract.review.find((r) => r.id === key);
    if (!row) throw new UsageError(`계약 점검 항목 ${key}가 없습니다: ${project.contract.review.map((r) => r.id).join(", ")}`);
    if (!Core.CONTRACT_REVIEW[args.status]) throw new UsageError("--status: ok, risk, missing, na");
    row.status = args.status;
    if (typeof args.note === "string") row.note = args.note;
    w.save(id, project);
    return console.log(`${row.title}: ${Core.CONTRACT_REVIEW[row.status].label}${row.note ? ` — ${row.note}` : ""}`);
  }
  if (sub === "pay") {
    const payment = project.contract.payments.find((p) => p.name === key);
    if (!payment) throw new UsageError(`대금 단계 ${key}가 없습니다: ${project.contract.payments.map((p) => p.name).join(", ")}`);
    if (!Core.PAYMENT_STATUS[args.status]) throw new UsageError("--status: planned, invoiced, paid");
    payment.status = args.status;
    if (args.status === "paid") payment.paidAt = args.date ? parseDate(args.date, "date") : today();
    w.save(id, project);
    return console.log(`${payment.name}: ${Core.PAYMENT_STATUS[payment.status]}`);
  }
  if (sub === "signed") {
    project.contract.signedAt = parseDate(args.date || "today", "date");
    const contract = project.checklist.find((i) => i.id === "contract");
    if (contract && contract.status !== "confirmed") {
      contract.status = "confirmed";
      contract.updated = today();
      contract.history = [...(contract.history || []), { date: today(), text: `계약 체결 ${project.contract.signedAt}` }];
    }
    w.save(id, project);
    return console.log(`계약 체결일 ${project.contract.signedAt}`);
  }
  const c = Core.contractSummary(Core.normalize(project), today());
  if (args.json) return console.log(JSON.stringify({ ...c, reviewItems: project.contract.review }, null, 2));
  console.log(`${project.name} 계약 ${c.signed ? `체결 ${c.signedAt}` : "체결 전"} · 점검 있음 ${c.review.ok}/${c.review.total} · 불리·모호 ${c.review.risk} · 없음 ${c.review.missing} · 확인 전 ${c.review.unchecked}`);
  console.log("\n점검 (pm contract check <id> --status ok|risk|missing|na --note ...)");
  for (const r of project.contract.review) console.log(`  ${pad(r.id, 20)}${pad(Core.CONTRACT_REVIEW[r.status || "unchecked"].label, 10)}${r.title}${r.note ? ` — ${r.note}` : ""}`);
  console.log("\n대금 (pm contract pay <이름> --status invoiced|paid)");
  for (const p of c.payments) console.log(`  ${pad(p.name, 8)}${pad(p.ratio ? `${p.ratio}%` : "", 6)}${pad(Core.PAYMENT_STATUS[p.status], 8)}${p.trigger}${p.dueDate ? ` · ${F.shortDate(p.dueDate)} 예정` : ""}${p.paidAt ? ` · ${p.paidAt} 받음` : ""}`);
};

// ---------------------------------------------------------------- 대시보드

commands.build = (args) => {
  const w = ws(args);
  const client = !!args.client;
  const ids = typeof args.project === "string" || client ? [w.resolveId(args, gitRemoteRepo())] : w.ids();
  if (!ids.length) throw new UsageError("등록된 프로젝트가 없습니다. pm init <id>로 만드세요.");
  if (args.out !== undefined) guardDeep("--out으로 파일 쓰기", { w });
  const out =
    typeof args.out === "string"
      ? path.resolve(args.out)
      : path.join(w.dir, "build", client ? `${ids[0]}-client-${today()}.html` : ids.length === 1 ? `${ids[0]}.html` : "dashboard.html");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, dashboardHtml(w, { ids, client }));
  console.log(`${out}${client ? " (고객사 공유본: 요청 목록·일정·진행률만, 내부 메모·계약·결정·위험·이슈 제목 제외)" : ""}`);
  if (args.open) openFile(out);
};

commands.serve = (args) => serve(ws(args), { port: Number(args.port) || 4477, open: !!args.open });

// ---------------------------------------------------------------- 실행

const [name = "help", ...rest] = process.argv.slice(2);
const command = commands[name];
if (!command) {
  console.error(`알 수 없는 명령: ${name}\n`);
  commands.help();
  process.exit(2);
}
try {
  await command(parseArgs(rest));
} catch (error) {
  console.error(error instanceof UsageError ? error.message : error.stack || String(error));
  process.exit(1);
}
