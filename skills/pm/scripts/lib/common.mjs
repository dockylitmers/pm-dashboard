// pm CLI 모듈들이 같이 쓰는 경로·입출력·공통 모듈
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(here, "..", "..");
export const APP_DIR = path.join(SKILL_DIR, "app");
export const TEMPLATE_DIR = path.join(SKILL_DIR, "templates");

const require = createRequire(import.meta.url);
export const F = require(path.join(APP_DIR, "js", "forecast.js"));
export const Core = require(path.join(APP_DIR, "js", "core.js"));
export const Docs = require(path.join(APP_DIR, "js", "docs.js"));

export const BALLS = ["client", "us", "dev"];
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const today = () => F.kstDate(new Date());

export class UsageError extends Error {}

export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
export const template = (name) => readJson(path.join(TEMPLATE_DIR, name));

export function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...options }).trim();
}

export function gitRemoteRepo(cwd = process.cwd()) {
  try {
    const url = run("git", ["remote", "get-url", "origin"], { cwd });
    const match = url.match(/github[^:/]*[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function openFile(target) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

// 터미널 폭 계산(한글은 두 칸)
export const pad = (text, width) => {
  const str = String(text ?? "");
  const visible = [...str].reduce((w, ch) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);
  return str + " ".repeat(Math.max(0, width - visible));
};
export const fmt = (n) => (n == null || Number.isNaN(n) ? "-" : Math.round(n).toLocaleString("ko-KR"));

export function parseDate(value, flag) {
  const v = value === "today" ? today() : value;
  if (!DATE_RE.test(v || "")) throw new UsageError(`--${flag}는 YYYY-MM-DD 또는 today`);
  return v;
}

// 같은 옵션을 여러 번 쓰면 배열로 모은다
export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const [key, inline] = token.slice(2).split(/=(.*)/s);
    let value;
    if (inline !== undefined) value = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) value = argv[++i];
    else value = true;
    if (key in args && key !== "_") args[key] = [].concat(args[key], value);
    else args[key] = value;
  }
  return args;
}
export const list = (value) =>
  value === undefined || value === true
    ? []
    : []
        .concat(value)
        .flatMap((v) => String(v).split(","))
        .map((v) => v.trim())
        .filter(Boolean);
