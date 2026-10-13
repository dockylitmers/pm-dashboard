/**
 * PM 워크스페이스: 모든 프로젝트의 PM 데이터를 담는 폴더(보통 PM이 만든 비공개 GitHub 저장소를 내려받은 곳).
 *   pm-workspace.json            워크스페이스 표시와 공통 설정(회사 이름 등)
 *   projects/<id>/project.json   프로젝트 원본
 *   projects/<id>/github.json    이슈 스냅샷 (pm sync, git에 올리지 않음)
 *   projects/<id>/docs/          요청 목록·킥오프 자료·주간 보고 초안
 *
 * 어느 워크스페이스를 쓸지: --workspace → PM_DASHBOARD_HOME → 지금 폴더(또는 상위)의 pm-workspace.json
 *   → `pm setup`이 등록한 워크스페이스 → 예전 기본 위치 ~/.pm-dashboard
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson, run, UsageError, writeJson } from "./common.mjs";

export const MARKER = "pm-workspace.json";
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "pm-dashboard");
export const GLOBAL_CONFIG = path.join(CONFIG_DIR, "config.json");
export const LEGACY_HOME = path.join(os.homedir(), ".pm-dashboard");

function findUp(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function registered() {
  try {
    return readJson(GLOBAL_CONFIG).workspace || null;
  } catch {
    return null;
  }
}

export function register(dir) {
  const current = fs.existsSync(GLOBAL_CONFIG) ? readJson(GLOBAL_CONFIG) : {};
  writeJson(GLOBAL_CONFIG, { ...current, workspace: dir });
}

export function locate(args = {}) {
  if (typeof args.workspace === "string") return { dir: path.resolve(args.workspace), source: "--workspace" };
  if (process.env.PM_DASHBOARD_HOME) return { dir: path.resolve(process.env.PM_DASHBOARD_HOME), source: "PM_DASHBOARD_HOME" };
  const up = findUp(process.cwd());
  if (up) return { dir: up, source: "지금 폴더" };
  const reg = registered();
  if (reg && fs.existsSync(path.join(reg, MARKER))) return { dir: reg, source: "등록된 워크스페이스" };
  if (fs.existsSync(path.join(LEGACY_HOME, "projects"))) return { dir: LEGACY_HOME, source: "기본 위치(~/.pm-dashboard)" };
  return null;
}

export class Workspace {
  constructor(dir, source) {
    this.dir = dir;
    this.source = source;
  }

  static open(args) {
    const found = locate(args);
    if (!found) throw new UsageError("PM 워크스페이스가 없습니다. PM 데이터를 둘 저장소를 내려받은 폴더에서 `pm setup`을 실행하세요.");
    return new Workspace(found.dir, found.source);
  }

  get config() {
    const marker = path.join(this.dir, MARKER);
    const legacy = path.join(this.dir, "config.json");
    const data = fs.existsSync(marker) ? readJson(marker) : fs.existsSync(legacy) ? readJson(legacy) : {};
    return { company: "우리 회사", ...data };
  }

  setConfig(patch) {
    const marker = path.join(this.dir, MARKER);
    const file = fs.existsSync(marker) ? marker : path.join(this.dir, "config.json");
    writeJson(file, { ...(fs.existsSync(file) ? readJson(file) : {}), ...patch });
  }

  projectDir(id) {
    return path.join(this.dir, "projects", id);
  }
  projectFile(id) {
    return path.join(this.projectDir(id), "project.json");
  }
  githubFile(id) {
    return path.join(this.projectDir(id), "github.json");
  }
  docsDir(id) {
    return path.join(this.projectDir(id), "docs");
  }

  ids() {
    const dir = path.join(this.dir, "projects");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((id) => fs.existsSync(this.projectFile(id)))
      .sort();
  }

  load(id) {
    if (!fs.existsSync(this.projectFile(id))) throw new UsageError(`프로젝트 ${id}가 없습니다. pm projects로 확인하세요.`);
    return readJson(this.projectFile(id));
  }

  save(id, project) {
    writeJson(this.projectFile(id), project);
  }

  github(id) {
    return fs.existsSync(this.githubFile(id)) ? readJson(this.githubFile(id)) : null;
  }

  saveDoc(id, name, text) {
    const file = path.join(this.docsDir(id), name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
    return file;
  }

  // --project가 없으면 지금 폴더의 git 저장소와 연결된 프로젝트, 하나뿐이면 그 프로젝트
  resolveId(args, remoteRepo) {
    if (typeof args.project === "string") return args.project;
    const ids = this.ids();
    if (!ids.length) throw new UsageError("등록된 프로젝트가 없습니다. pm init <id>로 만드세요.");
    const repo = remoteRepo?.toLowerCase();
    if (repo) {
      const matched = ids.filter((id) => {
        const p = this.load(id);
        return [p.github?.repo, ...(p.repos || [])].some((r) => r?.toLowerCase() === repo);
      });
      if (matched.length === 1) return matched[0];
    }
    if (ids.length === 1) return ids[0];
    throw new UsageError(`어느 프로젝트인지 모르겠습니다. --project <id>를 붙이세요: ${ids.join(", ")}`);
  }
}

const GITIGNORE = `# pm-dashboard 워크스페이스
build/
projects/*/github.json
projects/*/update.json
.pm-logs/
.pm-update.lock
*.tmp
.DS_Store
`;

const README = (company) => `# PM 워크스페이스

${company}의 외주 개발 프로젝트 PM 데이터입니다. [pm-dashboard](https://github.com/litmers-dev/pm-dashboard) 플러그인이 읽고 씁니다.

**이 저장소는 비공개로 둡니다.** 고객사 정보와 내부 메모가 들어 있습니다. 비밀번호·API 키·고객 개인정보는 넣지 않습니다.

## 쓰는 법

Claude Code에서 말하면 됩니다.

- "새 프로젝트 등록해 줘. 고객사는 ○○, 앱·관리자·결제·카카오 로그인, 개발 10/26~12/18, 출시 1/15"
- "오늘 뭐부터 해?" · "고객사에 보낼 요청 목록 만들어 줘" · "킥오프 회의 자료 만들어 줘"
- "계약서 점검하자" · "이번 주 진행상황 보고 써 줘" · "대시보드 열어 줘"

## 구조

\`\`\`
pm-workspace.json            공통 설정 (company: 회사 이름)
projects/<id>/project.json   일정·범위·체크리스트·계약·결정·위험
projects/<id>/docs/          요청 목록, 킥오프 자료, 주간 보고 초안
projects/<id>/github.json    이슈 스냅샷 (pm sync, git 제외)
\`\`\`

변경을 다른 PC와 맞추려면 평소처럼 commit·push·pull 합니다.
`;

// pm setup: 지금 폴더(보통 방금 내려받은 PM 저장소)를 워크스페이스로 만든다
export function setup(dir, { company, importFrom } = {}) {
  fs.mkdirSync(path.join(dir, "projects"), { recursive: true });
  const marker = path.join(dir, MARKER);
  const existed = fs.existsSync(marker);
  const current = existed ? readJson(marker) : { version: 1, createdAt: new Date().toISOString() };
  writeJson(marker, { ...current, company: company || current.company || "우리 회사" });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, GITIGNORE);
  else {
    // 새 버전에서 늘어난 제외 항목만 덧붙인다
    const have = new Set(fs.readFileSync(ignore, "utf8").split("\n").map((l) => l.trim()));
    const missing = GITIGNORE.split("\n").filter((l) => l && !l.startsWith("#") && !have.has(l));
    if (missing.length) fs.appendFileSync(ignore, `${fs.readFileSync(ignore, "utf8").endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
  }
  const readme = path.join(dir, "README.md");
  if (!fs.existsSync(readme) || fs.readFileSync(readme, "utf8").trim().split("\n").length <= 3) fs.writeFileSync(readme, README(company || current.company || "우리 회사"));
  const keep = path.join(dir, "projects", ".gitkeep");
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, "");

  const imported = [];
  if (importFrom) {
    const source = path.join(path.resolve(importFrom), "projects");
    if (!fs.existsSync(source)) throw new UsageError(`${source}에 프로젝트가 없습니다`);
    for (const id of fs.readdirSync(source)) {
      const from = path.join(source, id, "project.json");
      if (!fs.existsSync(from)) continue;
      const to = path.join(dir, "projects", id);
      if (fs.existsSync(path.join(to, "project.json"))) continue;
      fs.mkdirSync(to, { recursive: true });
      for (const file of ["project.json", "github.json"]) if (fs.existsSync(path.join(source, id, file))) fs.copyFileSync(path.join(source, id, file), path.join(to, file));
      imported.push(id);
    }
  }
  register(dir);

  // 원격 저장소가 공개면 경고한다(고객 정보가 들어가므로)
  let remote = null;
  let visibility = null;
  try {
    remote = run("git", ["remote", "get-url", "origin"], { cwd: dir });
    const repo = remote.match(/github[^:/]*[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
    if (repo) visibility = run("gh", ["repo", "view", repo, "--json", "visibility", "--jq", ".visibility"]);
  } catch {
    // git이나 gh가 없으면 넘어간다
  }
  let isGit = true;
  try {
    run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir });
  } catch {
    isGit = false;
  }
  return { existed, imported, remote, visibility, isGit };
}
