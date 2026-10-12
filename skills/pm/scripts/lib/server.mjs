/**
 * pm serve: 대시보드를 로컬에서 띄우고, 화면에서 바꾼 상태를 project.json에 저장한다.
 * 127.0.0.1에만 열고, 쓰기는 같은 출처의 JSON 요청만 받는다(다른 사이트가 로컬 서버에 쓰지 못하게).
 */
import http from "node:http";
import { BALLS, Core, DATE_RE, openFile, today, UsageError } from "./common.mjs";
import { dashboardHtml } from "./build.mjs";

const ITEM_FIELDS = ["status", "ball", "res", "requested", "due", "updated", "receiveAt", "mode", "note", "answer", "answeredAt"];

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

// 고객사 확인 요청 목록의 '보냄' 처리: 아직 안 보낸 항목을 요청함으로 바꾼다
export function markSent(project, date, ids = null) {
  const items = Core.checklist(Core.normalize(project, today()));
  const pending = items.filter((i) => i.inSheet && i.status === "missing" && (!ids || ids.includes(i.id))).map((i) => i.id);
  for (const id of pending) {
    const item = project.checklist.find((x) => x.id === id);
    item.status = "requested";
    item.requested = date;
    item.ball = "client";
    item.updated = date;
    item.history = [...(item.history || []), { date, text: "고객사 확인 요청 목록으로 요청" }];
  }
  return pending;
}

export function serve(ws, { port = 4477, open = false } = {}) {
  const host = "127.0.0.1";
  const origins = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);
  const send = (res, status, body, type = "application/json; charset=utf-8") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html"))
        return send(res, 200, dashboardHtml(ws, { ids: ws.ids(), server: true }), "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/api/config") return send(res, 200, { claude: !!process.env.ANTHROPIC_API_KEY, company: ws.config.company });

      if (req.method !== "GET") {
        const origin = req.headers.origin;
        if (origin && !origins.has(origin)) return send(res, 403, { error: "origin" });
        if (req.method !== "DELETE" && !String(req.headers["content-type"] || "").startsWith("application/json")) return send(res, 415, { error: "json only" });
      }

      if (req.method === "POST" && url.pathname === "/api/claude") {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) return send(res, 503, { error: { message: "pm serve에 ANTHROPIC_API_KEY가 없습니다" } });
        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" },
          body: JSON.stringify(await readBody(req)),
        });
        return send(res, upstream.status, await upstream.text());
      }

      const match = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/(items|resources|queue|sheet|contract)(?:\/([^/]+))?(?:\/([^/]+))?$/);
      if (!match) return send(res, 404, { error: "not found" });
      const [, id, kind, rawA, rawB] = match;
      const a = rawA ? decodeURIComponent(rawA) : null;
      const b = rawB ? decodeURIComponent(rawB) : null;
      const project = ws.load(id);
      const save = () => ws.save(id, project);

      if (kind === "items" && req.method === "POST" && a) {
        const { patch = {}, logText, fieldAnswers } = await readBody(req);
        const item = project.checklist.find((i) => i.id === a);
        if (!item) return send(res, 404, { error: "item" });
        for (const field of ITEM_FIELDS) if (field in patch) item[field] = patch[field];
        // 화면에서 확인·저장하면 그날 확인한 것으로 남기고 추정 표시를 지운다
        if (patch.checked && typeof patch.checked === "object") item.checked = { at: today(), src: String(patch.checked.src || "PM 확인").slice(0, 100) };
        if (fieldAnswers && typeof fieldAnswers === "object")
          for (const f of item.fields || []) if (f.label in fieldAnswers) f.answer = String(fieldAnswers[f.label] ?? "").slice(0, 1000);
        if (item.status && !Core.STATUS[item.status]) return send(res, 400, { error: "status" });
        if (item.ball && !BALLS.includes(item.ball)) return send(res, 400, { error: "ball" });
        if (logText) item.history = [...(item.history || []), { date: today(), text: String(logText).slice(0, 500) }];
        save();
        return send(res, 200, { ok: true, item });
      }
      if (kind === "sheet" && req.method === "POST" && a === "sent") {
        const { date = today(), ids = null } = await readBody(req);
        if (!DATE_RE.test(date)) return send(res, 400, { error: "date" });
        const sent = markSent(project, date, ids);
        save();
        return send(res, 200, { ok: true, sent });
      }
      if (kind === "contract" && req.method === "POST" && a === "review" && b) {
        const { status, note } = await readBody(req);
        const row = project.contract?.review?.find((r) => r.id === b);
        if (!row) return send(res, 404, { error: "review" });
        if (status) {
          if (!Core.CONTRACT_REVIEW[status]) return send(res, 400, { error: "status" });
          row.status = status;
        }
        if (typeof note === "string") row.note = note.slice(0, 500);
        save();
        return send(res, 200, { ok: true });
      }
      if (kind === "contract" && req.method === "POST" && a === "payment" && b) {
        const { status, date } = await readBody(req);
        const payment = project.contract?.payments?.find((p) => p.name === b);
        if (!payment) return send(res, 404, { error: "payment" });
        if (status && !Core.PAYMENT_STATUS[status]) return send(res, 400, { error: "status" });
        if (status) payment.status = status;
        if (status === "paid") payment.paidAt = date && DATE_RE.test(date) ? date : today();
        save();
        return send(res, 200, { ok: true });
      }
      if (kind === "resources" && req.method === "POST" && a) {
        const { url: link = "" } = await readBody(req);
        const resource = (project.resources || []).find((r) => r.id === a);
        if (!resource) return send(res, 404, { error: "resource" });
        resource.url = /^https?:\/\//.test(link) ? link : "";
        save();
        return send(res, 200, { ok: true });
      }
      if (kind === "queue" && req.method === "POST" && !a) {
        const { entry } = await readBody(req);
        if (!entry?.id || typeof entry.text !== "string") return send(res, 400, { error: "entry" });
        project.queue = [...(project.queue || []).filter((q) => q.id !== entry.id), entry];
        save();
        return send(res, 200, { ok: true });
      }
      if (kind === "queue" && req.method === "DELETE" && a) {
        project.queue = (project.queue || []).filter((q) => q.id !== a);
        save();
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
    console.log(`워크스페이스 ${ws.dir} · 프로젝트 ${ws.ids().join(", ") || "없음"}`);
    console.log(`리미 Claude 모드: ${process.env.ANTHROPIC_API_KEY ? "서버 키 사용" : "ANTHROPIC_API_KEY 없음 → 화면에서 키를 넣거나 내장 모드"}`);
    if (open) openFile(address);
  });
}
