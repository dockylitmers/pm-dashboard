/**
 * 업데이트: 대시보드가 실제 업무 상황을 반영하도록 원본을 다시 읽는다.
 * - GitHub 이슈 스냅샷(pm sync)을 새로 받고
 * - 다시 확인할 값(추정 · 오래됨 · 확인 뒤 연결된 GitHub 이슈가 바뀜)을 계산해
 * - projects/<id>/update.json(마지막 결과와 기록)에 남긴다. 대시보드 '업데이트' 창이 이것을 보여 준다.
 * 전체 업데이트(--deep)는 여기에 더해 Claude Code를 headless로 띄워 원본(GitHub 코멘트, Notion 요청 페이지)을 읽고
 * pm answer·set·check로 이 워크스페이스의 값만 고친다. 원본에는 쓰지 않는다. 읽기 도구와 pm CLI만 허용하고
 * 그 밖의 도구는 묻지 않고 거절한다(--permission-mode dontAsk). 사람에게 물을 것은 asks로 남긴다.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Core, F, readJson, SKILL_DIR, today, writeJson } from "./common.mjs";
import { issueStates, sync } from "./github.mjs";

export const PM_SCRIPT = path.join(SKILL_DIR, "scripts", "pm.mjs");
const HISTORY_LIMIT = 30;
const LOCK_STALE_MS = 45 * 60 * 1000;
const DEEP_TIMEOUT_MS = 25 * 60 * 1000;

// 예측까지 계산한 모델. 스냅샷이 없으면 forecast는 null
export function buildModel(w, id, scenario) {
  const project = Core.normalize(w.load(id), today());
  let forecast = null;
  const gh = project.github ? w.github(id) : null;
  if (gh) {
    const issues = F.normalizeIssues(gh.issues);
    forecast = F.compute({ issues, milestones: gh.milestones, now: new Date(gh.syncedAt).getTime(), config: project.forecastConfig, scenario: scenario || {} });
    forecast.syncedAt = gh.syncedAt;
    forecast.issues = issues;
  }
  return Core.model(project, { forecast, queue: project.queue || [], today: today() });
}

// 항목에 적힌 GitHub 이슈(링크, #번호). 같은 저장소의 #번호만 짧은 형식으로 읽는다
function issueRefs(item, repo) {
  const refs = new Map();
  const text = [item.res?.url, item.res?.label, item.note, item.internal].filter(Boolean).join(" ");
  for (const m of text.matchAll(/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)/g)) refs.set(`${m[1]}#${m[2]}`, { repo: m[1], n: Number(m[2]) });
  if (repo) for (const m of text.matchAll(/(?<![\w/&#])#(\d{1,6})\b/g)) if (![...refs.values()].some((r) => r.n === Number(m[1]))) refs.set(`${repo}#${m[1]}`, { repo, n: Number(m[1]) });
  return [...refs.values()];
}

// 다시 확인할 값: 추정, 오래됨, 확인 뒤 GitHub 이슈가 바뀜
export async function refreshReport(w, id, { offline = false } = {}) {
  const m = buildModel(w, id);
  const repo = m.project.github?.repo || null;
  const open = m.checklist.filter((i) => i.status !== "not_needed");
  const refsByItem = new Map(open.map((i) => [i.id, issueRefs(i, repo)]));
  const allRefs = [...new Map([...refsByItem.values()].flat().map((r) => [`${r.repo}#${r.n}`, r])).values()];
  let states = new Map();
  let githubNote = null;
  if (offline) githubNote = "GitHub 확인 안 함(--offline)";
  else if (allRefs.length) {
    try {
      states = await issueStates(allRefs);
    } catch (error) {
      githubNote = `GitHub 확인 못 함: ${error.message}`;
    }
  }
  const picked = open
    .map((item) => {
      const changed = refsByItem
        .get(item.id)
        .map((r) => ({ ...r, ...(states.get(`${r.repo}#${r.n}`) || {}) }))
        .filter((r) => r.updated && (!item.checkedAt || r.updated > item.checkedAt));
      return { item, changed };
    })
    .filter(({ item, changed }) => item.recheck || changed.length);
  const kind = ({ item, changed }) => (item.guess ? "guess" : changed.length ? "moved" : "stale");
  return {
    model: m,
    repo,
    githubNote: githubNote || (allRefs.length ? `연결된 이슈 ${allRefs.length}개 확인` : "연결된 이슈 없음"),
    githubFailed: !!githubNote && !offline,
    picked,
    counts: {
      total: picked.length,
      guess: picked.filter((r) => kind(r) === "guess").length,
      moved: picked.filter((r) => kind(r) === "moved").length,
      stale: picked.filter((r) => kind(r) === "stale").length,
    },
    kind,
  };
}

// ---------------------------------------------------------------- 기록·잠금

export const updateFile = (w, id) => path.join(w.projectDir(id), "update.json");
export function readUpdate(w, id) {
  try {
    return fs.existsSync(updateFile(w, id)) ? readJson(updateFile(w, id)) : null;
  } catch {
    return null;
  }
}
// 원본별로 마지막으로 읽기에 성공한 시각. 한 단계가 실패해도 다른 원본이 언제 기준인지 화면이 따로 보여 준다
export function sourceTimes(previous, result) {
  const prev = previous?.last?.sources || {};
  const ok = (key) => result.steps.some((s) => s.key === key && s.ok);
  // 예전 기록에는 sources가 없으므로 기록에서 마지막으로 성공한 전체 업데이트를 찾는다
  const lastDeep = (previous?.history || []).find((h) => h.mode === "deep" && h.ok)?.at || null;
  return {
    github: ok("github") ? result.at : prev.github || null,
    client: ok("deep") ? result.at : prev.client || lastDeep,
  };
}
function recordUpdate(w, id, result) {
  const previous = readUpdate(w, id) || {};
  const last = { ...result, sources: sourceTimes(previous, result) };
  const line = { at: result.at, trigger: result.trigger, mode: result.mode, ok: result.ok, summary: result.summary, ...(result.ok ? {} : { error: result.error }) };
  writeJson(updateFile(w, id), { last, history: [line, ...(previous.history || [])].slice(0, HISTORY_LIMIT) });
}

const lockFile = (w) => path.join(w.dir, ".pm-update.lock");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
// 지금 업데이트 중이면 그 정보를, 아니면 null
export function runningUpdate(w) {
  try {
    const lock = readJson(lockFile(w));
    if (alive(lock.pid) && Date.now() - new Date(lock.at).getTime() < LOCK_STALE_MS) return lock;
  } catch {}
  return null;
}
export const logDir = (w) => path.join(w.dir, ".pm-logs");

// ---------------------------------------------------------------- 전체 업데이트(Claude)

const sh = (command, timeout = 20000) => execFileSync("/bin/sh", ["-lc", command], { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] });
export function claudeBin() {
  if (process.env.PM_CLAUDE_BIN && fs.existsSync(process.env.PM_CLAUDE_BIN)) return process.env.PM_CLAUDE_BIN;
  // PATH에서 먼저 찾고, 없으면 로그인 셸(zsh 등)의 PATH로 찾는다
  for (const dir of (process.env.PATH || "").split(":")) if (dir && fs.existsSync(path.join(dir, "claude"))) return path.join(dir, "claude");
  for (const shell of [process.env.SHELL, "/bin/sh"].filter(Boolean))
    try {
      const found = execFileSync(shell, ["-lic", "command -v claude"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 }).trim().split("\n").pop();
      if (found?.startsWith("/")) return found;
    } catch {}
  return null;
}

// 읽기 도구와 이 워크스페이스를 고치는 pm CLI만 허용한다. 나머지는 dontAsk 모드에서 자동으로 거절된다
export function deepTools(w) {
  return [
    `Bash(node ${PM_SCRIPT} *)`,
    "Bash(gh issue view *)",
    "Bash(gh issue list *)",
    "Bash(gh pr view *)",
    "Bash(gh pr list *)",
    "Bash(dig *)",
    "Read",
    "Grep",
    "Glob",
    "mcp__notion__notion-fetch",
    "mcp__notion__notion-search",
    "mcp__notion__notion-get-comments",
    ...(w.config.update?.allowedTools || []),
  ];
}

// 전체 업데이트에 필요한 것: Claude Code(로그인), Notion 연결, GitHub 로그인. 빠진 것과 채우는 법을 돌려준다
export function deepCheck(w, { mcp = true } = {}) {
  const checks = [];
  const bin = claudeBin();
  let version = null;
  if (bin)
    try {
      version = sh(`"${bin}" --version`).trim();
    } catch {}
  checks.push(bin ? { name: "Claude Code", ok: true, detail: version || bin } : { name: "Claude Code", ok: false, detail: "claude 명령이 없습니다", fix: "Claude Code를 설치하고 터미널에서 claude를 한 번 실행해 로그인하세요 (https://claude.com/claude-code)" });
  if (bin && mcp) {
    let list = "";
    try {
      list = sh(`"${bin}" mcp list`, 90000);
    } catch (error) {
      list = String(error.stdout || "");
    }
    const line = list.split("\n").find((l) => /^notion\b/i.test(l.trim()));
    if (!line) checks.push({ name: "Notion 연결", ok: false, detail: "Claude Code에 notion MCP가 없습니다", fix: "claude mcp add --scope user --transport http notion https://mcp.notion.com/mcp → claude 실행 → /mcp에서 notion 인증 (특정 폴더에만 등록돼 있으면 PM 워크스페이스에서 안 보입니다)" });
    else if (/connected|✓/i.test(line) && !/fail|needs|error|✗/i.test(line)) checks.push({ name: "Notion 연결", ok: true, detail: "연결됨" });
    else checks.push({ name: "Notion 연결", ok: false, detail: line.trim().slice(0, 120), fix: "claude 실행 → /mcp → notion을 골라 다시 인증" });
  }
  // 업데이트가 실제로 쓰는 것(GITHUB_TOKEN 또는 gh의 토큰)이 있는지 본다
  let gh = !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
  if (!gh)
    try {
      gh = !!sh("gh auth token").trim();
    } catch {}
  checks.push(gh ? { name: "GitHub 로그인", ok: true, detail: "gh 로그인됨" } : { name: "GitHub 로그인", ok: false, detail: "gh가 없거나 로그인 전", fix: "gh auth login" });
  for (const id of w.ids()) {
    const p = w.load(id);
    if (p.sample) continue;
    const notion = p.channels?.notion?.url || (p.resources || []).some((r) => /notion\./.test(r.url || ""));
    if (!notion) checks.push({ name: `${id} 원본`, ok: false, warn: true, detail: "고객 소통(Notion) 링크가 없습니다", fix: `project.json의 channels.notion.url에 고객 요청 DB 링크를 넣으세요` });
  }
  return { ok: checks.every((c) => c.ok || c.warn), checks };
}

function deepPrompt(w, id) {
  const p = w.load(id);
  const last = readUpdate(w, id)?.history?.find((h) => h.mode === "deep" && h.ok)?.at;
  const sources = [
    p.channels?.notion?.url && `고객 소통(Notion 요청 DB): ${p.channels.notion.url}`,
    p.github?.repo && `GitHub 저장소: ${p.github.repo}`,
    ...(p.resources || []).filter((r) => /notion\./.test(r.url || "")).map((r) => `${r.name}: ${r.url}`),
  ].filter(Boolean);
  return `PM 대시보드 자동 업데이트(전체)다. 사람이 보고 있지 않으니 아무것도 묻지 말고 끝까지 한 뒤, 마지막에 아래 형식의 JSON 블록 하나만 출력한다.

대상: ${p.name} (id ${id}, 고객사 ${p.client || "-"})
CLI: node ${PM_SCRIPT} <명령> --workspace ${w.dir} --project ${id}
지난 전체 업데이트: ${last || "없음"} · 오늘 ${today()}
원본:
${[...new Set(sources)].map((s) => `- ${s}`).join("\n") || "- (등록된 원본 없음)"}

할 일
1. \`refresh --json\`으로 다시 확인할 항목을, \`list --json\`으로 전체 항목(fields, note, internal, res, checkedAt)을, \`decision --json\`·\`risk --json\`으로 결정 필요와 위험(기한, 확인일)을 본다.
2. 원본을 읽기만 한다.
   - GitHub: \`gh issue view <번호> -R <저장소> --comments\`. 항목의 마지막 확인일 뒤 코멘트, 특히 '## Decision'·'## 결정'.
   - Notion: 고객 소통 페이지와 항목의 res.url을 notion-fetch로 읽는다. 고객사 답은 노란 배경과 댓글(notion-get-comments)이다. 지난 전체 업데이트 뒤 새로 생긴 답을 찾아 해당 항목에 반영한다.
   - 도메인처럼 직접 확인할 수 있는 것은 dig로 본다.
   - 항목이 많으면 마지막 확인일이 오래된 것과 GitHub 이슈가 바뀐 것부터 30개까지만 본다.
3. 반영은 CLI로만 한다.
   - 값이 바뀌었으면 \`answer <item> "라벨=값" --src "<출처>"\` 또는 \`set <item> --status <s> --note "<결론>" --internal "<내부 메모>" --src "<출처>"\`.
   - 그대로면 \`check <item...> --src "<출처>"\`.
   - 원본에서 확인하지 못한 값은 '없음'으로 바꾸지 말고 \`check <item> --guess --src "<찾아본 곳>"\`로 두고 asks에 질문을 넣는다. 기록이 없다고 없는 것이 아니다.
   - 결정 필요·위험은 \`decision\`·\`risk\` 명령으로만 고친다(번호는 \`decision --json\`의 n). 기한은 날짜(YYYY-MM-DD)로 쓴다. '오늘'·'이번 주'처럼 원본에 적힌 말은 그 글이 쓰인 날 기준 날짜로 바꿔 \`--due\`에 넣는다. 그대로면 \`decision check <번호> --src "<출처>"\`, 기한·권장안이 바뀌었으면 \`decision set <번호> --due YYYY-MM-DD --src "<출처>"\`. 원본에서 이미 결정된 것으로 보이면 지우지 말고(\`done\` 금지) asks에 "○○로 결정됐나요?"를 넣는다.
4. 지킬 것
   - GitHub·Notion·메일 등 원본에는 아무것도 쓰지 않는다. 허용되지 않은 도구는 쓰지 않는다.
   - 비밀번호, API 키, 토큰, 개인 전화번호·이메일은 기록하지 않는다. 원본에 있으면 "받음(원본에 있음)"으로만 쓴다.
   - note·fields·need·proposal은 고객사도 보는 글이다. 결론만 쉬운 말로 쓰고 이슈 번호·사람 이름·코드 용어는 internal에만 쓴다.
   - 근거가 약하면 바꾸지 않는다. 확정(confirmed)은 원본에 확정 근거가 있을 때만.
5. 마지막 출력(이것만):
\`\`\`json
{"summary": "무엇이 바뀌었는지 한두 문장", "changed": [{"id": "항목 id", "what": "바뀐 것 한 줄"}], "asks": [{"id": "항목 id", "question": "PM이 답할 질문 한 줄"}]}
\`\`\``;
}

function runClaude(w, id, log) {
  const bin = claudeBin();
  if (!bin) return Promise.resolve({ ok: false, error: "claude 명령을 찾지 못했습니다(pm doctor로 확인)" });
  const args = [
    "-p",
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    ...(w.config.update?.model ? ["--model", w.config.update.model] : []),
    ...(w.config.update?.maxBudgetUsd ? ["--max-budget-usd", String(w.config.update.maxBudgetUsd)] : []),
    "--disallowedTools",
    "Edit",
    "Write",
    "NotebookEdit",
    "WebFetch",
    "WebSearch",
    // --allowedTools·--disallowedTools는 값을 여러 개 받아 뒤의 인자를 삼키므로 프롬프트는 stdin으로 넘긴다
    "--allowedTools",
    ...deepTools(w),
  ];
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: w.dir, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), DEEP_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `claude 실행 실패: ${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      log(`${id}: claude 종료 코드 ${code}`);
      let text = out;
      let cost = null;
      try {
        const parsed = JSON.parse(out);
        text = String(parsed.result || "");
        cost = parsed.total_cost_usd ?? null;
        if (parsed.is_error) return resolve({ ok: false, error: text.slice(0, 300) || "claude 오류", cost });
      } catch {}
      const block = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].at(-1)?.[1];
      let data = null;
      try {
        data = JSON.parse(block || text);
      } catch {}
      if (!data) return resolve({ ok: false, error: (code === 0 ? "결과 JSON을 읽지 못했습니다" : err || text || `종료 코드 ${code}`).trim().slice(-300), cost });
      resolve({
        ok: true,
        summary: String(data.summary || "").slice(0, 500),
        changed: (Array.isArray(data.changed) ? data.changed : []).slice(0, 50).map((c) => ({ id: String(c.id || ""), what: String(c.what || "").slice(0, 200) })),
        asks: (Array.isArray(data.asks) ? data.asks : []).slice(0, 30).map((a) => ({ id: String(a.id || ""), question: String(a.question || "").slice(0, 300) })),
        cost,
      });
    });
    child.stdin.end(deepPrompt(w, id));
  });
}

// ---------------------------------------------------------------- 실행

export async function runUpdate(w, ids, { trigger = "manual", offline = false, deep = false, log = () => {} } = {}) {
  const busy = runningUpdate(w);
  if (busy) return { busy };
  fs.writeFileSync(lockFile(w), JSON.stringify({ pid: process.pid, at: new Date().toISOString(), ids, trigger, mode: deep ? "deep" : "quick" }));
  const results = [];
  try {
    for (const id of ids) {
      const started = Date.now();
      const steps = [];
      const project = w.load(id);
      if (project.github?.repo && !offline) {
        try {
          const snap = await sync(project.github.repo, w.githubFile(id));
          steps.push({ key: "github", name: "GitHub 이슈", ok: true, detail: `이슈 ${snap.issues.length}개 · 마일스톤 ${snap.milestones.length}개` });
        } catch (error) {
          steps.push({ key: "github", name: "GitHub 이슈", ok: false, detail: String(error.message).slice(0, 200) });
        }
      }
      let report = await refreshReport(w, id, { offline });
      steps.push({ key: "recheck", name: "다시 확인할 값", ok: !report.githubFailed, detail: report.githubNote });
      let deepResult = null;
      if (deep && !project.sample) {
        log(`${id}: 전체 업데이트(Claude) 시작`);
        deepResult = await runClaude(w, id, log);
        steps.push({ key: "deep", name: "원본 확인(Claude)", ok: deepResult.ok, detail: deepResult.ok ? `바뀐 값 ${deepResult.changed.length}개 · 물어볼 것 ${deepResult.asks.length}개` : deepResult.error });
        report = await refreshReport(w, id, { offline });
      }
      const c = report.counts;
      const result = {
        at: new Date().toISOString(),
        mode: deepResult ? "deep" : "quick",
        trigger,
        ok: steps.every((s) => s.ok),
        durationSec: Math.round((Date.now() - started) / 1000),
        steps,
        recheck: c,
        recheckItems: report.picked.slice(0, 40).map((r) => ({
          id: r.item.id,
          title: r.item.title,
          kind: report.kind(r),
          github: r.changed.map((x) => `${x.repo === report.repo ? "" : x.repo}#${x.n} ${x.state === "closed" ? "닫힘" : "갱신"} ${F.monthDay(x.closed || x.updated)}`),
        })),
        summary: deepResult?.ok && deepResult.summary ? deepResult.summary : c.total ? `다시 확인할 값 ${c.total}개 (추정 ${c.guess} · 확인 뒤 GitHub 이슈가 바뀜 ${c.moved} · 오래됨 ${c.stale})` : "다시 확인할 값 없음",
        changed: deepResult?.changed || [],
        asks: deepResult?.asks || [],
        cost: deepResult?.cost ?? null,
        error: steps.find((s) => !s.ok)?.detail || null,
      };
      recordUpdate(w, id, result);
      results.push({ id, ...result });
      log(`${id}: ${result.ok ? "끝" : "일부 실패"} · ${result.summary}`);
    }
  } finally {
    fs.rmSync(lockFile(w), { force: true });
  }
  return { results };
}
