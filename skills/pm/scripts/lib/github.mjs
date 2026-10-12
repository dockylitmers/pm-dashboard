// GitHub: 이슈 스냅샷 받기(pm sync), 라벨·스프린트 마일스톤 만들기(pm setup-repo)
import fs from "node:fs";
import { F, run, UsageError } from "./common.mjs";

export function token() {
  const fromEnv = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    return run("gh", ["auth", "token"]);
  } catch {
    throw new UsageError("GitHub 토큰이 없습니다. gh auth login 하거나 GITHUB_TOKEN을 설정하세요.");
  }
}

async function call(auth, method, url, body) {
  const response = await fetch(url.startsWith("http") ? url : `https://api.github.com${url}`, {
    method,
    headers: { Authorization: `Bearer ${auth}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pm-dashboard" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`GitHub ${response.status} ${method} ${url}: ${(await response.text()).slice(0, 200)}`);
  return { data: await response.json(), next: response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null };
}

async function listAll(auth, apiPath) {
  const items = [];
  let next = `https://api.github.com${apiPath}${apiPath.includes("?") ? "&" : "?"}per_page=100`;
  for (let page = 0; next && page < 50; page += 1) {
    const result = await call(auth, "GET", next);
    items.push(...result.data);
    next = result.next;
  }
  return items;
}

export async function sync(repo, file) {
  const auth = token();
  const [milestones, issues] = await Promise.all([listAll(auth, `/repos/${repo}/milestones?state=all`), listAll(auth, `/repos/${repo}/issues?state=all`)]);
  // 키를 짧게 줄여 파일 크기를 줄인다. forecast.js의 normalizeIssues가 풀어서 쓴다
  const snapshot = {
    repo,
    syncedAt: new Date().toISOString(),
    milestones: milestones.map((m) => ({ number: m.number, title: m.title, state: m.state, due: m.due_on ? m.due_on.slice(0, 10) : null, open: m.open_issues, closed: m.closed_issues })),
    issues: issues
      .filter((i) => !i.pull_request)
      .map((i) => ({ n: i.number, t: i.title, s: i.state, r: i.state_reason ?? null, c: i.created_at, x: i.closed_at, m: i.milestone?.number ?? null, l: i.labels.map((l) => l.name), a: i.assignees.map((a) => a.login) })),
  };
  fs.writeFileSync(file, JSON.stringify(snapshot));
  return snapshot;
}

// 일정 예측이 읽는 규칙에 맞춘 라벨
export const LABELS = [
  { name: "epic", color: "5319e7", description: "기능 묶음. 일정 예측에서 뺀다" },
  { name: "descope", color: "cfd3d7", description: "범위에서 뺌. 일정 예측에서 뺀다" },
  { name: "bug", color: "d73a4a", description: "버그" },
  { name: "enhancement", color: "a2eeef", description: "기능" },
  { name: "확인요청", color: "fbca04", description: "고객사 확인이 필요함" },
  { name: "blocked", color: "b60205", description: "고객사·공급사 때문에 막힘" },
];

// 주 단위(월~금) 스프린트 'SP-01 · 10/26~10/30', 고객사 QA, 출시 마일스톤
export function plannedMilestones(dates) {
  const out = [];
  if (dates.devStart && dates.devEnd) {
    let monday = F.addDays(dates.devStart, -((F.weekdayOf(dates.devStart) + 6) % 7));
    for (let n = 1; monday <= dates.devEnd; n += 1, monday = F.addDays(monday, 7)) {
      const start = monday < dates.devStart ? dates.devStart : monday;
      const friday = F.addDays(monday, 4);
      const end = friday > dates.devEnd ? dates.devEnd : friday;
      out.push({ title: `SP-${String(n).padStart(2, "0")} · ${F.monthDay(start)}~${F.monthDay(end)}`, due: end, key: `SP-${String(n).padStart(2, "0")}` });
    }
  }
  if (dates.qaStart && dates.qaEnd) out.push({ title: `QA · ${F.monthDay(dates.qaStart)}~${F.monthDay(dates.qaEnd)} 고객사 QA`, due: dates.qaEnd, key: "QA" });
  if (dates.launch) out.push({ title: `R · ${F.monthDay(dates.launch)} 출시`, due: dates.launch, key: "R" });
  return out;
}

export async function setupRepo(repo, dates, { apply = false } = {}) {
  const auth = token();
  const [labels, milestones] = await Promise.all([listAll(auth, `/repos/${repo}/labels`), listAll(auth, `/repos/${repo}/milestones?state=all`)]);
  const haveLabel = new Set(labels.map((l) => l.name.toLowerCase()));
  const haveMilestone = (m) => milestones.some((x) => x.title === m.title || x.title.split(" ")[0] === m.key);
  const plan = {
    labels: LABELS.filter((l) => !haveLabel.has(l.name.toLowerCase())),
    milestones: plannedMilestones(dates).filter((m) => !haveMilestone(m)),
    existing: { labels: labels.length, milestones: milestones.length },
  };
  if (apply) {
    for (const label of plan.labels) await call(auth, "POST", `/repos/${repo}/labels`, label);
    for (const m of plan.milestones) await call(auth, "POST", `/repos/${repo}/milestones`, { title: m.title, due_on: `${m.due}T12:00:00Z` });
  }
  return plan;
}

// 이슈 여러 개의 현재 상태(pm refresh). refs: [{ repo, n }] → Map("owner/repo#n" → { state, reason, updated, closed, title, pr } | { error })
export async function issueStates(refs) {
  const auth = token();
  const out = new Map();
  const queue = [...refs];
  const worker = async () => {
    for (let ref = queue.shift(); ref; ref = queue.shift()) {
      const key = `${ref.repo}#${ref.n}`;
      try {
        const { data } = await call(auth, "GET", `/repos/${ref.repo}/issues/${ref.n}`);
        out.set(key, {
          state: data.state,
          reason: data.state_reason,
          updated: F.kstDate(new Date(data.updated_at)),
          closed: data.closed_at ? F.kstDate(new Date(data.closed_at)) : null,
          title: data.title,
          pr: !!data.pull_request,
        });
      } catch (error) {
        out.set(key, { error: String(error.message || error).slice(0, 120) });
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}
