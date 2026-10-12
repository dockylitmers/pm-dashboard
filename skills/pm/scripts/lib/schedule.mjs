/**
 * 자동 업데이트(pm schedule). macOS는 launchd 사용자 에이전트 두 개를 만든다.
 * - com.pm-dashboard.update: 매일 정해진 시각에 `pm update --all --trigger schedule`
 * - com.pm-dashboard.serve: 대시보드 서버(pm serve)를 로그인 동안 계속 켜 둔다
 * 플러그인은 버전마다 폴더가 바뀌므로, 실행할 때 가장 새 버전을 찾는 실행 스크립트를 거친다.
 * 다른 OS에서는 cron 줄을 보여 주기만 한다.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UsageError } from "./common.mjs";
import { logDir, PM_SCRIPT } from "./update.mjs";
import { GLOBAL_CONFIG } from "./workspace.mjs";

const UPDATE_LABEL = "com.pm-dashboard.update";
const SERVE_LABEL = "com.pm-dashboard.serve";
const agentsDir = () => path.join(os.homedir(), "Library", "LaunchAgents");
const plistPath = (label) => path.join(agentsDir(), `${label}.plist`);
const runnerPath = () => path.join(path.dirname(GLOBAL_CONFIG), "pm-run.sh");
const domain = () => `gui/${process.getuid()}`;

const xml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]);
function plist(dict) {
  const render = (value, indent) => {
    const pad = "  ".repeat(indent);
    if (Array.isArray(value)) return `${pad}<array>\n${value.map((v) => render(v, indent + 1)).join("\n")}\n${pad}</array>`;
    if (typeof value === "boolean") return `${pad}<${value}/>`;
    if (typeof value === "number") return `${pad}<integer>${value}</integer>`;
    if (value && typeof value === "object")
      return `${pad}<dict>\n${Object.entries(value)
        .map(([k, v]) => `${pad}  <key>${xml(k)}</key>\n${render(v, indent + 1)}`)
        .join("\n")}\n${pad}</dict>`;
    return `${pad}<string>${xml(value)}</string>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${render(dict, 0)}\n</plist>\n`;
}

const which = (cmd) => {
  try {
    return execFileSync("/bin/sh", ["-lc", `command -v ${cmd}`], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
};

// Homebrew Cellar 경로는 node를 올리면 사라지므로 셸의 node(링크 경로)를 먼저 쓴다
const nodeBin = () => which("node") || process.execPath;

// launchd는 PATH가 짧아서 node·gh가 있는 폴더를 넣어 준다
function launchPath() {
  const dirs = [path.dirname(nodeBin()), ...["gh", "git"].map(which).filter(Boolean).map((p) => path.dirname(p)), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return [...new Set(dirs)].join(":");
}

function writeRunner() {
  const cache = path.join(os.homedir(), ".claude", "plugins", "cache", "pm-dashboard", "pm-dashboard");
  const script = `#!/bin/bash
# pm-dashboard 자동 실행용. 설치된 플러그인 중 가장 새 버전의 pm을 쓴다
latest="$(ls -d "${cache}"/*/skills/pm/scripts/pm.mjs 2>/dev/null | sort -V | tail -1)"
exec "${nodeBin()}" "\${latest:-${PM_SCRIPT}}" "$@"
`;
  fs.mkdirSync(path.dirname(runnerPath()), { recursive: true });
  fs.writeFileSync(runnerPath(), script, { mode: 0o755 });
  return runnerPath();
}

const launchctl = (...args) => {
  try {
    execFileSync("launchctl", args, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};
const loaded = (label) => launchctl("print", `${domain()}/${label}`);
function load(label) {
  launchctl("bootout", `${domain()}/${label}`);
  if (!launchctl("bootstrap", domain(), plistPath(label))) throw new Error(`launchctl bootstrap 실패: ${plistPath(label)}`);
}

function parseTimes(times) {
  return times.map((t) => {
    const m = String(t).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new UsageError(`--times 형식은 HH:MM,HH:MM 입니다: ${t}`);
    return { Hour: Number(m[1]), Minute: Number(m[2]) };
  });
}
const hm = ({ Hour, Minute }) => `${String(Hour).padStart(2, "0")}:${String(Minute).padStart(2, "0")}`;

export function scheduleInstall(w, { times, serve = true, port = 4477 }) {
  const slots = parseTimes(times);
  const logs = logDir(w);
  // 분이 모두 같으면 한 줄(30 8,12,18 * * *), 다르면 시각마다 한 줄
  const cronTimes = new Set(slots.map((s) => s.Minute)).size === 1 ? [`${slots[0].Minute} ${slots.map((s) => s.Hour).join(",")} * * *`] : slots.map((s) => `${s.Minute} ${s.Hour} * * *`);
  if (process.platform !== "darwin") {
    return {
      lines: [
        "자동 등록은 macOS만 지원합니다. crontab -e에 아래 줄을 넣으세요.",
        ...cronTimes.map((when) => `${when} node ${PM_SCRIPT} update --all --trigger schedule --workspace ${w.dir} >> ${path.join(logs, "update.log")} 2>&1`),
        serve ? `대시보드 서버는 로그인할 때 실행되게 하세요: node ${PM_SCRIPT} serve --workspace ${w.dir} --port ${port}` : "",
      ].filter(Boolean),
    };
  }
  fs.mkdirSync(logs, { recursive: true });
  fs.mkdirSync(agentsDir(), { recursive: true });
  const runner = writeRunner();
  const env = { PATH: launchPath(), ...(process.env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME } : {}) };
  fs.writeFileSync(
    plistPath(UPDATE_LABEL),
    plist({
      Label: UPDATE_LABEL,
      ProgramArguments: ["/bin/bash", runner, "update", "--all", "--trigger", "schedule", "--workspace", w.dir],
      StartCalendarInterval: slots,
      EnvironmentVariables: env,
      WorkingDirectory: w.dir,
      StandardOutPath: path.join(logs, "update.log"),
      StandardErrorPath: path.join(logs, "update.log"),
    }),
  );
  load(UPDATE_LABEL);
  const lines = [`자동 업데이트를 켰습니다: 매일 ${slots.map(hm).join(" · ")} (pm update --all)`];
  if (serve) {
    fs.writeFileSync(
      plistPath(SERVE_LABEL),
      plist({
        Label: SERVE_LABEL,
        ProgramArguments: ["/bin/bash", runner, "serve", "--workspace", w.dir, "--port", String(port)],
        RunAtLoad: true,
        KeepAlive: true,
        EnvironmentVariables: env,
        WorkingDirectory: w.dir,
        StandardOutPath: path.join(logs, "serve.log"),
        StandardErrorPath: path.join(logs, "serve.log"),
      }),
    );
    load(SERVE_LABEL);
    lines.push(`대시보드 서버를 켜 두었습니다: http://127.0.0.1:${port}/ (로그인하면 자동으로 켜짐)`);
  }
  lines.push(`기록: ${logs}`, "Mac이 잠자기 중이면 그 시각은 건너뛰고 깨어난 뒤 한 번 실행됩니다. 끄려면 pm schedule remove");
  w.setConfig({ schedule: { times: slots.map(hm), serve: serve ? { port } : null, installedAt: new Date().toISOString() } });
  return { lines };
}

