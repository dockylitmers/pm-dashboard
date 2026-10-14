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
// 모양(DATE_RE)뿐 아니라 달력에 있는 날짜인지까지 본다
export const isDate = (value) => Core.isDate(value);
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
  if (!isDate(v)) throw new UsageError(`--${flag}: 없는 날짜 ${v}`);
  return v;
}

// 기한: YYYY-MM-DD로 저장한다. '오늘'·'내일'·'모레'·'이번 주'(그 주 금요일)·'다음 주'(다음 주 금요일)·'10/16'·'10월 16일'·'+3'은
// 쓰는 날(오늘) 기준 날짜로 바꾼다. 주말(토·일)에는 이번 주가 끝났으므로 '이번 주'와 '다음 주' 모두 다가오는 주의 금요일이다.
export function parseDue(value, flag = "due", base = today()) {
  if (value === true || value === undefined || value === null || String(value).trim() === "")
    throw new UsageError(`--${flag}에 기한을 적으세요: YYYY-MM-DD, 10/16, 오늘, 내일, 모레, "이번 주", "다음 주", +3`);
  const v = String(value).trim().replace(/\s+/g, " ");
  if (DATE_RE.test(v)) {
    if (!isDate(v)) throw new UsageError(`--${flag}: 없는 날짜 ${v}`);
    return v;
  }
  const wd = F.weekdayOf(base);
  const weekend = wd === 0 || wd === 6;
  // 그 주(월~일)의 금요일. 주말이면 다가오는 주의 금요일
  const friday = F.addDays(base, (wd === 0 ? -2 : 5 - wd) + (weekend ? 7 : 0));
  const words = { 오늘: 0, today: 0, 내일: 1, tomorrow: 1, 모레: 2 };
  if (v in words) return F.addDays(base, words[v]);
  if (/^이번\s?주$|^this week$/i.test(v)) return friday;
  if (/^다음\s?주$|^next week$/i.test(v)) return weekend ? friday : F.addDays(friday, 7);
  let m = v.match(/^\+(\d{1,3})$|^(\d{1,3})일\s?(?:뒤|후)$/);
  if (m) return F.addDays(base, Number(m[1] || m[2]));
  m = v.match(/^(\d{1,2})\s*[/.월]\s*(\d{1,2})\s*일?$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    let date = `${base.slice(0, 4)}-${md}`;
    // 반년보다 더 지난 날짜면 내년으로 본다(12월에 '1/5'라고 쓴 경우)
    if (month >= 1 && month <= 12 && F.daysBetween(date, base) > 183) date = `${Number(base.slice(0, 4)) + 1}-${md}`;
    if (month < 1 || month > 12 || day < 1 || !isDate(date)) throw new UsageError(`--${flag}: 없는 날짜 ${v}`);
    return date;
  }
  throw new UsageError(`--${flag}는 YYYY-MM-DD, 10/16, 오늘, 내일, 모레, "이번 주", "다음 주", +3 중 하나 (받은 값: ${v || "없음"})`);
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
