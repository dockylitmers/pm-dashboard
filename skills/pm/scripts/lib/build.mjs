// 대시보드를 한 파일 HTML로 만든다. index.html의 <!-- PM:SCRIPTS --> 자리에 데이터와 스크립트를 넣는다
import fs from "node:fs";
import path from "node:path";
import { APP_DIR, Core, today } from "./common.mjs";
import { library } from "./library.mjs";

// <script> 안에 넣는 JSON. </script>나 줄 구분 문자가 스크립트를 끊지 않게 바꾼다
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");
const scriptJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATORS, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);

export const SCRIPTS = ["forecast.js", "core.js", "docs.js", "app.js", "agent.js"];

export function dashboardHtml(ws, { ids, server = false, client = false }) {
  const projects = {};
  const github = {};
  for (const id of ids) {
    const project = Core.normalize(ws.load(id), today());
    projects[id] = client ? Core.clientSafe(project) : project;
    const snapshot = project.github ? ws.github(id) : null;
    // 공유본에는 이슈 제목을 넣지 않는다(마일스톤 진행률만)
    if (snapshot) github[id] = client ? { ...snapshot, issues: [] } : snapshot;
  }
  const lib = library();
  const mode = { server, client, company: ws.config.company, builtAt: new Date().toISOString(), workspace: client ? null : ws.dir };
  const data = `<script>window.PM_MODE=${scriptJson(mode)};window.PM_LIBRARY=${scriptJson({ features: lib.features, categories: lib.categories })};window.PM_PROJECTS=${scriptJson(projects)};window.PM_GITHUB=${scriptJson(github)};</script>`;
  const scripts = [data, ...SCRIPTS.map((file) => `<script>\n${fs.readFileSync(path.join(APP_DIR, "js", file), "utf8")}\n</script>`)].join("\n");
  // replace의 두 번째 인자에 문자열을 주면 $& 같은 패턴이 해석되므로 함수로 넘긴다
  return fs.readFileSync(path.join(APP_DIR, "index.html"), "utf8").replace("<!-- PM:SCRIPTS -->", () => scripts);
}
