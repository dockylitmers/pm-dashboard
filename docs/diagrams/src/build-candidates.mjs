// pm-dashboard 구조도 세 장의 Archify 후보 JSON을 만든다(한국어, 저장소 근거 포함)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const ts = process.argv[2];
const ko = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude/skills/archify/examples/locales/ko.json"), "utf8"));
// 상자의 근거 배지가 제품 용어 '출처'(값을 확인한 곳)와 겹치지 않게 '근거 코드'로 부른다
ko["viewer.passport.sourceMarker"] = "근거 코드";
const repository = { url: "https://github.com/litmers-dev/pm-dashboard.git", provider: "github", link_mode: "web", revision: process.argv[3] };
const meta = (title, output) => ({ title, locale: "ko", translations: ko, output, quality_profile: "showcase", repository });

const S = (p, line, end_line, label) => ({ path: p, ...(line ? { line } : {}), ...(end_line ? { end_line } : {}), ...(label ? { label } : {}) });


// 시퀀스 메시지에 y를 30px 간격으로 매기고, 구간(segment)과 활성 막대를 메시지 id로 계산한다
function layoutSequence(doc, groups, activations) {
  let y = 160;
  const segments = [];
  const messages = [];
  const at = {};
  for (const g of groups) {
    const start = y - 10;
    for (const m of g.messages) {
      messages.push({ ...m, y });
      at[m.id] = y;
      y += 28;
    }
    segments.push({ from: start, to: y - 18, label: g.label });
    y += 8;
  }
  doc.segments = segments;
  doc.messages = messages;
  doc.activations = activations.map(([participant, from, to, type]) => ({ participant, from: at[from] - 5, to: at[to] + 6, type }));
  // 참가자가 일곱이라 가로를 넉넉히, 세로는 마지막 메시지 아래 범례 자리까지
  doc.meta.viewBox = [1080, y + 84];
  return doc;
}

