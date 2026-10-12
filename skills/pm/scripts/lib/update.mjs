/**
 * 업데이트: 대시보드가 실제 업무 상황을 반영하도록 원본을 다시 읽는다.
 * - GitHub 이슈 스냅샷(pm sync)을 새로 받고
 * - 다시 확인할 값(추정 · 오래됨 · 확인 뒤 연결된 GitHub 이슈가 바뀜)을 계산해
 * - projects/<id>/update.json(마지막 결과와 기록)에 남긴다. 대시보드 '업데이트' 창이 이것을 보여 준다.
 * 원본(GitHub·Notion)에는 쓰지 않는다. 바뀐 값을 읽고 반영하는 일은 사람이 Claude와 함께 한다(SKILL.md '최신화').
 */
import fs from "node:fs";
import path from "node:path";
import { Core, F, readJson, SKILL_DIR, today, writeJson } from "./common.mjs";
import { issueStates, sync } from "./github.mjs";

export const PM_SCRIPT = path.join(SKILL_DIR, "scripts", "pm.mjs");
const HISTORY_LIMIT = 30;
const LOCK_STALE_MS = 30 * 60 * 1000;

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
function recordUpdate(w, id, result) {
  const previous = readUpdate(w, id) || {};
  const line = { at: result.at, trigger: result.trigger, ok: result.ok, summary: result.summary };
  writeJson(updateFile(w, id), { last: result, history: [line, ...(previous.history || [])].slice(0, HISTORY_LIMIT) });
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

// ---------------------------------------------------------------- 실행

export async function runUpdate(w, ids, { trigger = "manual", offline = false, log = () => {} } = {}) {
  const busy = runningUpdate(w);
  if (busy) return { busy };
  fs.writeFileSync(lockFile(w), JSON.stringify({ pid: process.pid, at: new Date().toISOString(), ids, trigger }));
  const results = [];
  try {
    for (const id of ids) {
      const started = Date.now();
      const steps = [];
      const project = w.load(id);
      if (project.github?.repo && !offline) {
        try {
          const snap = await sync(project.github.repo, w.githubFile(id));
          steps.push({ name: "GitHub 이슈", ok: true, detail: `이슈 ${snap.issues.length}개 · 마일스톤 ${snap.milestones.length}개` });
        } catch (error) {
          steps.push({ name: "GitHub 이슈", ok: false, detail: String(error.message).slice(0, 200) });
        }
      }
      const report = await refreshReport(w, id, { offline });
      steps.push({ name: "다시 확인할 값", ok: !report.githubFailed, detail: report.githubNote });
      const c = report.counts;
      const result = {
        at: new Date().toISOString(),
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
        summary: c.total ? `다시 확인할 값 ${c.total}개 (추정 ${c.guess} · 확인 뒤 GitHub 이슈가 바뀜 ${c.moved} · 오래됨 ${c.stale})` : "다시 확인할 값 없음",
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
