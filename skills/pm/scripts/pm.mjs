#!/usr/bin/env node
/**
 * pm — 외주 개발 프로젝트 PM 도구. Node 18 이상, 설치할 의존성 없음.
 *
 * 프로젝트 데이터는 고객사 저장소가 아니라 PM_DASHBOARD_HOME(기본 ~/.pm-dashboard)에 둔다.
 *   <home>/config.json                 회사 이름 등 공통 설정
 *   <home>/projects/<id>/project.json  일정·체크리스트·결정·위험·리소스 (사람과 Claude가 고친다)
 *   <home>/projects/<id>/github.json   이슈·마일스톤 스냅샷 (pm sync가 만든다)
 *   <home>/build/                      pm build 결과
 *
 * 명령은 `pm help`를 본다.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(here, "..");
const APP_DIR = path.join(SKILL_DIR, "app");
const TEMPLATE_DIR = path.join(SKILL_DIR, "templates");
const require = createRequire(import.meta.url);
const F = require(path.join(APP_DIR, "js", "forecast.js"));
const Core = require(path.join(APP_DIR, "js", "core.js"));

const HOME = process.env.PM_DASHBOARD_HOME || path.join(os.homedir(), ".pm-dashboard");
const PROJECTS_DIR = path.join(HOME, "projects");
const BALLS = ["client", "us", "dev"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const today = () => F.kstDate(new Date());

// ---------------------------------------------------------------- 공통

class UsageError extends Error {}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const [key, inline] = token.slice(2).split(/=(.*)/s);
    if (inline !== undefined) args[key] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) args[key] = argv[++i];
    else args[key] = true;
  }
  return args;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

const projectDir = (id) => path.join(PROJECTS_DIR, id);
const projectFile = (id) => path.join(projectDir(id), "project.json");
const githubFile = (id) => path.join(projectDir(id), "github.json");

function config() {
  const file = path.join(HOME, "config.json");
  return { company: "우리 회사", ...(fs.existsSync(file) ? readJson(file) : {}) };
}

function listProjectIds() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs
    .readdirSync(PROJECTS_DIR)
    .filter((id) => fs.existsSync(projectFile(id)))
    .sort();
}

function loadProject(id) {
  if (!fs.existsSync(projectFile(id))) throw new UsageError(`프로젝트 ${id}가 없습니다. pm list-projects로 확인하세요.`);
  return readJson(projectFile(id));
}

function gitRemoteRepo(cwd = process.cwd()) {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const match = url.match(/github[^:/]*[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// --project가 없으면 지금 폴더의 git 저장소와 연결된 프로젝트, 하나뿐이면 그 프로젝트
function resolveProjectId(args) {
  if (typeof args.project === "string") return args.project;
  const ids = listProjectIds();
  if (!ids.length) throw new UsageError("등록된 프로젝트가 없습니다. pm init <id>로 만드세요.");
  const repo = gitRemoteRepo()?.toLowerCase();
  if (repo) {
    const matched = ids.filter((id) => {
      const p = readJson(projectFile(id));
      return [p.github?.repo, ...(p.repos || [])].some((r) => r?.toLowerCase() === repo);
    });
    if (matched.length === 1) return matched[0];
  }
  if (ids.length === 1) return ids[0];
  throw new UsageError(`어느 프로젝트인지 모르겠습니다. --project <id>를 붙이세요: ${ids.join(", ")}`);
}

function githubToken() {
  const fromEnv = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new UsageError("GitHub 토큰이 없습니다. gh auth login 하거나 GITHUB_TOKEN을 설정하세요.");
  }
}

// 예측까지 계산한 모델. 스냅샷이 없으면 forecast는 null
function buildModel(id, scenario) {
  const project = Core.normalize(loadProject(id), today());
  let forecast = null;
  if (project.github && fs.existsSync(githubFile(id))) {
    const gh = readJson(githubFile(id));
    const issues = F.normalizeIssues(gh.issues);
    forecast = F.compute({ issues, milestones: gh.milestones, now: new Date(gh.syncedAt).getTime(), config: project.forecastConfig, scenario: scenario || {} });
    forecast.syncedAt = gh.syncedAt;
    forecast.issues = issues;
  }
  return Core.model(project, { forecast, queue: project.queue || [], today: today() });
}

function openFile(target) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

const pad = (text, width) => {
  const str = String(text ?? "");
  const visible = [...str].reduce((w, ch) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);
  return str + " ".repeat(Math.max(0, width - visible));
};
const fmt = (n) => (n == null || Number.isNaN(n) ? "-" : Math.round(n).toLocaleString("ko-KR"));
function syncAge(iso) {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return hours < 1 ? "1시간 안" : hours < 48 ? `${Math.round(hours)}시간 전` : `${Math.round(hours / 24)}일 전`;
}

// ---------------------------------------------------------------- 명령

const commands = {};

commands.help = () => {
  console.log(`pm — 외주 개발 프로젝트 PM 도구 (데이터: ${HOME})

프로젝트
  init <id> [--name 이름] [--client 고객사] [--repo owner/repo] [--from standard|sample]
            [--kickoff D] [--dev-start D] [--dev-end D] [--qa-start D] [--qa-end D] [--launch D]
  list-projects                     등록된 프로젝트
  where [--project id]              데이터 위치
  config [key [value]]              공통 설정 (company: 회사 이름)
  validate [--project id | --all]   project.json 점검

현황
  sync [--project id | --all]       GitHub 이슈·마일스톤 스냅샷 받기
  status [--project id] [--json]    브리핑·예측·준비율·고객사 대기
  forecast [--velocity %] [--inflow %] [--descope n] [--json]   가정을 바꿔 예측

체크리스트
  list [--status s] [--ball client|us|dev] [--cat c] [--json]
  set <item> [--status s] [--ball b] [--requested today|D] [--due D] [--res-label t] [--res-url u]
             [--note t] [--need t] [--proposal t] [--log 기록]
  request <item> [--receive notion|drive|email|repo] [--mode ask|draft|meeting] [--due D] [--queue]
                                    고객사 요청서(요청함이면 리마인드) 초안. 보내지 않는다

대시보드
  build [--project id] [--client] [--out 파일] [--open]   한 파일 HTML (--client: 고객사 공유본)
  serve [--port 4477] [--open]      로컬 서버. 화면에서 바꾼 상태를 project.json에 저장

D는 YYYY-MM-DD. --project를 빼면 지금 폴더의 git 저장소와 연결된 프로젝트를 쓴다.`);
};

commands["list-projects"] = () => {
  const ids = listProjectIds();
  if (!ids.length) return console.log("등록된 프로젝트가 없습니다. pm init <id>로 만드세요.");
  for (const id of ids) {
    const p = readJson(projectFile(id));
    console.log(`${pad(id, 22)}${pad(p.name, 24)}${p.client || ""}${p.github?.repo ? ` · ${p.github.repo}` : ""}`);
  }
};

commands.where = (args) => {
  console.log(`home     ${HOME}`);
  if (!listProjectIds().length) return;
  const id = resolveProjectId(args);
  console.log(`project  ${projectFile(id)}`);
  console.log(`github   ${githubFile(id)}${fs.existsSync(githubFile(id)) ? "" : " (아직 없음)"}`);
};

commands.config = (args) => {
  const file = path.join(HOME, "config.json");
  const current = fs.existsSync(file) ? readJson(file) : {};
  const [key, value] = args._;
  if (!key) return console.log(JSON.stringify(config(), null, 2));
  if (value === undefined) return console.log(config()[key] ?? "");
  writeJson(file, { ...current, [key]: value });
  console.log(`${key} = ${value}`);
};

commands.init = (args) => {
  const [id] = args._;
  if (!id || !ID_RE.test(id)) throw new UsageError("pm init <id> — id는 영문 소문자·숫자·하이픈 (예: my-app)");
  if (fs.existsSync(projectFile(id)) && !args.force) throw new UsageError(`${projectFile(id)}가 이미 있습니다. 덮어쓰려면 --force`);
  const from = args.from || "standard";
  const templateFile = path.join(TEMPLATE_DIR, from === "sample" ? "sample-project.json" : "project.json");
  const project = readJson(templateFile);
  project.id = id;
  if (args.name) project.name = args.name;
  else if (from !== "sample") project.name = id;
  if (args.client) project.client = args.client;
  const repo = typeof args.repo === "string" ? args.repo : from === "sample" ? null : gitRemoteRepo();
  if (repo) project.github = { repo };
  const dateArgs = { kickoff: "kickoff", devStart: "dev-start", devEnd: "dev-end", qaStart: "qa-start", qaEnd: "qa-end", launch: "launch" };
  for (const [field, flag] of Object.entries(dateArgs)) {
    if (args[flag] === undefined) continue;
    if (!DATE_RE.test(args[flag])) throw new UsageError(`--${flag}는 YYYY-MM-DD`);
    project.dates = { ...project.dates, [field]: args[flag] };
  }
  if (from !== "sample") project.asOf = today();
  writeJson(projectFile(id), project);
  if (!fs.existsSync(path.join(HOME, "config.json"))) writeJson(path.join(HOME, "config.json"), { company: args.company || "우리 회사" });
  console.log(`만들었습니다: ${projectFile(id)}`);
  console.log(`- 체크리스트 ${project.checklist.length}개 (${from === "sample" ? "샘플" : "표준 킥오프"})${repo ? ` · GitHub ${repo}` : " · GitHub 저장소 없음 (--repo 또는 project.json의 github.repo)"}`);
  const missingDates = Object.keys(dateArgs).filter((field) => !project.dates?.[field]);
  if (missingDates.length) console.log(`- 아직 없는 날짜: ${missingDates.join(", ")} → project.json의 dates에 채우세요`);
  console.log("- 다음: pm sync → pm build --open");
};

commands.validate = (args) => {
  const ids = args.all ? listProjectIds() : [resolveProjectId(args)];
  let problems = 0;
  for (const id of ids) {
    const p = loadProject(id);
    const issues = [];
    if (p.id !== id) issues.push(`id가 폴더 이름(${id})과 다름: ${p.id}`);
    for (const [key, value] of Object.entries(p.dates || {})) if (value && !DATE_RE.test(value)) issues.push(`dates.${key} 형식: ${value}`);
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
      for (const field of ["requested", "due", "updated", "blocksDate"]) if (item[field] && !DATE_RE.test(item[field])) issues.push(`${where}.${field} 형식: ${item[field]}`);
      if (item.status === "requested" && !item.requested) issues.push(`${where}: 요청함인데 requested 날짜가 없음(대기 일수를 못 셈)`);
    }
    const text = JSON.stringify(p);
    if (/sk-ant-|ghp_|github_pat_|xox[bp]-|AKIA[0-9A-Z]{16}/.test(text)) issues.push("비밀값처럼 보이는 문자열이 있음 — project.json에는 링크와 이름만 둔다");
    problems += issues.length;
    console.log(issues.length ? `✗ ${id}\n${issues.map((x) => `  - ${x}`).join("\n")}` : `✓ ${id}`);
  }
  if (problems) process.exitCode = 1;
};

commands.sync = async (args) => {
  const ids = args.all ? listProjectIds().filter((id) => readJson(projectFile(id)).github?.repo) : [resolveProjectId(args)];
  const token = githubToken();
  for (const id of ids) {
    const repo = loadProject(id).github?.repo;
    if (!repo) throw new UsageError(`${id}: project.json에 github.repo가 없습니다`);
    const list = async (apiPath) => {
      const items = [];
      let next = `https://api.github.com/repos/${repo}/${apiPath}${apiPath.includes("?") ? "&" : "?"}per_page=100`;
      for (let page = 0; next && page < 50; page += 1) {
        const response = await fetch(next, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pm-dashboard" },
        });
        if (!response.ok) throw new Error(`GitHub ${response.status} ${repo}/${apiPath}: ${(await response.text()).slice(0, 200)}`);
        items.push(...(await response.json()));
        next = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
      }
      return items;
    };
    const [milestones, issues] = await Promise.all([list("milestones?state=all"), list("issues?state=all")]);
    // 키를 짧게 줄여 파일 크기를 줄인다. forecast.js의 normalizeIssues가 풀어서 쓴다
    const snapshot = {
      repo,
      syncedAt: new Date().toISOString(),
      milestones: milestones.map((m) => ({ number: m.number, title: m.title, state: m.state, due: m.due_on ? m.due_on.slice(0, 10) : null, open: m.open_issues, closed: m.closed_issues })),
      issues: issues
        .filter((i) => !i.pull_request)
        .map((i) => ({ n: i.number, t: i.title, s: i.state, r: i.state_reason ?? null, c: i.created_at, x: i.closed_at, m: i.milestone?.number ?? null, l: i.labels.map((l) => l.name), a: i.assignees.map((a) => a.login) })),
    };
    fs.mkdirSync(projectDir(id), { recursive: true });
    fs.writeFileSync(githubFile(id), JSON.stringify(snapshot));
    console.log(`${id} · ${repo} · 이슈 ${snapshot.issues.length} · 마일스톤 ${snapshot.milestones.length}`);
  }
};

function statusSummary(m) {
  const { project, forecast, readiness, waiting, missing, health } = m;
  const p = forecast?.project;
  const launch = project.dates?.launch;
  return {
    project: { id: project.id, name: project.name, client: project.client, dates: project.dates, dataAsOf: project.asOf || null },
    health: { label: health.label, reasons: health.reasons },
    launch: launch ? { date: launch, daysLeft: F.daysBetween(m.today, launch) } : null,
    briefing: Core.briefing(m).map((item) => item.text),
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
    missing: missing.map((i) => ({ id: i.id, title: i.title, ball: i.ball, blocks: i.blocks || null })),
    waitingOnClient: waiting.map((i) => ({ id: i.id, title: i.title, waitDays: i.waitDays, overdue: i.overdue, blocks: i.blocks || null })),
    decisions: project.decisions || [],
    risks: project.risks || [],
    approvalQueue: (project.queue || []).map((q) => ({ id: q.id, title: q.title })),
  };
}

commands.status = (args) => {
  const m = buildModel(resolveProjectId(args));
  const s = statusSummary(m);
  if (args.json) return console.log(JSON.stringify(s, null, 2));
  console.log(`${s.project.name} (${s.project.client || "-"}) · ${s.health.label}${s.launch ? ` · 출시 ${F.monthDay(s.launch.date)} D-${s.launch.daysLeft}` : ""}`);
  if (s.health.reasons.length) console.log(`  신호: ${s.health.reasons.join(" · ")}`);
  console.log("");
  s.briefing.forEach((line, i) => console.log(`${i + 1}. ${line}`));
  console.log("");
  if (s.forecast) {
    const f = s.forecast;
    console.log(`예측  남은 ${f.remaining} · 처리 ${fmt(f.velocityPerWeek)}/주 · 유입 ${fmt(f.inflowPerWeek)}/주 · 새 이슈가 멈추면 ${F.shortDate(f.expected)} (${F.monthDay(f.optimistic)}~${F.monthDay(f.pessimistic)})`);
    console.log(`      지금 추세면 ${F.monthDay(f.target)}에 ~${f.remainingAtTarget}건 남음 · 맞추려면 주 ${f.requiredVelocityPerWeek}건 · GitHub ${syncAge(f.snapshot)} 스냅샷`);
  } else console.log("예측  GitHub 스냅샷 없음 (pm sync)");
  console.log(`준비  ${s.readiness.ready}/${s.readiness.total} 확정 (${s.readiness.percent}%) · 없음 ${s.missing.length} · 고객사 대기 ${s.waitingOnClient.length}${s.waitingOnClient[0] ? ` (최장 D+${s.waitingOnClient[0].waitDays} ${s.waitingOnClient[0].title})` : ""}`);
  if (s.approvalQueue.length) console.log(`승인 대기열 ${s.approvalQueue.length}건`);
};

commands.forecast = (args) => {
  const scenario = { velocityPct: Number(args.velocity) || 0, inflowPct: Number(args.inflow) || 0, descope: Math.max(0, Number(args.descope) || 0) };
  const m = buildModel(resolveProjectId(args), scenario);
  const p = m.forecast?.project;
  if (!p) throw new UsageError("GitHub 스냅샷이 없거나 예측할 이슈가 없습니다. pm sync를 먼저 하세요.");
  const result = { scenario, ...statusSummary(m).forecast };
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`가정: 처리 ${scenario.velocityPct >= 0 ? "+" : ""}${scenario.velocityPct}% · 유입 ${scenario.inflowPct >= 0 ? "+" : ""}${scenario.inflowPct}% · 범위 -${scenario.descope}건`);
  console.log(`${p.targetLabel} ${F.shortDate(p.target)}: ${result.status} · 새 이슈가 멈추면 ${F.shortDate(p.expected)} · 지금 추세면 ~${p.remainingAtTarget}건 남음 · 유입까지 감안한 완료 ${p.netFinish ? F.shortDate(p.netFinish) : "계산 불가(유입 > 처리)"}`);
};

commands.list = (args) => {
  const m = buildModel(resolveProjectId(args));
  const company = config().company;
  const ballLabel = Core.labels(company).BALL;
  const items = m.checklist.filter(
    (i) => (!args.status || i.status === args.status) && (!args.ball || i.ball === args.ball) && (!args.cat || i.cat === args.cat),
  );
  if (args.json) return console.log(JSON.stringify(items, null, 2));
  for (const cat of m.project.categories) {
    const rows = items.filter((i) => i.cat === cat.id).sort((a, b) => Core.STATUS[a.status].order - Core.STATUS[b.status].order);
    if (!rows.length) continue;
    console.log(`\n${cat.name}`);
    for (const i of rows)
      console.log(
        `  ${pad(i.id, 20)}${pad(Core.STATUS[i.status].label, 10)}${pad(ballLabel[i.ball] || i.ball, 10)}${pad(i.waitDays != null ? `D+${i.waitDays}` : i.due ? `~${F.monthDay(i.due)}` : "", 8)}${i.title}${i.blocks ? ` → ${i.blocks}` : ""}`,
      );
  }
};

commands.set = (args) => {
  const id = resolveProjectId(args);
  const [itemId] = args._;
  if (!itemId) throw new UsageError("pm set <item> --status ...");
  const project = loadProject(id);
  const item = project.checklist.find((i) => i.id === itemId);
  if (!item) throw new UsageError(`체크리스트에 ${itemId}가 없습니다. pm list로 확인하세요.`);
  const before = { status: item.status, ball: item.ball };
  const date = (value, flag) => {
    const v = value === "today" ? today() : value;
    if (!DATE_RE.test(v)) throw new UsageError(`--${flag}는 YYYY-MM-DD 또는 today`);
    return v;
  };
  if (args.status) {
    if (!Core.STATUS[args.status]) throw new UsageError(`--status: ${Object.keys(Core.STATUS).join(", ")}`);
    item.status = args.status;
    if (args.status === "requested" && !args.requested && before.status !== "requested") item.requested = today();
  }
  if (args.ball) {
    if (!BALLS.includes(args.ball)) throw new UsageError(`--ball: ${BALLS.join(", ")}`);
    item.ball = args.ball;
  }
  if (args.requested) item.requested = date(args.requested, "requested");
  if (args.due) item.due = date(args.due, "due");
  if (args["res-label"] || args["res-url"]) item.res = { label: args["res-label"] || item.res?.label || args["res-url"], url: args["res-url"] || item.res?.url || "" };
  for (const field of ["note", "need", "proposal"]) if (typeof args[field] === "string") item[field] = args[field];
  item.updated = today();
  const changes = [];
  if (before.status !== item.status) changes.push(`상태 ${Core.STATUS[before.status]?.label} → ${Core.STATUS[item.status].label}`);
  if (before.ball !== item.ball) changes.push(`공 ${before.ball} → ${item.ball}`);
  if (typeof args.log === "string") changes.push(args.log);
  if (changes.length) item.history = [...(item.history || []), { date: today(), text: changes.join(" · ") }];
  writeJson(projectFile(id), project);
  console.log(`${id}/${itemId}: ${changes.join(" · ") || "갱신"}`);
};

commands.request = (args) => {
  const id = resolveProjectId(args);
  const [itemId] = args._;
  const m = buildModel(id);
  const item = m.checklist.find((i) => i.id === itemId);
  if (!item) throw new UsageError(`체크리스트에 ${itemId}가 없습니다.`);
  const company = config().company;
  const { RECEIVE, MODES } = Core.labels(company);
  const receive = RECEIVE[args.receive] ? args.receive : item.receiveAt || m.project.receiveDefault;
  const mode = MODES[args.mode] ? args.mode : item.mode || "ask";
  const due = typeof args.due === "string" ? args.due : item.due || F.addDays(today(), 5);
  const reminder = item.status === "requested";
  const text = reminder ? Core.reminderText(m.project, item) : Core.requestText(m.project, item, { receive, mode, due }, company);
  console.log(text);
  if (args.queue) {
    const project = loadProject(id);
    const entry = {
      id: `q-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      projectId: id,
      kind: reminder ? "reminder" : "request",
      itemId,
      title: `${item.title} ${reminder ? "리마인드" : "요청"}`,
      to: `${m.project.client} 담당자`,
      channel: RECEIVE[receive].label,
      receive,
      mode,
      due,
      text,
      by: "claude",
    };
    project.queue = [...(project.queue || []), entry];
    writeJson(projectFile(id), project);
    console.error(`\n승인 대기열에 넣었습니다 (${entry.id}). 보내지는 않았습니다.`);
  }
};

// ---------------------------------------------------------------- 대시보드 만들기

// <script> 안에 넣는 JSON. </script>나 줄 구분 문자가 스크립트를 끊지 않게 바꾼다
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");
const scriptJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATORS, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);

function dashboardHtml({ ids, server = false, client = false }) {
  const projects = {};
  const github = {};
  for (const id of ids) {
    const project = Core.normalize(loadProject(id), today());
    projects[id] = client ? Core.clientSafe(project) : project;
    if (project.github && fs.existsSync(githubFile(id))) {
      const snapshot = readJson(githubFile(id));
      // 공유본에는 이슈 제목을 넣지 않는다(마일스톤 진행률만)
      github[id] = client ? { ...snapshot, issues: [] } : snapshot;
    }
  }
  const mode = { server, client, company: config().company, builtAt: new Date().toISOString() };
  const scripts = [
    `<script>window.PM_MODE=${scriptJson(mode)};window.PM_PROJECTS=${scriptJson(projects)};window.PM_GITHUB=${scriptJson(github)};</script>`,
    ...["forecast.js", "core.js", "app.js", "agent.js"].map((file) => `<script>\n${fs.readFileSync(path.join(APP_DIR, "js", file), "utf8")}\n</script>`),
  ].join("\n");
  // replace의 두 번째 인자에 문자열을 주면 $& 같은 패턴이 해석되므로 함수로 넘긴다
  return fs.readFileSync(path.join(APP_DIR, "index.html"), "utf8").replace("<!-- PM:SCRIPTS -->", () => scripts);
}

commands.build = (args) => {
  const client = !!args.client;
  let ids;
  if (typeof args.project === "string" || client) ids = [resolveProjectId(args)];
  else ids = listProjectIds();
  if (!ids.length) throw new UsageError("등록된 프로젝트가 없습니다. pm init <id>로 만드세요.");
  const out =
    typeof args.out === "string"
      ? path.resolve(args.out)
      : path.join(HOME, "build", client ? `${ids[0]}-client-${today()}.html` : ids.length === 1 ? `${ids[0]}.html` : "dashboard.html");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, dashboardHtml({ ids, client }));
  console.log(`${out}${client ? " (고객사 공유본: 내부 메모·결정·위험·이슈 제목·승인 대기열 제외)" : ""}`);
  if (args.open) openFile(out);
};

// ---------------------------------------------------------------- 로컬 서버

const ITEM_FIELDS = ["status", "ball", "res", "requested", "due", "updated", "receiveAt", "mode", "note"];

function readBody(req, limit = 5_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

commands.serve = (args) => {
  const port = Number(args.port) || 4477;
  const host = "127.0.0.1";
  const origins = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);
  const send = (res, status, body, type = "application/json; charset=utf-8") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return send(res, 200, dashboardHtml({ ids: listProjectIds(), server: true }), "text/html; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/api/config") return send(res, 200, { claude: !!process.env.ANTHROPIC_API_KEY, company: config().company });

      // 다른 사이트가 이 로컬 서버에 쓰지 못하게, 같은 출처의 JSON 요청만 받는다
      if (req.method !== "GET") {
        const origin = req.headers.origin;
        if (origin && !origins.has(origin)) return send(res, 403, { error: "origin" });
        if (req.method !== "DELETE" && !String(req.headers["content-type"] || "").startsWith("application/json")) return send(res, 415, { error: "json only" });
      }

      if (req.method === "POST" && url.pathname === "/api/claude") {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) return send(res, 503, { error: { message: "pm serve에 ANTHROPIC_API_KEY가 없습니다" } });
        const body = await readBody(req);
        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "server-side-fallback-2026-07-01",
          },
          body: JSON.stringify(body),
        });
        return send(res, upstream.status, await upstream.text());
      }

      const match = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/(items|resources|queue)(?:\/([^/]+))?$/);
      if (!match) return send(res, 404, { error: "not found" });
      const [, id, kind, rawSub] = match;
      const sub = rawSub ? decodeURIComponent(rawSub) : null;
      const project = loadProject(id);

      if (kind === "items" && req.method === "POST" && sub) {
        const { patch = {}, logText } = await readBody(req);
        const item = project.checklist.find((i) => i.id === sub);
        if (!item) return send(res, 404, { error: "item" });
        for (const field of ITEM_FIELDS) if (field in patch) item[field] = patch[field];
        if (item.status && !Core.STATUS[item.status]) return send(res, 400, { error: "status" });
        if (item.ball && !BALLS.includes(item.ball)) return send(res, 400, { error: "ball" });
        if (logText) item.history = [...(item.history || []), { date: today(), text: String(logText).slice(0, 500) }];
        writeJson(projectFile(id), project);
        return send(res, 200, { ok: true, item });
      }
      if (kind === "resources" && req.method === "POST" && sub) {
        const { url: link = "" } = await readBody(req);
        const resource = (project.resources || []).find((r) => r.id === sub);
        if (!resource) return send(res, 404, { error: "resource" });
        resource.url = /^https?:\/\//.test(link) ? link : "";
        writeJson(projectFile(id), project);
        return send(res, 200, { ok: true });
      }
      if (kind === "queue" && req.method === "POST" && !sub) {
        const { entry } = await readBody(req);
        if (!entry?.id || typeof entry.text !== "string") return send(res, 400, { error: "entry" });
        project.queue = [...(project.queue || []).filter((q) => q.id !== entry.id), entry];
        writeJson(projectFile(id), project);
        return send(res, 200, { ok: true });
      }
      if (kind === "queue" && req.method === "DELETE" && sub) {
        project.queue = (project.queue || []).filter((q) => q.id !== sub);
        writeJson(projectFile(id), project);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: "method" });
    } catch (error) {
      return send(res, error instanceof UsageError ? 404 : 500, { error: error.message });
    }
  });

  server.listen(port, host, () => {
    const address = `http://${host}:${port}/`;
    console.log(`PM 대시보드 ${address} (끄려면 Ctrl+C)`);
    console.log(`데이터 ${PROJECTS_DIR} · 프로젝트 ${listProjectIds().join(", ") || "없음"}`);
    console.log(`리미 Claude 모드: ${process.env.ANTHROPIC_API_KEY ? "서버 키 사용" : "ANTHROPIC_API_KEY 없음 → 화면에서 키를 넣거나 내장 모드"}`);
    if (args.open) openFile(address);
  });
};

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