// ---------------------------------------------------------------- 1. 구성도
const archDir = `.archify/architecture-pm-dashboard-${ts}`;
const architecture = {
  schema_version: 1,
  diagram_type: "architecture",
  meta: meta("pm-dashboard 구성: 무엇이 어디에 있나", `${archDir}/pm-dashboard-structure.html`),
  components: [
    { id: "github", type: "external", label: "GitHub 개발 저장소", sublabel: "이 프로젝트 코드 · 이슈·마일스톤", pos: [600, 40], size: [210, 64], sources: [S("skills/pm/scripts/lib/github.mjs", 5, 13, "gh 토큰"), S("skills/pm/scripts/lib/github.mjs", 36, 40, "이슈 스냅샷")] },
    { id: "wsrepo", type: "external", label: "PM 비공개 GitHub 저장소", sublabel: "워크스페이스 백업·공유", pos: [900, 40], size: [210, 64], sources: [S("skills/pm/scripts/lib/workspace.mjs", 214, 218, "비공개 여부 확인")] },
    { id: "pm", type: "external", label: "PM", sublabel: "Claude에게 말로 시킨다", pos: [40, 230], size: [160, 64] },
    { id: "claude", type: "frontend", label: "Claude Code + pm 스킬", sublabel: "컴퓨터마다 한 번 설치", pos: [320, 226], size: [200, 72], tag: "사용자 범위 플러그인", sources: [S(".claude-plugin/plugin.json", 2, 2, "플러그인 이름"), S("skills/pm/SKILL.md", 5, 5, "pm CLI만 실행")] },
    { id: "cli", type: "backend", label: "pm CLI", sublabel: "pm.mjs · Node 18+", pos: [630, 226], size: [150, 72], sources: [S("skills/pm/scripts/pm.mjs", 396, 412, "pm sheet"), S("skills/pm/scripts/pm.mjs", 413, 420, "pm answer")] },
    { id: "ws", type: "database", label: "PM 워크스페이스", sublabel: "projects/<id>/project.json", pos: [900, 226], size: [210, 72], tag: "비공개 GitHub 저장소 1개", sources: [S("skills/pm/scripts/lib/workspace.mjs", 44, 53, "워크스페이스 찾기"), S("skills/pm/scripts/lib/workspace.mjs", 83, 85, "project.json 위치")] },
    { id: "mcp", type: "security", label: "Notion 연결 (MCP)", sublabel: "PM 계정 OAuth", pos: [320, 410], size: [200, 64], tag: "Claude Code 안", sources: [S("skills/pm/SKILL.md", 117, 117, "Notion 쓰기는 확인 뒤"), S("skills/pm/scripts/lib/update.mjs", 149, 151, "읽기 도구만 허용")] },
    { id: "launchd", type: "cloud", label: "자동 실행 (launchd)", sublabel: "08:30·12:30·18:30", pos: [630, 410], size: [150, 64], sources: [S("skills/pm/scripts/lib/schedule.mjs", 16, 17, "에이전트 둘"), S("skills/pm/scripts/lib/schedule.mjs", 102, 104, "pm schedule install")] },
    { id: "server", type: "backend", label: "대시보드 서버", sublabel: "pm serve · 127.0.0.1:4477", pos: [900, 410], size: [210, 64], sources: [S("skills/pm/scripts/lib/server.mjs", 53, 54, "로컬 전용"), S("skills/pm/scripts/lib/server.mjs", 74, 79, "업데이트 API")] },
    { id: "browser", type: "frontend", label: "대시보드 화면", sublabel: "브라우저 · 리미", pos: [1210, 410], size: [160, 64], sources: [S("skills/pm/app/index.html", 1, 6, "한 페이지 앱")] },
    { id: "client", type: "external", label: "고객사", sublabel: "요청 목록·공유본을 받음", pos: [40, 594], size: [160, 64], sources: [S("skills/pm/app/js/core.js", 464, 472, "공유본에서 빼는 것")] },
    { id: "notion", type: "external", label: "Notion 고객 요청 DB", sublabel: "분홍=제안 · 노랑=답", pos: [320, 594], size: [200, 64], sources: [S("skills/pm/references/data-model.md", 26, 26, "링크만 저장")] },
  ],
  boundaries: [{ kind: "region", label: "PM의 컴퓨터 — 플러그인은 컴퓨터마다 한 번, 워크스페이스는 기본 PM마다 하나", wraps: ["claude", "cli", "ws", "mcp", "launchd", "server", "browser"] }],
  connections: [
    { id: "pm-asks", from: "pm", to: "claude", label: "말로 시킴", variant: "emphasis" },
    { id: "run-pm", from: "claude", to: "cli", label: "pm 명령" },
    { id: "cli-ws", from: "cli", to: "ws", label: "읽기·쓰기" },
    { id: "cli-github", from: "cli", to: "github", label: "이슈 읽기 (gh 토큰)", fromSide: "top", toSide: "bottom" },
    { id: "claude-mcp", from: "claude", to: "mcp", label: "Notion 도구 호출", fromSide: "bottom", toSide: "top" },
    { id: "mcp-notion", from: "mcp", to: "notion", label: "읽기 · 확인 뒤 쓰기", variant: "security", fromSide: "bottom", toSide: "top" },
    { id: "launchd-cli", from: "launchd", to: "cli", label: "pm update --all [--deep]", variant: "dashed", fromSide: "top", toSide: "bottom" },
    { id: "ws-backup", from: "ws", to: "wsrepo", label: "'저장해 줘' → git push", variant: "dashed", fromSide: "top", toSide: "bottom" },
    { id: "launchd-server", from: "launchd", to: "server", label: "상시 켬", variant: "dashed" },
    { id: "server-ws", from: "server", to: "ws", label: "읽기·화면 저장", fromSide: "top", toSide: "bottom" },
    { id: "browser-server", from: "browser", to: "server", label: "HTTP" },
    { id: "client-notion", from: "client", to: "notion", label: "노랑으로 답" },
    { id: "pm-client", from: "pm", to: "client", label: "링크·공유본 전달", variant: "dashed", fromSide: "bottom", toSide: "top" },
  ],
  cards: [
    { dot: "cyan", title: "설치 범위", items: ["플러그인은 컴퓨터마다 한 번(사용자 단위). 어느 폴더에서든 쓰인다", "개발 저장소마다 설치하지 않고, 거기에 파일도 만들지 않는다", "PM 워크스페이스는 기본 PM 한 사람당 하나, 그 안에 프로젝트 여러 개"] },
    { dot: "violet", title: "Notion 연결", items: ["pm CLI는 Notion에 직접 접속하지 않는다", "Claude Code의 Notion MCP에 PM 본인 계정으로 한 번 로그인", "프로젝트에는 요청 DB 링크만 저장, 토큰은 저장하지 않는다", "Notion에 쓰는 것은 PM이 내용·위치를 확인한 뒤에만"] },
    { dot: "emerald", title: "GitHub 연결", items: ["gh 로그인 토큰으로 이슈·마일스톤을 읽는다", "쓰기는 pm setup-repo --apply(라벨·스프린트)뿐, 확인 뒤"] },
  ],
};