export function scheduleRemove(w) {
  const lines = [];
  for (const label of [UPDATE_LABEL, SERVE_LABEL]) {
    if (process.platform === "darwin") launchctl("bootout", `${domain()}/${label}`);
    if (fs.existsSync(plistPath(label))) {
      fs.rmSync(plistPath(label));
      lines.push(`껐습니다: ${label}`);
    }
  }
  w.setConfig({ schedule: null });
  return lines.length ? lines : ["켜져 있는 자동 업데이트가 없습니다."];
}

export function scheduleStatus(w) {
  const config = w.config.schedule || null;
  if (process.platform !== "darwin") return { installed: !!config, times: config?.times || [], loaded: null, serve: config?.serve || null, log: path.join(logDir(w), "update.log") };
  const installed = fs.existsSync(plistPath(UPDATE_LABEL));
  const servePlist = fs.existsSync(plistPath(SERVE_LABEL));
  let times = config?.times || [];
  if (installed && !times.length) {
    const text = fs.readFileSync(plistPath(UPDATE_LABEL), "utf8");
    const hours = [...text.matchAll(/<key>Hour<\/key>\s*<integer>(\d+)/g)].map((m) => Number(m[1]));
    const mins = [...text.matchAll(/<key>Minute<\/key>\s*<integer>(\d+)/g)].map((m) => Number(m[1]));
    times = hours.map((h, i) => hm({ Hour: h, Minute: mins[i] ?? 0 }));
  }
  return {
    installed,
    times,
    loaded: installed ? loaded(UPDATE_LABEL) : false,
    serve: servePlist ? { port: config?.serve?.port || 4477, loaded: loaded(SERVE_LABEL) } : null,
    log: path.join(logDir(w), "update.log"),
  };
}