// ---------------------------------------------------------------- 2. Notion 연결
const notionDir = `.archify/sequence-notion-connection-${ts}`;
const notion = {
  schema_version: 1,
  diagram_type: "sequence",
  meta: { ...meta("Notion 연결: 요청을 올리고 답을 받는 법", `${notionDir}/notion-connection.html`), column_fit: "spread", viewBox: [1180, 700] },
  participants: [
    { id: "pm", type: "external", label: "PM" },
    { id: "claude", type: "frontend", label: "Claude Code", sublabel: "pm 스킬", sources: [S("skills/pm/SKILL.md", 117, 117, "확인 뒤 올리기")] },
    { id: "cli", type: "backend", label: "pm CLI", sources: [S("skills/pm/scripts/pm.mjs", 396, 412, "pm sheet")] },
    { id: "ws", type: "database", label: "워크스페이스", sublabel: "project.json", sources: [S("skills/pm/references/data-model.md", 26, 26, "Notion 링크")] },
    { id: "mcp", type: "security", label: "Notion MCP", sublabel: "PM 계정 OAuth", sources: [S("skills/pm/scripts/lib/update.mjs", 149, 151, "읽기 도구")] },
    { id: "notion", type: "external", label: "Notion 요청 DB" },
    { id: "client", type: "external", label: "고객사" },
  ],
  cards: [
    { dot: "violet", title: "누가 Notion에 접속하나", items: ["pm CLI에는 Notion 코드가 없다. Claude Code의 Notion MCP가 접속한다", "MCP는 PM 본인 Notion 계정으로 OAuth 로그인. 사용자 단위(--scope user)로 한 번 등록(pm doctor가 점검)", "워크스페이스에는 요청 DB 링크(channels.notion.url)만 있고 토큰은 없다"] },
    { dot: "rose", title: "쓰기와 읽기", items: ["Notion에 쓰기(페이지 만들기)는 PM이 내용·위치를 확인한 뒤에만", "전체 업데이트의 Claude는 fetch·search·댓글 읽기만 허용, 쓰기 도구는 거절된다", "계정 비밀번호·키는 옮기지 않고 권한 초대로 바꾸자고 안내한다"] },
  ],
};

layoutSequence(
  notion,
  [
    {
      label: "요청 올리기",
      messages: [
        { id: "ask-upload", from: "pm", to: "claude", label: "요청 목록 Notion에 올려 줘", variant: "emphasis" },
        { id: "run-sheet", from: "claude", to: "cli", label: "pm sheet --format notion" },
        { id: "read-project", from: "cli", to: "ws", label: "범위·항목·제안값 읽기" },
        { id: "preview", from: "claude", to: "pm", label: "내용·올릴 위치 미리 보기", variant: "return" },
        { id: "approve", from: "pm", to: "claude", label: "확인 (승인)", variant: "security" },
        { id: "create-page", from: "claude", to: "mcp", label: "notion-create-pages", variant: "emphasis" },
        { id: "write-notion", from: "mcp", to: "notion", label: "PM 권한으로 페이지 작성", variant: "security" },
        { id: "send-link", from: "pm", to: "client", label: "페이지 링크 전달 (PM이 직접)", variant: "emphasis" },
        { id: "said-sent", from: "pm", to: "claude", label: "\"보냈어\"" },
        { id: "mark-sent", from: "claude", to: "cli", label: "pm sheet --mark-sent → 요청함" },
      ],
    },
    { label: "고객사가 답함", messages: [{ id: "client-answers", from: "client", to: "notion", label: "노란 배경으로 답·댓글", variant: "emphasis" }] },
    {
      label: "답 받기 (대화 또는 전체 업데이트)",
      messages: [
        { id: "fetch", from: "claude", to: "mcp", label: "notion-fetch · 댓글 읽기" },
        { id: "read-notion", from: "mcp", to: "notion", label: "노랑 답·댓글 가져오기 (읽기만)", variant: "security" },
        { id: "record", from: "claude", to: "cli", label: "pm answer <항목> \"라벨=값\" --src Notion" },
        { id: "write-ws", from: "cli", to: "ws", label: "답·확인일·출처 기록" },
      ],
    },
  ],
  [
    ["claude", "ask-upload", "create-page", "frontend"],
    ["cli", "run-sheet", "read-project", "backend"],
    ["mcp", "create-page", "write-notion", "security"],
    ["mcp", "fetch", "read-notion", "security"],
    ["cli", "record", "write-ws", "backend"],
  ],
);

// ---------------------------------------------------------------- 3. 업데이트
const updDir = `.archify/sequence-update-flow-${ts}`;
const update = {
  schema_version: 1,
  diagram_type: "sequence",
  meta: { ...meta("업데이트: 대시보드를 실제와 맞추는 법", `${updDir}/update-flow.html`), column_fit: "spread", viewBox: [1180, 680] },
  participants: [
    { id: "trigger", type: "cloud", label: "자동·버튼", sublabel: "launchd · 대시보드", sources: [S("skills/pm/scripts/lib/schedule.mjs", 102, 104, "하루 세 번"), S("skills/pm/scripts/lib/server.mjs", 79, 81, "업데이트 버튼")] },
    { id: "cli", type: "backend", label: "pm update", sources: [S("skills/pm/scripts/lib/update.mjs", 296, 300, "실행 순서")] },
    { id: "github", type: "external", label: "GitHub", sublabel: "고객사 저장소", sources: [S("skills/pm/scripts/lib/github.mjs", 36, 40, "스냅샷"), S("skills/pm/scripts/lib/github.mjs", 97, 99, "이슈 상태")] },
    { id: "ws", type: "database", label: "워크스페이스", sublabel: "project.json 등", sources: [S("skills/pm/scripts/lib/update.mjs", 97, 101, "update.json 기록")] },
    { id: "claude", type: "frontend", label: "Claude", sublabel: "전체 업데이트만", sources: [S("skills/pm/scripts/lib/update.mjs", 232, 246, "claude -p · dontAsk")] },
    { id: "notion", type: "external", label: "Notion", sublabel: "MCP로 읽기" },
    { id: "dash", type: "frontend", label: "대시보드", sublabel: "'업데이트' 창", sources: [S("skills/pm/app/js/app.js", 2307, 2312, "버튼 → 서버")] },
  ],
  cards: [
    { dot: "emerald", title: "빠른 업데이트", items: ["GitHub만 읽는다. Claude 사용량이 들지 않는다", "추정 · 14일 넘게 확인 안 함 · 확인 뒤 GitHub 이슈가 바뀜을 '다시 확인할 값'으로 모은다"] },
    { dot: "amber", title: "전체 업데이트", items: ["Claude가 원본을 읽고 이 워크스페이스의 값만 고친다. GitHub·Notion에는 쓰지 않는다", "못 찾은 값은 '없음'이 아니라 추정으로 두고 '답해 주실 것'으로 남긴다", "필요한 세팅은 pm doctor가 점검한다"] },
  ],
};

layoutSequence(
  update,
  [
    {
      label: "빠른 업데이트 (몇 초)",
      messages: [
        { id: "start", from: "trigger", to: "cli", label: "pm update --all [--deep]", variant: "emphasis" },
        { id: "snapshot", from: "cli", to: "github", label: "이슈·마일스톤 받기 (읽기)" },
        { id: "snapshot-back", from: "github", to: "cli", label: "github.json", variant: "return" },
        { id: "recheck", from: "cli", to: "ws", label: "다시 확인할 값 계산" },
        { id: "issue-states", from: "cli", to: "github", label: "연결된 이슈가 확인 뒤 바뀌었나" },
        { id: "issue-back", from: "github", to: "cli", label: "닫힘·갱신 날짜", variant: "return" },
      ],
    },
    {
      label: "전체 업데이트일 때 더 (몇 분)",
      messages: [
        { id: "spawn", from: "cli", to: "claude", label: "claude -p (읽기 도구 + pm만)", variant: "security" },
        { id: "read-gh", from: "claude", to: "github", label: "gh issue view --comments" },
        { id: "read-notion", from: "claude", to: "notion", label: "고객사 노랑 답·댓글 읽기" },
        { id: "apply", from: "claude", to: "ws", label: "pm answer·set·check --src (값·확인일)" },
        { id: "asks", from: "claude", to: "cli", label: "요약 · 바뀐 값 · 답해 주실 것", variant: "return" },
      ],
    },
    {
      label: "결과",
      messages: [
        { id: "record", from: "cli", to: "ws", label: "update.json 기록" },
        { id: "show", from: "ws", to: "dash", label: "마지막 업데이트 · 답할 것 N" },
      ],
    },
  ],
  [
    ["cli", "start", "record", "backend"],
    ["github", "snapshot", "snapshot-back", "external"],
    ["claude", "spawn", "asks", "frontend"],
  ],
);

for (const [dir, file, data] of [[archDir, "candidate.json", architecture], [notionDir, "candidate.json", notion], [updDir, "candidate.json", update]]) {
  fs.mkdirSync(path.join(here, dir), { recursive: true });
  fs.writeFileSync(path.join(here, dir, file), `${JSON.stringify(data, null, 2)}\n`);
  console.log(path.join(dir, file));
}
