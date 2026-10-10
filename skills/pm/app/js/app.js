/**
 * PM 대시보드 화면. pm CLI(scripts/pm.mjs)가 데이터를 넣어 한 파일로 만든다.
 * - window.PM_PROJECTS: 프로젝트 데이터(project.json), window.PM_GITHUB: 이슈 스냅샷(github.json)
 * - window.PM_MODE: { server, client, company } — server면 변경을 pm serve에 저장, client면 고객사 공유본
 * 정적 파일로 열면 바꾼 상태(체크리스트, 링크, 승인 대기열)는 이 브라우저의 localStorage에만 저장한다.
 * 리미(js/agent.js)는 window.PMApp으로 이 화면을 읽고 조작한다.
 */
(() => {
  const F = window.PMForecast;
  const Core = window.PMCore;
  const PROJECTS = window.PM_PROJECTS || {};
  const GITHUB = window.PM_GITHUB || {};
  const MODE = window.PM_MODE || {};
  const SERVER = !!MODE.server;
  const CLIENT = !!MODE.client;
  const company = MODE.company || "우리 회사";
  const STORE_KEY = "pm-dashboard:v1";

  // ---------------------------------------------------------------- 저장
  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch {
      return {};
    }
  }
  const store = Object.assign({ overrides: {}, queue: [] }, loadStore());
  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      // 저장이 막힌 환경(사생활 보호 모드 등)에서는 이번 화면에서만 유지한다
    }
  }

  // pm serve에 변경을 보낸다. 실패하면 알리고 화면 값은 그대로 둔다(새로 고치면 파일 값으로 돌아간다)
  async function api(path, method, body) {
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(`${response.status}`);
      return await response.json();
    } catch (error) {
      toast(`저장하지 못했습니다 (${error.message}). pm serve가 켜져 있는지 확인하세요`);
      return null;
    }
  }

  // ---------------------------------------------------------------- 공통 도구
  const $ = (selector, rootEl = document) => rootEl.querySelector(selector);
  const $$ = (selector, rootEl = document) => [
    ...rootEl.querySelectorAll(selector),
  ];
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  const fmt = (n) =>
    n == null || Number.isNaN(n) ? "-" : Math.round(n).toLocaleString("ko-KR");
  const realToday = () => F.kstDate(new Date());

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    check:
      '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    ok: '<path d="M20 6 9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
    inbox:
      '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    minus: '<path d="M5 12h14"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    sparkles:
      '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    flag: '<path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    calendar:
      '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>',
  };
  const icon = (name, extra = "") =>
    `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${ICONS[name] || ""}</svg>`;
  function hydrateIcons(rootEl = document) {
    for (const el of $$("[data-icon]", rootEl)) {
      el.outerHTML = icon(el.dataset.icon);
    }
  }

  let toastTimer;
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("복사했습니다");
    } catch {
      toast("복사하지 못했습니다. 글을 직접 선택해 복사해 주세요");
    }
  }

  // ---------------------------------------------------------------- 상태 정의
  const { STATUS, FORECAST_STATUS } = Core;
  const { BALL, RECEIVE, MODES } = Core.labels(company);

  const chip = (meta, text) =>
    `<span class="chip ${meta.cls}">${icon(meta.icon)}${esc(text ?? meta.label)}</span>`;

  // ---------------------------------------------------------------- 모델
  const projectIds = Object.keys(PROJECTS);
  const state = {
    projectId: projectIds.includes(store.project)
      ? store.project
      : projectIds[0],
    view: store.view || "overview",
    kickoff: { status: "all", category: "all", q: "" },
    issues: {
      state: "open",
      milestone: "all",
      label: "all",
      assignee: "all",
      q: "",
    },
    scenario: { velocityPct: 0, inflowPct: 0, descope: 0 },
  };

  const cache = new Map();
  function forecastFor(project, scenario) {
    const gh = project.github && GITHUB[project.github.key];
    if (!gh) return null;
    const key = `${project.id}:${JSON.stringify(scenario || {})}`;
    if (cache.has(key)) return cache.get(key);
    if (!cache.has(`${project.id}:issues`))
      cache.set(`${project.id}:issues`, F.normalizeIssues(gh.issues));
    const result = F.compute({
      issues: cache.get(`${project.id}:issues`),
      milestones: gh.milestones,
      now: new Date(gh.syncedAt).getTime(),
      config: project.forecastConfig,
      scenario: scenario || {},
    });
    result.syncedAt = gh.syncedAt;
    result.issues = cache.get(`${project.id}:issues`);
    cache.set(key, result);
    return result;
  }

  const overridesFor = (projectId) => (SERVER ? {} : store.overrides[projectId] || {});
  const queueOf = (projectId) =>
    SERVER ? PROJECTS[projectId].queue || [] : store.queue.filter((entry) => entry.projectId === projectId);

  function getModel(projectId = state.projectId, scenario) {
    const project = PROJECTS[projectId];
    return Core.model(project, {
      forecast: forecastFor(project, scenario),
      overrides: overridesFor(projectId),
      queue: queueOf(projectId),
      today: realToday(),
    });
  }

  // 오늘의 브리핑(결론 먼저, 최대 4줄). 화면에는 강조가 들어간 html을 쓴다
  const briefing = (model = getModel()) => Core.briefing(model).map((item) => ({ ...item, text: item.html }));

  // ---------------------------------------------------------------- 리미 캐릭터 (리트머스 시험지)
  // 색은 프로젝트 상태(파랑 순항 · 보라 주의 · 빨강 위험), 물든 높이는 진행률
  const LIMI_COLORS = { good: "#2a78d6", watch: "#7a5ce0", risk: "#d03b3b" };
  function limiSvg({
    size = 48,
    mood = "good",
    progress = 0.5,
    thinking = false,
  } = {}) {
    const color = LIMI_COLORS[mood] || LIMI_COLORS.good;
    const top = 10;
    const bottom = 54;
    const level =
      bottom - Math.max(0.18, Math.min(0.92, progress)) * (bottom - top);
    const mouth =
      mood === "risk"
        ? '<path d="M27 33.5q5 -3.5 10 0" stroke="#3a2a2a" stroke-width="2" fill="none" stroke-linecap="round"/>'
        : mood === "watch"
          ? '<path d="M27.5 33h9" stroke="#3a2a2a" stroke-width="2" stroke-linecap="round"/>'
          : '<path d="M27 32q5 4.5 10 0" stroke="#3a2a2a" stroke-width="2" fill="none" stroke-linecap="round"/>';
    const brows =
      mood === "risk"
        ? '<path d="M24 22.5l4 1.5M40 22.5l-4 1.5" stroke="#3a2a2a" stroke-width="1.8" stroke-linecap="round"/>'
        : "";
    const sweat =
      mood === "risk"
        ? '<path d="M45 18q2 3 0 4.5q-2 -1.5 0 -4.5z" fill="#86b6ef"/>'
        : "";
    return `<svg class="limi-svg${thinking ? " thinking" : ""}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
      <defs><clipPath id="limi-clip-${size}"><rect x="18" y="8" width="28" height="47" rx="10"/></clipPath></defs>
      <ellipse cx="32" cy="59" rx="13" ry="2.6" fill="rgba(0,0,0,.12)"/>
      <g class="body-g">
        <rect x="18" y="8" width="28" height="47" rx="10" fill="#fffdf7" stroke="#d8d4c7" stroke-width="1.2"/>
        <g clip-path="url(#limi-clip-${size})">
          <path class="liquid wave" d="M10 ${level} q5 -3 10 0 t10 0 t10 0 t10 0 t10 0 V60 H10z" fill="${color}" opacity=".92"/>
        </g>
        <rect x="27" y="3.5" width="10" height="7" rx="2" fill="#f2efe6" stroke="#d8d4c7" stroke-width="1.2"/>
        ${brows}
        <ellipse class="eye" cx="27.5" cy="26.5" rx="2.1" ry="2.6" fill="#2b2b2b"/>
        <ellipse class="eye" cx="36.5" cy="26.5" rx="2.1" ry="2.6" fill="#2b2b2b"/>
        <circle cx="23.8" cy="31" r="1.9" fill="#f5a3a3" opacity=".7"/>
        <circle cx="40.2" cy="31" r="1.9" fill="#f5a3a3" opacity=".7"/>
        ${mouth}
        ${sweat}
      </g>
    </svg>`;
  }

  function progressOf(model) {
    const f = model.forecast;
    if (!f) return model.readiness.percent / 100;
    const total = f.scope.length;
    const done = f.scope.filter((item) => F.isCompleted(item)).length;
    return total ? done / total : 0;
  }

  // ---------------------------------------------------------------- 차트 (SVG, 외부 라이브러리 없음)
  let chartRenderers = [];
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      for (const renderChart of chartRenderers) renderChart();
    }, 120);
  });

  function niceMax(value) {
    if (value <= 5) return 5;
    const exp = 10 ** Math.floor(Math.log10(value));
    const steps = [1, 2, 2.5, 5, 10];
    for (const step of steps) if (value <= step * exp) return step * exp;
    return 10 * exp;
  }

  // 날짜 축 선 그래프. series: [{key,name,color,dash,points:[{x,y}]}]
  function lineChart(el, cfg) {
    const render = () => {
      const width = Math.max(320, el.clientWidth);
      const height = cfg.height || 280;
      const pad = { l: 40, r: width < 520 ? 52 : 96, t: 22, b: 28 };
      const start = cfg.start;
      const end = cfg.end;
      const span = Math.max(1, F.daysBetween(start, end));
      const x = (date) =>
        pad.l + (F.daysBetween(start, date) / span) * (width - pad.l - pad.r);
      const maxY = niceMax(
        Math.max(...cfg.series.flatMap((s) => s.points.map((p) => p.y)), 1),
      );
      const y = (value) =>
        pad.t + (1 - value / maxY) * (height - pad.t - pad.b);
      const ticks = [0, 0.25, 0.5, 0.75, 1].map((r) => r * maxY);
      let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(cfg.label)}">`;
      for (const t of ticks)
        svg += `<line class="gridline" x1="${pad.l}" x2="${width - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
      // 월요일마다 날짜 눈금
      for (let day = start; day <= end; day = F.addDays(day, 1)) {
        if (F.weekdayOf(day) === 1)
          svg += `<text class="tick" x="${x(day)}" y="${height - 8}" text-anchor="middle">${F.monthDay(day)}</text>`;
      }
      svg += `<line class="axis" x1="${pad.l}" x2="${width - pad.r}" y1="${y(0)}" y2="${y(0)}"/>`;
      for (const m of cfg.markers || []) {
        if (m.date < start || m.date > end) continue;
        svg += `<line class="${m.cls || "marker-line"}" x1="${x(m.date)}" x2="${x(m.date)}" y1="${pad.t - 6}" y2="${y(0)}"/>`;
        svg += `<text class="lbl" x="${x(m.date) + (m.anchor === "end" ? -4 : 4)}" y="${pad.t - 10}" text-anchor="${m.anchor || "start"}">${esc(m.label)}</text>`;
      }
      for (const s of cfg.series) {
        if (!s.points.length) continue;
        const d = s.points
          .map(
            (p, i) =>
              `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`,
          )
          .join("");
        if (s.area)
          svg += `<path d="${d}L${x(s.points.at(-1).x)},${y(0)}L${x(s.points[0].x)},${y(0)}Z" fill="${s.color}" opacity=".08"/>`;
        svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="5 4"' : ""}/>`;
        const last = s.points.at(-1);
        svg += `<circle cx="${x(last.x)}" cy="${y(last.y)}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
        if (s.endLabel)
          svg += s.labelLeft
            ? `<text class="lbl-strong" x="${x(last.x) - 8}" y="${y(last.y) - 10}" text-anchor="end">${esc(s.endLabel)}</text>`
            : `<text class="lbl-strong" x="${x(last.x) + 8}" y="${y(last.y) + 4}">${esc(s.endLabel)}</text>`;
      }
      svg += `<line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${y(0)}" visibility="hidden"/>`;
      svg += `<rect class="hit" x="${pad.l}" y="${pad.t}" width="${width - pad.l - pad.r}" height="${y(0) - pad.t}" fill="transparent"/>`;
      svg += "</svg>";
      el.innerHTML = `${svg}<div class="tooltip" role="presentation"></div>`;

      const hit = $(".hit", el);
      const cross = $(".crosshair", el);
      const tip = $(".tooltip", el);
      const byDate = cfg.series.map(
        (s) => new Map(s.points.map((p) => [p.x, p.y])),
      );
      const move = (event) => {
        const rect = el.querySelector("svg").getBoundingClientRect();
        const scale = width / rect.width;
        const px = (event.clientX - rect.left) * scale;
        const ratio = Math.min(
          1,
          Math.max(0, (px - pad.l) / (width - pad.l - pad.r)),
        );
        const date = F.addDays(start, Math.round(ratio * span));
        const rows = cfg.series
          .map((s, i) => ({ s, v: byDate[i].get(date) }))
          .filter((row) => row.v != null);
        if (!rows.length) return hide();
        cross.setAttribute("x1", x(date));
        cross.setAttribute("x2", x(date));
        cross.setAttribute("visibility", "visible");
        tip.innerHTML = `<div class="tt-title">${esc(F.shortDate(date))}</div>${rows
          .map(
            (row) =>
              `<div class="tt-row"><i class="tt-key" style="background:${row.s.color}"></i><b>${fmt(row.v)}</b><span>${esc(row.s.name)}</span></div>`,
          )
          .join("")}`;
        tip.classList.add("show");
        const left = x(date) / scale;
        tip.style.left = `${Math.min(rect.width - tip.offsetWidth - 4, left + 12)}px`;
        tip.style.top = `${pad.t / scale}px`;
      };
      const hide = () => {
        cross.setAttribute("visibility", "hidden");
        tip.classList.remove("show");
      };
      hit.addEventListener("pointermove", move);
      hit.addEventListener("pointerleave", hide);
    };
    render();
    chartRenderers.push(render);
  }

  // 묶음 막대. groups: [{name, values:{key:n}, note}], series: [{key,name,color}], refLine: {value,label}
  function columnChart(el, cfg) {
    const render = () => {
      const width = Math.max(320, el.clientWidth);
      const height = cfg.height || 240;
      const pad = { l: 40, r: 16, t: 26, b: 30 };
      const maxY = niceMax(
        Math.max(
          ...cfg.groups.flatMap((g) =>
            cfg.series.map((s) => g.values[s.key] || 0),
          ),
          cfg.refLine?.value || 0,
          1,
        ),
      );
      const y = (value) =>
        pad.t + (1 - value / maxY) * (height - pad.t - pad.b);
      const band = (width - pad.l - pad.r) / cfg.groups.length;
      const barW = Math.min(24, (band * 0.6) / cfg.series.length);
      let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(cfg.label)}">`;
      for (const t of [0, 0.25, 0.5, 0.75, 1].map((r) => r * maxY)) {
        svg += `<line class="gridline" x1="${pad.l}" x2="${width - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
      }
      cfg.groups.forEach((g, gi) => {
        const cx = pad.l + band * gi + band / 2;
        const total = cfg.series.length * barW + (cfg.series.length - 1) * 2;
        cfg.series.forEach((s, si) => {
          const v = g.values[s.key] || 0;
          const bx = cx - total / 2 + si * (barW + 2);
          const top = y(v);
          const h = Math.max(0, y(0) - top);
          const r = Math.min(4, h);
          svg += `<path d="M${bx},${y(0)}V${top + r}q0,-${r} ${r},-${r}h${barW - 2 * r}q${r},0 ${r},${r}V${y(0)}Z" fill="${s.color}" ${g.partial ? 'opacity=".55"' : ""}/>`;
          if (gi === cfg.groups.length - 1 || cfg.labelAll)
            svg += `<text class="lbl" x="${bx + barW / 2}" y="${top - 5}" text-anchor="middle">${fmt(v)}</text>`;
        });
        svg += `<text class="tick" x="${cx}" y="${height - 10}" text-anchor="middle">${esc(g.name)}${g.partial ? " (진행 중)" : ""}</text>`;
        svg += `<rect class="hit" data-gi="${gi}" x="${pad.l + band * gi}" y="${pad.t}" width="${band}" height="${y(0) - pad.t}" fill="transparent"/>`;
      });
      svg += `<line class="axis" x1="${pad.l}" x2="${width - pad.r}" y1="${y(0)}" y2="${y(0)}"/>`;
      if (cfg.refLine) {
        svg += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(cfg.refLine.value)}" y2="${y(cfg.refLine.value)}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="2 3"/>`;
        // 값 라벨은 마지막 막대에 붙으므로 기준선 라벨은 왼쪽 끝에 둔다
        svg += `<text class="lbl-strong" x="${pad.l + 4}" y="${y(cfg.refLine.value) - 6}">${esc(cfg.refLine.label)}</text>`;
      }
      svg += "</svg>";
      el.innerHTML = `${svg}<div class="tooltip"></div>`;
      const tip = $(".tooltip", el);
      for (const hit of $$(".hit", el)) {
        hit.addEventListener("pointermove", () => {
          const g = cfg.groups[Number(hit.dataset.gi)];
          tip.innerHTML = `<div class="tt-title">${esc(g.title || g.name)}</div>${cfg.series
            .map(
              (s) =>
                `<div class="tt-row"><i class="tt-key" style="background:${s.color};height:8px"></i><b>${fmt(g.values[s.key])}</b><span>${esc(s.name)}</span></div>`,
            )
            .join(
              "",
            )}${g.note ? `<div class="muted" style="margin-top:4px">${esc(g.note)}</div>` : ""}`;
          tip.classList.add("show");
          const rect = el.querySelector("svg").getBoundingClientRect();
          const scale = width / rect.width;
          const left = (Number(hit.getAttribute("x")) + band) / scale;
          tip.style.left = `${Math.min(rect.width - tip.offsetWidth - 4, left)}px`;
          tip.style.top = `${pad.t / scale}px`;
        });
        hit.addEventListener("pointerleave", () =>
          tip.classList.remove("show"),
        );
      }
    };
    render();
    chartRenderers.push(render);
  }

  // ---------------------------------------------------------------- 일정 타임라인
  function timelineHtml(model) {
    const { project, forecast } = model;
    const { start, end } = project.timeline;
    const span = F.daysBetween(start, end);
    const pct = (date) =>
      `${Math.max(0, Math.min(100, (F.daysBetween(start, date) / span) * 100)).toFixed(2)}%`;
    const width = (a, b) =>
      `${Math.max(0.6, ((F.daysBetween(a, b) + 1) / span) * 100).toFixed(2)}%`;
    const today = realToday();
    let months = "";
    for (let day = start; day <= end; day = F.addDays(day, 1)) {
      if (day.endsWith("-01") || day === start)
        months += `<span style="position:absolute;left:${pct(day)}">${Number(day.slice(5, 7))}월</span>`;
    }
    const todayLine =
      today >= start && today <= end
        ? `<div class="tl-today" style="left:${pct(today)}"><b>오늘</b></div>`
        : "";
    const phaseRow = `<div class="tl-row"><div class="tl-name">단계</div><div class="tl-track">${project.phases
      .map(
        (phase) =>
          `<div class="tl-bar ${phase.kind}" style="left:${pct(phase.start)};width:${width(phase.start, phase.end)}" title="${esc(`${phase.name} ${F.monthDay(phase.start)}~${F.monthDay(phase.end)}`)}"><span>${esc(phase.name)}</span></div>`,
      )
      .join("")}${todayLine}</div></div>
      <div class="tl-row"><div class="tl-name">주요 일정</div><div class="tl-track">${(
        project.milestones || []
      )
        .map((m) => {
          const nearEnd = F.daysBetween(start, m.date) / span > 0.82;
          return `<div class="tl-milestone" style="left:${pct(m.date)}" title="${esc(`${m.name} ${F.shortDate(m.date)}`)}"></div><span class="tl-mlabel" style="${nearEnd ? `right:calc(100% - ${pct(m.date)} + 12px)` : `left:calc(${pct(m.date)} + 12px)`}">${esc(m.name)} ${F.monthDay(m.date)}</span>`;
        })
        .join("")}${todayLine.replace("<b>오늘</b>", "")}</div></div>`;
    let sprintRow = "";
    if (forecast) {
      sprintRow = `<div class="tl-row"><div class="tl-name">스프린트</div><div class="tl-track">${forecast.views
        .filter((v) => v.isSprint && v.start)
        .map((v) => {
          const cls = v.isLate ? "late" : v.due < today ? "done" : "";
          return `<div class="tl-bar sprint ${cls}" style="left:${pct(v.start)};width:${width(v.start, v.due)}" title="${esc(`${v.title} · ${v.closed}/${v.total} 완료${v.isLate ? ` · ${v.open}건 남음` : ""}`)}"><span class="fill" style="width:${v.percent}%"></span><span>${esc(v.title.split(" ")[0])}</span></div>`;
        })
        .join("")}${todayLine.replace("<b>오늘</b>", "")}</div></div>`;
      const p = forecast.project;
      if (p) {
        sprintRow += `<div class="tl-row" data-internal><div class="tl-name">완료 예측</div><div class="tl-track"><div class="tl-forecast" style="left:${pct(p.optimistic)};width:${width(p.optimistic, p.pessimistic)}" title="${esc(`새 이슈가 멈출 때 ${F.shortDate(p.optimistic)}~${F.shortDate(p.pessimistic)}`)}"><i style="left:${((F.daysBetween(p.optimistic, p.expected) + 0.5) / (F.daysBetween(p.optimistic, p.pessimistic) + 1)) * 100}%"></i></div>
          <div class="tl-milestone" style="left:${pct(p.target)};background:var(--crit)" title="${esc(`${p.targetLabel} ${F.shortDate(p.target)}`)}"></div>
          <span class="tl-mlabel" style="left:calc(${pct(p.target)} + 12px);font-weight:500;color:var(--ink-2)">${esc(p.targetLabel)} · 추세면 ~${fmt(p.remainingAtTarget)}건 남음</span>${todayLine.replace("<b>오늘</b>", "")}</div></div>`;
      }
    }
    const kinds = new Set(project.phases.map((phase) => phase.kind));
    const legend = [
      ["kickoff", "킥오프·준비", "var(--s-neutral)"],
      ["dev", "개발", "var(--s1)"],
      ["qa", "고객사 QA", "var(--s3)"],
      ["review", "스토어 심사", "var(--violet)"],
    ]
      .filter(([kind]) => kinds.has(kind))
      .map(
        ([, label, color]) =>
          `<span><i class="key" style="background:${color}"></i>${label}</span>`,
      )
      .join("");
    return `<div class="timeline-scroll"><div class="timeline"><div class="tl-row" style="min-height:22px"><div></div><div class="tl-scale" style="display:block">${months}</div></div>${phaseRow}${sprintRow}</div></div>
      <div class="tl-legend">${legend}<span><i class="key" style="background:var(--ink);width:9px;height:9px;transform:rotate(45deg);border-radius:2px"></i>주요 일정</span>${forecast ? '<span data-internal><i class="key dot" style="background:var(--s2)"></i>예상 완료일(새 이슈가 멈출 때, 막대는 낙관~비관)</span>' : ""}<span><i class="key line" style="background:var(--crit);width:2px;height:12px"></i>오늘</span></div>`;
  }

  // ---------------------------------------------------------------- 화면: 오늘
  function renderOverview(model) {
    const { project, forecast, readiness, waiting, health } = model;
    const p = forecast?.project;
    const items = briefing(model);
    const launch = project.dates?.launch;
    const dLaunch = launch ? F.daysBetween(realToday(), launch) : null;
    const weekly = forecast?.weekly ?? [];
    const sparkMax = Math.max(
      1,
      ...weekly.map((w) => Math.max(w.done, w.created)),
    );
    const spark = weekly.length
      ? `<svg viewBox="0 0 120 34" width="120" height="34" aria-hidden="true">${weekly
          .map((w, i) => {
            const h1 = (w.done / sparkMax) * 30;
            const h2 = (w.created / sparkMax) * 30;
            const x0 = i * 30 + 4;
            return `<rect x="${x0}" y="${32 - h1}" width="9" height="${h1}" rx="2" fill="${i === weekly.length - 1 ? "var(--s1)" : "color-mix(in srgb, var(--s1) 45%, transparent)"}"/><rect x="${x0 + 11}" y="${32 - h2}" width="9" height="${h2}" rx="2" fill="${i === weekly.length - 1 ? "var(--s2)" : "color-mix(in srgb, var(--s2) 45%, transparent)"}"/>`;
          })
          .join("")}</svg>`
      : "";

    const hero = p
      ? `<div class="hero-label">${esc(p.targetLabel)}(${F.monthDay(p.target)})에 남을 이슈</div>
         <div class="hero-value num">~${fmt(p.remainingAtTarget)}<small>건</small></div>
         <div class="hero-note">지금처럼 주 ${fmt(p.inflow)}건이 새로 들어오고 ${fmt(p.velocity)}건을 닫으면. 새 이슈가 멈추면 <b>${F.shortDate(p.expected)}</b>에 끝납니다.</div>
         <div style="margin-top:12px">${chip(FORECAST_STATUS[p.status], `예측 ${FORECAST_STATUS[p.status].label}`)} <button class="link-btn" data-go="schedule" style="margin-left:8px">일정·속도 보기 →</button></div>`
      : `<div class="hero-label">킥오프 준비율</div>
         <div class="hero-value num">${readiness.percent}<small>%</small></div>
         <div class="hero-note">${readiness.ready}/${readiness.total}개 항목 확정. 없는 자료부터 요청하면 개발 착수일을 지킬 수 있어요.</div>
         <div style="margin-top:12px"><button class="link-btn" data-go="kickoff">체크리스트 보기 →</button></div>`;

    const decisions = project.decisions?.length
      ? project.decisions
          .map(
            (d) =>
              `<div class="list-row"><div><div class="t">${esc(d.title)}</div><div class="d">권장: ${esc(d.recommend)}${d.due ? ` · 기한 ${esc(d.due)}` : ""}</div></div><button class="btn small" data-ask-limi="${esc(`결정 도와줘: ${d.title}`)}">${icon("chat")}리미와 정리</button></div>`,
          )
          .join("")
      : `<div class="empty"><b>결정할 일이 없어요</b>새 결정 요청은 리미가 모아 둡니다.</div>`;

    const waitingHtml = waiting.length
      ? waiting
          .slice(0, 5)
          .map(
            (item) =>
              `<button class="row-btn list-row" data-item="${esc(item.id)}"><div><div class="t">${esc(item.title)}</div><div class="d">${esc(item.res?.label || "받을 곳 미정")}${item.blocks ? ` · ${esc(item.blocks)}` : ""}</div></div><span class="wait ${item.overdue ? "late" : ""} num">D+${item.waitDays}</span></button>`,
          )
          .join("")
      : `<div class="empty"><b>고객사 대기 없음</b>요청한 자료가 모두 들어왔어요.</div>`;

    let sprintHtml = `<div class="empty"><b>진행 중인 스프린트가 없어요</b>이슈 트래커를 연결하면 표시됩니다.</div>`;
    if (forecast?.current) {
      const v = forecast.current;
      const s = forecast.sprint;
      const late = forecast.views.filter((view) => view.isLate);
      // 고객사 공유본에는 이슈가 없어 속도를 계산하지 않는다
      const statusLine = CLIENT
        ? ""
        : s?.pace != null
          ? s.finish
            ? `하루 ${s.pace.toFixed(1)}건 → ${F.shortDate(s.finish)} 완료 예상`
            : `하루 ${s.pace.toFixed(1)}건 → 약 ${s.carryover}건이 다음 스프린트로`
          : v.start > forecast.today
            ? `${F.shortDate(v.start)} 시작 · ${s?.total ?? v.total}건 계획`
            : "첫 근무일이 지나면 예측이 시작됩니다";
      sprintHtml = `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>${esc(v.title)}</b><span class="muted num">${v.closed}/${v.total}</span></div>
        <div class="meter"><span style="width:${v.percent}%;background:var(--accent)"></span></div>
        <div class="stat-note" style="margin-top:6px">${esc(statusLine)}</div>
        ${late.map((view) => `<div class="callout warn" style="margin-top:12px">${icon("alert")}<span><b>${esc(view.title.split(" ")[0])}</b> 마감(${F.monthDay(view.due)})이 지났고 ${view.open}건이 열려 있습니다.</span></div>`).join("")}
        <div class="bar-list" style="margin-top:14px">${forecast.views
          .filter(
            (view) => view.isSprint && view.due >= forecast.today && view !== v,
          )
          .slice(0, 2)
          .map(
            (view) =>
              `<div class="bar-item"><span class="name">${esc(view.title.split(" ")[0])}</span><span class="trackbar"><span style="width:${view.percent}%;background:var(--accent)"></span></span><span class="val">${view.closed}/${view.total}</span></div>`,
          )
          .join("")}</div>`;
    }

    return `
      <div class="view-head"><div><h1>오늘</h1><p>${esc(project.name)} · ${esc(project.summary)}</p></div></div>
      <div class="grid g-12">
        <section class="card brief span-8" data-internal>
          <div class="brief-limi">${limiSvg({ size: 92, mood: health.key, progress: progressOf(model) })}</div>
          <div>
            <div class="when">리미의 브리핑 · ${F.shortDate(realToday())}${forecast ? ` · GitHub ${esc(syncLabel(forecast.syncedAt))} 기준` : ""}</div>
            <h2>${esc(project.name)} · 지금 상태 ${chip(health)}</h2>
            <ol>${items.map((item, i) => `<li><button class="row-btn" data-brief="${i}" style="font-size:14px">${item.text}</button></li>`).join("")}</ol>
            <div class="btn-row">
              <button class="btn primary" data-open-limi>${icon("chat")}리미와 대화</button>
              ${model.missing.length ? `<button class="btn" data-go="kickoff" data-filter="missing">${icon("send")}없는 자료 요청하기</button>` : ""}
            </div>
          </div>
        </section>
        <section class="card hero span-4" ${p ? "data-internal" : ""}>${hero}</section>
        <div class="stats span-12">
          <div class="card stat"><div class="stat-label"><span>출시까지</span>${icon("flag")}</div><div class="stat-value num">${dLaunch == null ? "미정" : `D-${dLaunch}`}</div><div class="stat-note">${launch ? `${F.shortDate(launch)} 출시` : "출시일 미정"}${project.dates?.qaStart ? ` · 고객사 QA ${F.monthDay(project.dates.qaStart)}~${F.monthDay(project.dates.qaEnd)}` : ""}</div></div>
          <div class="card stat" data-internal><div class="stat-label"><span>주간 처리 / 유입</span>${spark}</div><div class="stat-value num">${p ? `${fmt(p.velocity)} <small>/ ${fmt(p.inflow)}건</small>` : "-"}</div><div class="stat-note">${p ? (p.velocity >= p.inflow ? "닫는 속도가 더 빠릅니다" : `유입이 ${fmt(p.inflow - p.velocity)}건 더 많습니다 · 최근 4주 가중 평균`) : "이슈 트래커 연결 전"}</div></div>
          <div class="card stat"><div class="stat-label"><span>킥오프 준비</span>${icon("check")}</div><div class="stat-value num">${readiness.ready}<small> / ${readiness.total} 확정</small></div><div class="meter" aria-hidden="true"><span style="width:${readiness.percent}%;background:var(--good)"></span></div></div>
          <div class="card stat"><div class="stat-label"><span>고객사 대기</span>${icon("clock")}</div><div class="stat-value num">${waiting.length}<small>건</small></div><div class="stat-note">${waiting[0] ? `가장 오래된 것 D+${waiting[0].waitDays} · ${esc(waiting[0].title)}` : "기다리는 자료 없음"}</div></div>
        </div>
        ${model.kickoff.active ? `<section class="card span-12" data-internal><div class="card-head"><h2>킥오프 진행 ${model.kickoff.completed}/${model.kickoff.stages.length}</h2><button class="link-btn" data-go="kickoff">킥오프 화면 →</button></div>${stepperHtml(model)}<h3 style="font-size:13px;margin:16px 0 6px">이번 주 할 일</h3>${weekHtml(model, 5)}</section>` : ""}
        <section class="card span-12">
          <div class="card-head"><h2>전체 일정</h2><span class="sub">${F.shortDate(project.timeline.start)} ~ ${F.shortDate(project.timeline.end)}</span></div>
          ${timelineHtml(model)}
        </section>
        <section class="card span-4" id="decisions" data-internal><div class="card-head"><h2>결정 필요</h2><span class="sub">권장안 먼저</span></div><div class="list">${decisions}</div></section>
        <section class="card span-4 client-span"><div class="card-head"><h2>고객사 답 대기</h2><button class="link-btn" data-go="kickoff" data-filter="requested">전체 →</button></div><div class="list">${waitingHtml}</div></section>
        <section class="card span-4 client-span"><div class="card-head"><h2>이번 스프린트</h2>${!CLIENT && forecast?.sprint?.status ? chip(FORECAST_STATUS[forecast.sprint.status]) : ""}</div>${sprintHtml}</section>
        ${risksHtml(project)}
      </div>`;
  }

  function risksHtml(project) {
    const risks = project.risks || [];
    if (!risks.length) return "";
    const level = {
      high: { cls: "crit", icon: "alert", label: "높음" },
      mid: { cls: "warn", icon: "alert", label: "중간" },
      low: { cls: "neutral", icon: "minus", label: "낮음" },
    };
    return `<section class="card span-12" data-internal><div class="card-head"><h2>위험과 대응</h2><span class="sub">영향 큰 순 · 내부용</span></div>
      <div style="overflow-x:auto"><table class="risk-table"><tbody>${risks
        .map(
          (r) =>
            `<tr><td style="width:84px">${chip(level[r.level] || level.mid)}</td><td><div class="r-title">${esc(r.title)}</div><div class="r-detail">${esc(r.detail || "")}</div></td><td style="width:45%"><span class="soft">→ ${esc(r.mitigation || "")}</span></td></tr>`,
        )
        .join("")}</tbody></table></div></section>`;
  }

  function syncLabel(iso) {
    const d = new Date(iso);
    const time = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
    return `${F.monthDay(F.kstDate(d))} ${time}`;
  }

  // ---------------------------------------------------------------- 화면: 킥오프 체크리스트
  function renderKickoff(model) {
    const { project, checklist, readiness } = model;
    const f = state.kickoff;
    const counts = Object.fromEntries(
      Object.keys(STATUS).map((key) => [
        key,
        checklist.filter((item) => item.status === key).length,
      ]),
    );
    const cats = project.categories.map((cat) => {
      const items = checklist.filter((item) => item.cat === cat.id);
      const counted = items.filter((item) => item.status !== "not_needed");
      return {
        ...cat,
        items,
        ready: counted.filter((item) => item.status === "confirmed").length,
        total: counted.length,
      };
    });
    const q = f.q.trim().toLowerCase();
    const visible = checklist.filter(
      (item) =>
        (f.status === "all" || item.status === f.status) &&
        (f.category === "all" || item.cat === f.category) &&
        (!q ||
          `${item.title} ${item.note || ""} ${item.res?.label || ""}`
            .toLowerCase()
            .includes(q)),
    );
    const stackHtml = (items) => {
      const total = items.length || 1;
      return `<div class="stack" aria-hidden="true">${[
        "confirmed",
        "received",
        "requested",
        "missing",
        "not_needed",
      ]
        .map((key) => {
          const n = items.filter((item) => item.status === key).length;
          return n
            ? `<span class="${STATUS[key].cls}" style="width:${(n / total) * 100}%"></span>`
            : "";
        })
        .join("")}</div>`;
    };

    const groups = project.categories
      .map((cat) => {
        const rows = visible
          .filter((item) => item.cat === cat.id)
          .sort((a, b) => STATUS[a.status].order - STATUS[b.status].order);
        if (!rows.length) return "";
        return `<div class="check-group"><h3>${esc(cat.name)} <span class="muted num" style="font-weight:500">${rows.length}</span></h3>
          <table class="check-table"><thead><tr><th>항목</th><th class="col-status">상태</th><th class="col-ball">공</th><th class="col-res">리소스</th><th class="col-wait">대기·요청</th><th class="col-blocks">막는 일정</th></tr></thead><tbody>
          ${rows
            .map(
              (item) => `<tr data-item="${esc(item.id)}" tabindex="0">
                <td><div class="title">${esc(item.title)}</div>${item.note ? `<div class="note">${esc(item.note)}</div>` : ""}</td>
                <td>${chip(STATUS[item.status])}</td>
                <td class="c-ball"><span class="ball ${esc(item.ball)}">${esc(BALL[item.ball] || "-")}</span></td>
                <td class="c-res">${item.res?.url ? `<span class="res">${icon("link")}<span>${esc(item.res.label)}</span></span>` : item.res?.label ? `<span class="res">${icon("doc")}<span>${esc(item.res.label)}</span></span>` : `<span class="res none">${icon("plug")}<span>연결 안 됨</span></span>`}</td>
                <td>${item.waitDays != null ? `<span class="wait ${item.overdue ? "late" : ""} num">D+${item.waitDays}</span>` : item.status === "missing" && item.askBy ? `<span class="wait ${item.late ? "late" : ""} num" title="이 날까지 요청해야 일정에 맞음">~${F.monthDay(item.askBy)} 요청</span>` : item.due ? `<span class="wait ${item.overdue ? "late" : ""} num">~${F.monthDay(item.due)}</span>` : '<span class="muted">-</span>'}</td>
                <td class="c-blocks"><span class="soft" style="font-size:12px">${esc(item.blocks || "-")}${item.blocksDate ? ` ${F.monthDay(item.blocksDate)}` : ""}</span></td>
              </tr>`,
            )
            .join("")}
          </tbody></table></div>`;
      })
      .join("");

    return `
      <div class="view-head">
        <div><h1>킥오프 체크리스트</h1><p>외주 프로젝트 시작에 필요한 자료·계정·정책을 한곳에 모으고, 없는 것은 바로 요청합니다. 확정 ${readiness.ready}/${readiness.total} (${readiness.percent}%)</p></div>
        <div class="btn-row">
          <button class="btn" data-srs-wizard>${icon("sparkles")}SRS 생성 도우미</button>
          ${model.missing.length ? `<button class="btn accent" data-batch-requests data-internal>${icon("send")}없는 자료 요청서 한꺼번에 (${model.missing.length})</button>` : ""}
        </div>
      </div>
      <div class="grid g-12" style="margin-bottom:16px">
        <section class="card span-12"><div class="card-head"><h2>킥오프 ${model.kickoff.completed}/${model.kickoff.stages.length}단계</h2><button class="link-btn" data-doc="kickoff">킥오프 회의 자료 →</button></div>${stepperHtml(model)}</section>
        <section class="card span-7"><div class="card-head"><h2>이번 주 할 일</h2><span class="sub">요청 시작일이 지난 것부터</span></div>${weekHtml(model)}</section>
        <section class="card span-5"><div class="card-head"><h2>개발 범위</h2><button class="link-btn" data-go="requests">고객사 요청 목록 →</button></div>${scopeHtml(project)}</section>
        ${contractHtml(model)}
      </div>
      <div class="cat-grid">${cats
        .map(
          (cat) =>
            `<button class="cat-card" data-cat="${esc(cat.id)}" aria-pressed="${f.category === cat.id}"><div class="name">${esc(cat.name)}</div><div class="val num">${cat.ready}<small> / ${cat.total}</small></div>${stackHtml(cat.items)}</button>`,
        )
        .join("")}</div>
      <div class="filters">
        <div class="seg" role="group" aria-label="상태로 거르기">
          <button data-status="all" aria-pressed="${f.status === "all"}">전체<span class="n">${checklist.length}</span></button>
          ${["missing", "requested", "received", "confirmed", "not_needed"].map((key) => `<button data-status="${key}" aria-pressed="${f.status === key}">${STATUS[key].label}<span class="n">${counts[key]}</span></button>`).join("")}
        </div>
        ${f.category !== "all" ? `<button class="chip outline" data-cat="all">${esc(project.categories.find((c) => c.id === f.category)?.name)} ✕</button>` : ""}
        <span style="flex:1"></span>
        <label class="sr-only" for="kick-q">항목 찾기</label>
        <input id="kick-q" class="search" type="search" placeholder="항목 찾기" value="${esc(f.q)}" />
      </div>
      ${groups || `<div class="card empty"><b>조건에 맞는 항목이 없어요</b>거르기를 풀어 보세요.</div>`}
      <p class="muted" style="font-size:12px">공: 지금 다음 행동을 해야 하는 쪽. 대기: 요청한 날부터 센 날짜(D+7을 넘으면 빨간색). ${SERVER ? "상태를 바꾸면 project.json에 바로 저장됩니다." : "상태를 바꾸거나 링크를 연결한 내용은 이 브라우저에만 저장됩니다. 파일에 남기려면 pm serve로 여세요."}</p>`;
  }

  // ---------------------------------------------------------------- 요청서
  const requestText = (model, item, opts) => Core.requestText(model.project, item, opts, company);
  const reminderText = (model, item) => Core.reminderText(model.project, item);

  function addToQueue(entry) {
    const item = {
      id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      projectId: state.projectId,
      ...entry,
    };
    if (SERVER) {
      const project = PROJECTS[state.projectId];
      project.queue = [...(project.queue || []), item];
      api(`/api/projects/${encodeURIComponent(project.id)}/queue`, "POST", { entry: item });
    } else {
      store.queue.push(item);
      saveStore();
    }
    updateChrome();
    return item;
  }

  function removeFromQueue(entryId) {
    if (SERVER) {
      const project = PROJECTS[state.projectId];
      project.queue = (project.queue || []).filter((q) => q.id !== entryId);
      api(`/api/projects/${encodeURIComponent(project.id)}/queue/${encodeURIComponent(entryId)}`, "DELETE");
    } else {
      store.queue = store.queue.filter((q) => q.id !== entryId);
      saveStore();
    }
    updateChrome();
  }

  // 프로젝트별 덮어쓰기 저장소(정적 보기). 없으면 만든다
  function projectOverrides(projectId) {
    if (!store.overrides[projectId]) store.overrides[projectId] = {};
    return store.overrides[projectId];
  }

  function setItem(itemId, patch, logText) {
    if (SERVER) {
      const project = PROJECTS[state.projectId];
      const item = project.checklist.find((entry) => entry.id === itemId);
      Object.assign(item, patch);
      if (logText) item.history = [...(item.history || []), { date: realToday(), text: logText }];
      api(`/api/projects/${encodeURIComponent(project.id)}/items/${encodeURIComponent(itemId)}`, "POST", { patch, logText });
    } else {
      const projectStore = projectOverrides(state.projectId);
      if (!projectStore[itemId]) projectStore[itemId] = {};
      const current = projectStore[itemId];
      Object.assign(current, patch);
      if (logText) current.log = [...(current.log || []), { date: realToday(), text: logText }];
      saveStore();
    }
    render();
  }

  const resourceUrl = (project, resId) =>
    SERVER ? project.resources.find((r) => r.id === resId)?.url : store.overrides[project.id]?.__resources?.[resId]?.url;

  function setResource(resId, url) {
    const project = PROJECTS[state.projectId];
    if (SERVER) {
      const resource = project.resources.find((r) => r.id === resId);
      resource.url = url;
      api(`/api/projects/${encodeURIComponent(project.id)}/resources/${encodeURIComponent(resId)}`, "POST", { url });
    } else {
      const projectStore = projectOverrides(project.id);
      projectStore.__resources = { ...projectStore.__resources, [resId]: { url } };
      saveStore();
    }
  }

  // ---------------------------------------------------------------- 서랍
  let lastFocus = null;
  function openDrawer({ kicker = "", title, sub = "", body }) {
    lastFocus = document.activeElement;
    $("#drawer-kicker").innerHTML = kicker;
    $("#drawer-title").textContent = title;
    $("#drawer-sub").innerHTML = sub;
    $("#drawer-body").innerHTML = body;
    $("#drawer").classList.add("open");
    $("#drawer").setAttribute("aria-hidden", "false");
    $("#scrim").classList.add("open");
    $("#drawer-close").focus();
  }
  function closeDrawer() {
    $("#drawer").classList.remove("open");
    $("#drawer").setAttribute("aria-hidden", "true");
    $("#scrim").classList.remove("open");
    lastFocus?.focus?.();
  }

  function openItem(itemId, preset = {}) {
    const model = getModel();
    const item = model.checklist.find((entry) => entry.id === itemId);
    if (!item) return;
    const cat = model.project.categories.find((c) => c.id === item.cat);
    const needsAction =
      item.status === "missing" || item.status === "requested";
    const defaultDue = item.due || F.addDays(realToday(), 5);
    const receive =
      preset.receive ||
      item.receiveAt ||
      model.project.receiveDefault ||
      "notion";
    const mode = preset.mode || item.mode || "ask";
    const kv = `<dl class="kv">
      <dt>공</dt><dd><span class="ball ${esc(item.ball)}">${esc(BALL[item.ball] || "-")}</span>${item.owner ? ` · ${esc(item.owner)}` : ""}</dd>
      <dt>리소스</dt><dd>${item.res?.url ? `<a href="${esc(item.res.url)}" target="_blank" rel="noopener">${esc(item.res.label)} ${icon("ext")}</a>` : esc(item.res?.label || "연결 안 됨")}</dd>
      ${item.requested ? `<dt>요청일</dt><dd class="num">${F.shortDate(item.requested)}${item.waitDays != null ? ` · <span class="wait ${item.overdue ? "late" : ""}">D+${item.waitDays}</span>` : ""}</dd>` : ""}
      ${item.due ? `<dt>기한</dt><dd class="num">${F.shortDate(item.due)}</dd>` : ""}
      ${item.blocks ? `<dt>막는 일정</dt><dd>${esc(item.blocks)}${item.blocksDate ? ` (${F.shortDate(item.blocksDate)})` : ""}</dd>` : ""}
      ${item.updated ? `<dt>최근 확인</dt><dd class="num">${F.shortDate(item.updated)}</dd>` : ""}
    </dl>`;
    const note = item.note
      ? `<div class="callout">${icon("doc")}<span>${esc(item.note)}</span></div>`
      : "";
    const internal = item.internal
      ? `<div class="callout warn" data-internal style="margin-top:8px">${icon("eye")}<span><b>내부 메모</b> ${esc(item.internal)}</span></div>`
      : "";

    let action = "";
    if (item.helper === "srs" && item.status !== "confirmed") {
      action += `<div class="section-title">${icon("sparkles")}SRS가 없거나 부족하면</div>
        <div class="callout info">${icon("sparkles")}<span>계약 범위·회의록·기존 이슈를 모아 SRS 초안을 만들고, 고객사 확인 요청까지 이어서 만듭니다.</span></div>
        <div class="btn-row" style="margin-top:10px"><button class="btn accent" data-srs-wizard>${icon("sparkles")}SRS 생성 도우미 열기</button></div>`;
    }
    if (needsAction) {
      action += `<div class="section-title" data-internal>${icon("send")}${item.status === "missing" ? "확보하기" : "다시 요청하기"}</div>
      <div class="steps" data-internal id="req-steps">
        <div class="step"><div class="step-head">받을 곳</div><div class="options">${Object.entries(
          RECEIVE,
        )
          .map(
            ([key, meta]) =>
              `<label class="option"><input type="radio" name="receive" value="${key}" ${key === receive ? "checked" : ""}/><span><b>${esc(meta.label)}</b><small>${esc(meta.desc)}</small></span></label>`,
          )
          .join("")}</div></div>
        <div class="step"><div class="step-head">진행 방식</div><div class="options">${Object.entries(
          MODES,
        )
          .map(
            ([key, meta]) =>
              `<label class="option"><input type="radio" name="mode" value="${key}" ${key === mode ? "checked" : ""}/><span><b>${esc(meta.label)}</b><small>${esc(meta.desc)}</small></span></label>`,
          )
          .join("")}</div>
          <div class="row2"><label class="field">회신 기한<input type="date" id="req-due" value="${esc(defaultDue)}"/></label><label class="field">받는 사람<input id="req-to" value="${esc(item.clientContact || model.project.clientContact || `${model.project.client} 담당자`)}"/></label></div></div>
        <div class="step"><div class="step-head">요청서 (고쳐 쓸 수 있어요)</div>
          ${item.status === "requested" ? `<div class="callout warn" style="margin-bottom:8px">${icon("clock")}<span>이미 ${F.shortDate(item.requested)}에 요청했습니다. 아래는 리마인드 초안입니다.</span></div>` : ""}
          <label class="field" style="margin-top:0"><span class="sr-only">요청서 본문</span><textarea id="req-text"></textarea></label>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn accent" id="req-queue">${icon("send")}승인 대기열에 넣기</button>
            <button class="btn" id="req-copy">${icon("copy")}복사</button>
          </div>
          <p class="muted" style="font-size:12px;margin:8px 0 0">발송은 승인 대기열에서 사람이 확인한 뒤에 합니다. 리미와 대시보드는 직접 보내지 않습니다.</p>
        </div>
      </div>`;
    }
    const statusForm = `<div class="section-title">${icon("check")}상태 바꾸기</div>
      <div class="row2"><label class="field" style="margin-top:0">상태<select id="st-status">${Object.entries(
        STATUS,
      )
        .map(
          ([key, meta]) =>
            `<option value="${key}" ${key === item.status ? "selected" : ""}>${esc(meta.label)}</option>`,
        )
        .join("")}</select></label>
      <label class="field" style="margin-top:0">공<select id="st-ball">${Object.entries(
        BALL,
      )
        .map(
          ([key, label]) =>
            `<option value="${key}" ${key === item.ball ? "selected" : ""}>${esc(label)}</option>`,
        )
        .join("")}</select></label></div>
      <div class="row2"><label class="field">리소스 이름<input id="st-res-label" value="${esc(item.res?.label || "")}" placeholder="예: Notion 요청 DB '환불 정책'"/></label><label class="field">링크<input id="st-res-url" value="${esc(item.res?.url || "")}" placeholder="https://"/></label></div>
      <div class="btn-row" style="margin-top:10px"><button class="btn" id="st-save">저장</button></div>`;
    const history = item.history?.length
      ? `<div class="section-title">${icon("clock")}기록</div><ul class="history">${item.history
          .slice()
          .reverse()
          .map(
            (h) =>
              `<li><time>${F.monthDay(h.date)}</time><span>${esc(h.text)}</span></li>`,
          )
          .join("")}</ul>`
      : "";

    openDrawer({
      kicker: `<span class="muted" style="font-size:12px">${esc(cat?.name || "")}</span>`,
      title: item.title,
      sub: `${chip(STATUS[item.status])} ${item.overdue ? `<span class="chip crit">${icon("alert")}기한 지남</span>` : ""}`,
      body: kv + note + internal + action + statusForm + history,
    });

    const body = $("#drawer-body");
    const textArea = $("#req-text", body);
    const currentOpts = () => ({
      receive: $('input[name="receive"]:checked', body)?.value || receive,
      mode: $('input[name="mode"]:checked', body)?.value || mode,
      due: $("#req-due", body)?.value,
    });
    let edited = false;
    const regenerate = () => {
      if (!textArea || edited) return;
      textArea.value =
        item.status === "requested"
          ? reminderText(model, item)
          : requestText(model, item, currentOpts());
    };
    if (textArea) {
      regenerate();
      textArea.addEventListener("input", () => (edited = true));
      for (const input of $$(
        'input[name="receive"], input[name="mode"], #req-due',
        body,
      )) {
        input.addEventListener("change", () => {
          edited = false;
          regenerate();
        });
      }
      $("#req-copy", body).addEventListener("click", () =>
        copyText(textArea.value),
      );
      $("#req-queue", body).addEventListener("click", () => {
        const opts = currentOpts();
        addToQueue({
          kind: item.status === "requested" ? "reminder" : "request",
          itemId: item.id,
          title: `${item.title} ${item.status === "requested" ? "리마인드" : "요청"}`,
          to: $("#req-to", body).value,
          channel: RECEIVE[opts.receive].label,
          receive: opts.receive,
          mode: opts.mode,
          due: opts.due,
          text: textArea.value,
        });
        toast("승인 대기열에 넣었습니다");
        closeDrawer();
      });
    }
    $("#st-save", body).addEventListener("click", () => {
      const status = $("#st-status", body).value;
      const ball = $("#st-ball", body).value;
      const label = $("#st-res-label", body).value.trim();
      const url = $("#st-res-url", body).value.trim();
      const patch = { status, ball, updated: realToday() };
      if (label || url)
        patch.res = {
          label: label || url,
          url: /^https?:\/\//.test(url) ? url : "",
        };
      if (status === "requested" && item.status !== "requested")
        patch.requested = realToday();
      setItem(
        item.id,
        patch,
        `상태 ${STATUS[item.status].label} → ${STATUS[status].label}${label ? ` · ${label}` : ""}`,
      );
      closeDrawer();
      toast("저장했습니다");
    });
    hydrateIcons(body);
  }

  function openQueue() {
    const model = getModel();
    const entries = model.queue;
    const body = entries.length
      ? entries
          .map(
            (entry) => `<div class="queue-item" data-q="${esc(entry.id)}">
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><b>${esc(entry.title)}</b><div class="muted" style="font-size:12px">${esc(entry.channel || "")}${entry.to ? ` · 받는 사람 ${esc(entry.to)}` : ""}${entry.due ? ` · 기한 ${F.shortDate(entry.due)}` : ""} · ${{ limi: "리미 초안", claude: "Claude 초안" }[entry.by] || "직접 작성"}</div></div><span class="chip warn">${icon("clock")}승인 대기</span></div>
              <pre>${esc(entry.text)}</pre>
              <div class="btn-row"><button class="btn small" data-q-copy>${icon("copy")}복사</button><button class="btn small accent" data-q-sent>${icon("ok")}발송했음으로 표시</button><button class="btn small" data-q-drop>${icon("x")}버리기</button></div>
            </div>`,
          )
          .join("")
      : `<div class="empty"><b>승인 대기 중인 글이 없어요</b>요청서나 리마인드를 만들면 여기 모입니다. 외부 발송·이슈 쓰기는 모두 이곳을 거칩니다.</div>`;
    openDrawer({
      kicker: `<span class="muted" style="font-size:12px">${esc(model.project.name)}</span>`,
      title: "승인 대기열",
      sub: `<span class="muted" style="font-size:12px">고객사·팀으로 나가는 글은 사람이 읽고 보냅니다. 보낸 뒤 ‘발송했음’을 누르면 체크리스트에 요청일이 기록됩니다.</span>`,
      body,
    });
    const drawerBody = $("#drawer-body");
    for (const row of $$("[data-q]", drawerBody)) {
      const entry = queueOf(state.projectId).find((q) => q.id === row.dataset.q);
      $("[data-q-copy]", row).addEventListener("click", () =>
        copyText(entry.text),
      );
      $("[data-q-drop]", row).addEventListener("click", () => {
        removeFromQueue(entry.id);
        openQueue();
      });
      $("[data-q-sent]", row).addEventListener("click", () => {
        removeFromQueue(entry.id);
        if (entry.itemId) {
          const patch = {
            status: "requested",
            ball: "client",
            requested: realToday(),
            updated: realToday(),
          };
          if (entry.due) patch.due = entry.due;
          if (entry.receive) patch.receiveAt = entry.receive;
          setItem(
            entry.itemId,
            patch,
            `${entry.channel || "요청"}으로 ${entry.kind === "reminder" ? "리마인드" : "요청"} 발송`,
          );
        } else render();
        toast("발송 완료로 기록했습니다");
        openQueue();
      });
    }
  }

  // ---------------------------------------------------------------- SRS 생성 도우미
  const wiz = {
    step: 0,
    sources: null,
    platforms: null,
    features: null,
    integrations: null,
  };
  function openSrsWizard(preset = {}) {
    const model = getModel();
    const { project } = model;
    const seed = project.srs || {};
    const issueCount = model.forecast ? model.forecast.issues.length : 0;
    const sourceList = [
      {
        id: "contract",
        name: "계약서·견적 범위",
        desc: "범위 기준선",
        ok: model.checklist.some(
          (i) => i.id === "contract" && i.status === "confirmed",
        ),
      },
      {
        id: "meetings",
        name: "킥오프·정기 회의록",
        desc: "합의된 결정",
        ok: !!seed.meetings,
      },
      {
        id: "design",
        name: "화면 설계(Figma)",
        desc: "화면 목록과 흐름",
        ok: model.checklist.some(
          (i) => i.cat === "design" && i.status === "confirmed",
        ),
      },
      {
        id: "issues",
        name: `개발 이슈 ${issueCount ? `${issueCount}건` : ""}`,
        desc: issueCount ? "기능 묶음과 진행 상태" : "이슈 트래커 연결 전",
        ok: issueCount > 0,
      },
      {
        id: "policies",
        name: "정책 문서",
        desc: "약관·처리방침·환불",
        ok: model.checklist.some(
          (i) => i.cat === "policy" && i.status === "confirmed",
        ),
      },
      {
        id: "requests",
        name: "고객 요청 DB",
        desc: "고객사 답과 합의",
        ok: !!project.channels?.notion?.url,
      },
    ];
    if (!wiz.sources || preset.reset) {
      wiz.step = 0;
      wiz.sources = new Set(sourceList.filter((s) => s.ok).map((s) => s.id));
      wiz.platforms = new Set(seed.platforms || ["app", "admin", "server"]);
      wiz.features = new Set((seed.features || []).map((f) => f.id));
      wiz.integrations = new Set(
        model.checklist
          .filter((i) => i.cat === "accounts" && i.status !== "not_needed")
          .map((i) => i.id),
      );
    }
    const PLATFORMS = {
      app: "모바일 앱 (iOS·Android)",
      web: "고객 웹",
      admin: "관리자 웹",
      server: "서버·API",
    };
    const steps = ["자료", "범위", "초안"];
    const renderStep = () => {
      $("#modal-title").textContent = seed.exists
        ? "SRS 보완 도우미"
        : "SRS 생성 도우미";
      $("#modal-steps").innerHTML = steps
        .map(
          (s, i) =>
            `<span class="${i === wiz.step ? "on" : ""}">${i + 1}. ${s}</span>`,
        )
        .join("");
      let body = "";
      if (wiz.step === 0) {
        body = `${seed.exists ? `<div class="callout info" style="margin-bottom:12px">${icon("doc")}<span>이 프로젝트에는 SRS가 있습니다(${esc(seed.location || "")}). 도우미는 빠진 절을 찾아 보완 초안을 만듭니다.</span></div>` : `<div class="callout warn" style="margin-bottom:12px">${icon("alert")}<span>SRS가 없습니다. 연결된 자료로 초안을 만들고, 모르는 값은 (제안)으로 채운 뒤 고객사 확인을 받습니다.</span></div>`}
          <p class="soft" style="margin-top:0">초안의 근거로 쓸 자료를 고르세요. 연결 안 된 자료는 체크리스트에서 요청할 수 있습니다.</p>
          <div class="options">${sourceList
            .map(
              (s) =>
                `<label class="option"><input type="checkbox" data-src="${s.id}" ${wiz.sources.has(s.id) ? "checked" : ""}/><span><b>${esc(s.name)}</b><small>${esc(s.desc)} · ${s.ok ? "연결됨" : "없음"}</small></span></label>`,
            )
            .join("")}</div>`;
      } else if (wiz.step === 1) {
        const features = seed.features || [];
        const integrations = model.checklist.filter(
          (i) => i.cat === "accounts" && i.status !== "not_needed",
        );
        body = `<div class="section-title" style="margin-top:0">플랫폼</div><div class="options">${Object.entries(
          PLATFORMS,
        )
          .map(
            ([key, label]) =>
              `<label class="option"><input type="checkbox" data-pf="${key}" ${wiz.platforms.has(key) ? "checked" : ""}/><span><b>${esc(label)}</b></span></label>`,
          )
          .join("")}</div>
          <div class="section-title">기능 묶음 <span class="muted" style="font-weight:500">${seed.featureSource ? `· ${esc(seed.featureSource)}` : ""}</span></div><div class="options">${features
            .map(
              (f) =>
                `<label class="option"><input type="checkbox" data-ft="${esc(f.id)}" ${wiz.features.has(f.id) ? "checked" : ""}/><span><b>${esc(f.name)}</b><small>${esc(f.desc || "")}</small></span></label>`,
            )
            .join("")}</div>
          <div class="section-title">외부 연동 <span class="muted" style="font-weight:500">· 체크리스트 계정 항목에서</span></div><div class="options">${integrations
            .map(
              (i) =>
                `<label class="option"><input type="checkbox" data-in="${esc(i.id)}" ${wiz.integrations.has(i.id) ? "checked" : ""}/><span><b>${esc(i.title)}</b><small>${esc(STATUS[i.status].label)}</small></span></label>`,
            )
            .join("")}</div>`;
      } else {
        body = srsOutlineHtml(model, PLATFORMS);
      }
      $("#modal-body").innerHTML = body;
      $("#modal-foot").innerHTML =
        `<button class="btn" data-wiz-prev ${wiz.step === 0 ? "disabled" : ""}>이전</button>
        <div class="btn-row">${wiz.step < 2 ? `<button class="btn primary" data-wiz-next>${wiz.step === 1 ? `${icon("sparkles")}초안 만들기` : "다음"}</button>` : `<button class="btn" data-wiz-copy>${icon("copy")}Markdown 복사</button><button class="btn accent" data-wiz-queue data-internal>${icon("send")}고객 확인 요청 초안</button>`}</div>`;
      for (const input of $$("[data-src]"))
        input.addEventListener("change", () =>
          toggleSet(wiz.sources, input.dataset.src, input.checked),
        );
      for (const input of $$("[data-pf]"))
        input.addEventListener("change", () =>
          toggleSet(wiz.platforms, input.dataset.pf, input.checked),
        );
      for (const input of $$("[data-ft]"))
        input.addEventListener("change", () =>
          toggleSet(wiz.features, input.dataset.ft, input.checked),
        );
      for (const input of $$("[data-in]"))
        input.addEventListener("change", () =>
          toggleSet(wiz.integrations, input.dataset.in, input.checked),
        );
      $("[data-wiz-prev]")?.addEventListener("click", () => {
        wiz.step = Math.max(0, wiz.step - 1);
        renderStep();
      });
      $("[data-wiz-next]")?.addEventListener("click", () => {
        wiz.step += 1;
        renderStep();
      });
      $("[data-wiz-copy]")?.addEventListener("click", () =>
        copyText(srsMarkdown(model, PLATFORMS)),
      );
      $("[data-wiz-queue]")?.addEventListener("click", () => {
        const srsItem = model.checklist.find((i) => i.helper === "srs");
        addToQueue({
          kind: "request",
          itemId: srsItem?.id,
          title: "SRS 초안 확인 요청",
          to: project.clientContact || `${project.client} 담당자`,
          channel: RECEIVE[project.receiveDefault || "notion"].label,
          receive: project.receiveDefault || "notion",
          mode: "draft",
          due: F.addDays(realToday(), 5),
          text: requestText(
            model,
            {
              title: "요구사항 명세서(SRS) 초안",
              blocks: "개발 범위 확정",
              need: "초안의 (확인 요청) 표시 항목 답변, (제안) 값 확인",
              proposal: "답이 없는 (제안) 값은 초안대로 개발합니다",
            },
            {
              receive: project.receiveDefault || "notion",
              mode: "draft",
              due: F.addDays(realToday(), 5),
            },
          ),
        });
        if (srsItem && srsItem.status === "missing")
          setItem(
            srsItem.id,
            {
              status: "received",
              ball: "us",
              res: { label: "SRS 초안 (도우미)", url: "" },
              updated: realToday(),
            },
            "SRS 생성 도우미로 초안 작성",
          );
        toast("고객 확인 요청 초안을 승인 대기열에 넣었습니다");
        closeModal();
      });
      hydrateIcons($("#modal"));
    };
    $("#modal").classList.add("open");
    renderStep();
    $("[data-close-modal].icon-btn").focus();
  }
  const toggleSet = (set, key, on) => (on ? set.add(key) : set.delete(key));
  function closeModal() {
    $("#modal").classList.remove("open");
  }

  // SRS 초안 구조. 표시: 확인 요청(고객 답 필요) · 제안(PM이 채운 값) · 준비 필요(고객사가 준비) · 확정
  function srsSections(model, PLATFORMS) {
    const { project, checklist } = model;
    const seed = project.srs || {};
    const features = (seed.features || []).filter((f) =>
      wiz.features.has(f.id),
    );
    const integrations = checklist.filter((i) => wiz.integrations.has(i.id));
    const policies = checklist.filter((i) => i.cat === "policy");
    const tagOf = (status) =>
      status === "confirmed" ? "ok" : status === "missing" ? "prep" : "ask";
    const platforms = [...wiz.platforms].map((key) => PLATFORMS[key]);
    let fr = 0;
    return [
      {
        title: "1. 개요",
        items: [
          [`목적: ${project.summary}`, "ok"],
          [
            `플랫폼: ${platforms.join(", ") || "미정"}`,
            platforms.length ? "ok" : "ask",
          ],
          ["용어 정의 (고객사 업무 용어 그대로)", "ask"],
        ],
      },
      {
        title: "2. 사용자와 역할",
        items: (seed.roles || ["비회원", "회원", "관리자"]).map((role) => [
          role,
          "prop",
        ]),
      },
      {
        title: "3. 기능 요구사항",
        items: features.length
          ? features.flatMap((f) => {
              fr += 1;
              const code = `FR-${String(fr).padStart(2, "0")}`;
              return [
                [
                  `${code} ${f.name}${f.desc ? ` — ${f.desc}` : ""}`,
                  f.status || "prop",
                ],
              ];
            })
          : [["기능 묶음을 고르면 FR 번호가 붙습니다", "ask"]],
      },
      {
        title: "4. 화면 목록",
        items: [
          [
            wiz.sources.has("design")
              ? "화면 설계 기준 화면별 라우트와 상태"
              : "화면 설계 없음 — 기능 묶음 기준 화면 목록 (제안)",
            wiz.sources.has("design") ? "ok" : "prop",
          ],
        ],
      },
      {
        title: "5. 정책",
        items: policies.map((p) => [
          `${p.title}${p.res?.label ? ` (${p.res.label})` : ""}`,
          tagOf(p.status),
        ]),
      },
      {
        title: "6. 외부 연동",
        items: integrations.length
          ? integrations.map((i) => [i.title, tagOf(i.status)])
          : [["외부 연동 없음", "prop"]],
      },
      {
        title: "7. 비기능 요구사항",
        items: [
          ["지원 기기·OS 범위", "prop"],
          ["개인정보 보관·파기 기간", "ask"],
          ["성능 목표 (주요 화면 2초 안에 표시)", "prop"],
          ["접근성 기본 (글자 크기, 대비)", "prop"],
        ],
      },
      {
        title: "8. 검수 기준과 QA",
        items: [
          [
            `고객사 QA ${project.dates.qaStart ? `${F.monthDay(project.dates.qaStart)}~${F.monthDay(project.dates.qaEnd)}` : "기간 미정"}`,
            project.dates.qaStart ? "ok" : "ask",
          ],
          ["기능별 수용 기준(AC)은 FR마다 1개 이상", "prop"],
          ["하자 보수 기간", "ask"],
        ],
      },
      {
        title: "9. 범위 밖과 변경 관리",
        items: [
          [
            "이 문서에 없는 기능은 변경 요청으로 받고 일정·비용 영향을 먼저 알린다",
            "prop",
          ],
          ["변경 요청 창구: 고객 요청 DB", "prop"],
        ],
      },
    ];
  }
  const SRS_TAG = {
    ok: "확정",
    ask: "확인 요청",
    prop: "제안",
    prep: "준비 필요",
  };
  function srsOutlineHtml(model, PLATFORMS) {
    const sections = srsSections(model, PLATFORMS);
    const all = sections.flatMap((s) => s.items);
    const count = (tag) => all.filter(([, t]) => t === tag).length;
    return `<div class="callout info" style="margin-bottom:12px">${icon("sparkles")}<span>초안 ${all.length}줄 · 확인 요청 ${count("ask")} · 제안 ${count("prop")} · 준비 필요 ${count("prep")} · 확정 ${count("ok")}. 고객사에는 결론만 담은 이 구조로 보내고, 확인 요청 항목만 답을 받습니다.</span></div>
      <div class="srs-out">${sections
        .map(
          (s) =>
            `<h3>${esc(s.title)}</h3><ul>${s.items.map(([text, tag]) => `<li>${esc(text)}<span class="srs-tag ${tag}">${SRS_TAG[tag]}</span></li>`).join("")}</ul>`,
        )
        .join("")}</div>`;
  }
  function srsMarkdown(model, PLATFORMS) {
    const { project } = model;
    const sections = srsSections(model, PLATFORMS);
    return [
      `# ${project.name} 요구사항 명세서 (초안)`,
      "",
      `작성 ${realToday()} · 표시: (확인 요청) 고객 답 필요, (제안) ${company} 제안값, (준비 필요) 고객사 준비`,
      "",
    ]
      .concat(
        sections.flatMap((s) => [
          `## ${s.title.replace(/^\d+\. /, "")}`,
          ...s.items.map(
            ([text, tag]) =>
              `- ${text}${tag === "ok" ? "" : ` (${SRS_TAG[tag]})`}`,
          ),
          "",
        ]),
      )
      .join("\n");
  }

  // ---------------------------------------------------------------- 화면: 일정·속도
  function renderSchedule(model) {
    const { project } = model;
    const base = model.forecast;
    if (!base?.project) {
      return `<div class="view-head"><div><h1>일정·속도</h1><p>${esc(project.name)}</p></div></div>
        <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>계획 일정</h2></div>${timelineHtml(model)}</section>
        <section class="card"><div class="empty"><b>이슈 트래커가 아직 연결되지 않았어요</b>개발 이슈가 쌓이면 처리·유입 속도로 완료일을 예측합니다.<br/>GitHub 저장소를 정한 뒤 project.json의 github.repo에 저장소(owner/repo)를 적고 <code>pm sync --project ${esc(project.id)}</code>를 실행하세요.</div></section>`;
    }
    const s = state.scenario;
    const scenarioOn = s.velocityPct || s.inflowPct || s.descope;
    const f = scenarioOn ? forecastFor(project, s) : base;
    const p = f.project;
    const st = FORECAST_STATUS[p.status];
    const rangeStart = p.optimistic < p.target ? p.optimistic : p.target;
    const rangeEnd =
      p.pessimistic > p.target
        ? F.addDays(p.pessimistic, 2)
        : F.addDays(p.target, 2);
    const rspan = Math.max(1, F.daysBetween(rangeStart, rangeEnd));
    const rx = (date) => `${(F.daysBetween(rangeStart, date) / rspan) * 100}%`;
    const gap = p.requiredVelocity ? p.requiredVelocity - p.velocity : 0;

    return `
      <div class="view-head">
        <div><h1>일정·속도</h1><p>GitHub 이슈 ${fmt(f.issues.length)}건 · ${esc(syncLabel(f.syncedAt))} 동기화 · 최근 4주 가중 평균, 낙관·비관 ±40%</p></div>
        <div>${chip(st, `${p.targetLabel} 예측 ${st.label}`)}</div>
      </div>
      <div class="forecast-strip">
        <div><div class="k">새 이슈가 멈추면 완료</div><div class="v num">${F.shortDate(p.expected)}</div>
          <div class="range" aria-label="${esc(`낙관 ${F.shortDate(p.optimistic)}, 비관 ${F.shortDate(p.pessimistic)}, 목표 ${F.shortDate(p.target)}`)}"><span class="track"></span><span class="band" style="left:${rx(p.optimistic)};width:calc(${rx(p.pessimistic)} - ${rx(p.optimistic)})"></span><span class="tgt" style="left:${rx(p.target)}" title="목표"></span><span class="pt" style="left:${rx(p.expected)}"></span></div>
          <div class="s">낙관 ${F.monthDay(p.optimistic)} · 비관 ${F.monthDay(p.pessimistic)} · 검은 선 목표 ${F.monthDay(p.target)}</div></div>
        <div><div class="k">지금 추세면 ${F.monthDay(p.target)}에 남는 이슈</div><div class="v num">~${fmt(p.remainingAtTarget)}건</div><div class="s">${p.netFinish ? `유입까지 감안한 완료 ${F.shortDate(p.netFinish)}` : "유입이 처리보다 많아 끝나는 날을 계산할 수 없음"}</div></div>
        <div><div class="k">주간 처리 / 유입</div><div class="v num">${fmt(p.velocity)} / ${fmt(p.inflow)}건</div><div class="s">최근 ${p.weeks}주 가중 평균 · 남은 이슈 ${fmt(p.remaining)}건</div></div>
        <div><div class="k">${F.monthDay(p.target)}에 맞추려면</div><div class="v num">주 ${fmt(p.requiredVelocity)}건</div><div class="s">${gap > 0 ? `지금보다 주 ${fmt(gap)}건(${fmt((gap / p.velocity) * 100)}%) 더 닫거나 범위를 줄여야 함` : "지금 속도로 충분"}</div></div>
      </div>
      <div class="grid g-12">
        <section class="card span-12">
          <div class="card-head"><h2>남은 이슈 추이</h2><span class="sub">에픽·descope·${F.monthDay(p.target)} 이후 마일스톤 제외</span></div>
          <div class="chart-legend"><span><i class="key line" style="background:var(--s1)"></i>실적</span><span><i class="key line" style="background:var(--s-neutral)"></i>새 이슈가 없을 때</span><span><i class="key line" style="background:var(--s2)"></i>지금 추세가 이어질 때</span>${scenarioOn ? '<span class="chip violet">가정 적용 중</span>' : ""}</div>
          <div class="chart" id="chart-remaining"></div>
          <details class="table-toggle"><summary class="muted" style="font-size:12px;cursor:pointer">표로 보기</summary>${remainingTable(f)}</details>
        </section>
        <section class="card span-7">
          <div class="card-head"><h2>가정해 보기</h2><button class="link-btn" data-reset-scenario>초기화</button></div>
          <div class="scenario">
            <label class="slider">처리 속도 <output>${s.velocityPct > 0 ? "+" : ""}${s.velocityPct}%</output><input type="range" min="-50" max="100" step="5" value="${s.velocityPct}" data-scn="velocityPct"/></label>
            <label class="slider">새 이슈 유입 <output>${s.inflowPct > 0 ? "+" : ""}${s.inflowPct}%</output><input type="range" min="-100" max="50" step="5" value="${s.inflowPct}" data-scn="inflowPct"/></label>
            <label class="slider">범위 조정 <output>-${s.descope}건</output><input type="range" min="0" max="${Math.max(10, base.project.remaining)}" step="1" value="${s.descope}" data-scn="descope"/></label>
          </div>
          <div class="scenario-result">${scenarioOn ? `가정대로면 <b>${F.monthDay(p.target)}에 ~${fmt(p.remainingAtTarget)}건</b>(지금 ${fmt(base.project.remainingAtTarget)}건) · 새 이슈가 멈추면 ${F.shortDate(p.expected)} 완료 · 상태 ${chip(st)}` : `슬라이더로 인원 추가(속도), 내부 QA 정리(유입), 범위 조정(descope)의 효과를 봅니다. ${base.project.inflow > base.project.velocity ? `지금은 <b>유입이 처리보다 주 ${fmt(base.project.inflow - base.project.velocity)}건 많아</b> 남은 이슈가 늘고 있어요.` : ""}`}</div>
          <div class="btn-row" style="margin-top:10px" data-internal><button class="btn small" data-ask-limi="${esc(`이 가정으로 ${F.monthDay(p.target)} 맞추려면 어떻게 해야 해? (속도 ${s.velocityPct}%, 유입 ${s.inflowPct}%, 범위 -${s.descope}건)`)}">${icon("chat")}리미에게 해석 묻기</button></div>
        </section>
        <section class="card span-5">
          <div class="card-head"><h2>스프린트</h2><span class="sub">GitHub 마일스톤</span></div>
          <div class="bar-list">${f.views
            .map(
              (v) =>
                `<div class="bar-item"><span class="name" title="${esc(v.title)}">${v.isCurrent ? "▶ " : ""}${esc(v.title.split(" · ")[0])}</span><span class="trackbar" title="${esc(`${v.title} ${v.closed}/${v.total}`)}"><span style="width:${v.percent}%;background:${v.isLate ? "var(--crit)" : "var(--accent)"}"></span></span><span class="val">${v.closed}/${v.total}${v.isLate ? " ⚠" : ""}</span></div>`,
            )
            .join("")}</div>
          <div class="card-foot">⚠ 마감이 지났는데 열린 이슈가 있는 마일스톤. ▶ 진행 중.</div>
        </section>
        <section class="card span-12">
          <div class="card-head"><h2>주간 흐름</h2><span class="sub">스프린트 주(월~일)별 새로 생긴 이슈와 닫은 이슈</span></div>
          <div class="chart-legend"><span><i class="key" style="background:var(--s1)"></i>완료</span><span><i class="key" style="background:var(--s2)"></i>새 이슈</span><span><i class="key line" style="background:var(--ink);height:2px"></i>${F.monthDay(p.target)}에 맞추는 데 필요한 주간 처리량</span></div>
          <div class="chart" id="chart-flow"></div>
        </section>
      </div>`;
  }

  function remainingTable(f) {
    const rows = [];
    const map = (series) => new Map(series.map((pt) => [pt.x, pt.y]));
    const a = map(f.chart.actual);
    const n = map(f.chart.noNewWork);
    const t = map(f.chart.trend);
    const days = [...new Set([...a.keys(), ...n.keys(), ...t.keys()])].sort();
    for (const day of days)
      if (F.weekdayOf(day) === 1 || day === f.today)
        rows.push(
          `<tr><td>${F.shortDate(day)}</td><td>${a.get(day) ?? ""}</td><td>${n.get(day) ?? ""}</td><td>${t.get(day) ?? ""}</td></tr>`,
        );
    return `<table class="data-table"><thead><tr><th>날짜</th><th>실적</th><th>새 이슈 없을 때</th><th>지금 추세</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  }

  function mountScheduleCharts(model) {
    const base = model.forecast;
    if (!base?.project) return;
    const s = state.scenario;
    const f =
      s.velocityPct || s.inflowPct || s.descope
        ? forecastFor(model.project, s)
        : base;
    const p = f.project;
    const css = getComputedStyle(document.documentElement);
    const color = (name) => css.getPropertyValue(name).trim();
    const end = [p.target, f.chart.noNewWork.at(-1)?.x]
      .filter(Boolean)
      .sort()
      .at(-1);
    const remainingEl = $("#chart-remaining");
    if (remainingEl)
      lineChart(remainingEl, {
        label: "남은 이슈 추이",
        start: f.trackingStart,
        end: F.addDays(end, 1),
        series: [
          {
            key: "actual",
            name: "실적",
            color: color("--s1"),
            points: f.chart.actual,
            area: true,
            endLabel: `오늘 ${p.remaining}`,
            labelLeft: true,
          },
          {
            key: "none",
            name: "새 이슈가 없을 때",
            color: color("--s-neutral"),
            dash: true,
            points: f.chart.noNewWork,
            endLabel:
              f.chart.noNewWork.at(-1)?.y === 0
                ? `${F.monthDay(p.expected)} 완료`
                : "",
          },
          {
            key: "trend",
            name: "지금 추세",
            color: color("--s2"),
            dash: true,
            points: f.chart.trend,
            endLabel: `~${p.remainingAtTarget}`,
          },
        ],
        markers: [
          { date: f.today, label: "오늘", cls: "today-line", anchor: "end" },
          { date: p.target, label: `${p.targetLabel} ${F.monthDay(p.target)}` },
        ],
      });
    const flowEl = $("#chart-flow");
    if (flowEl)
      columnChart(flowEl, {
        label: "주간 흐름",
        series: [
          { key: "done", name: "완료", color: color("--s1") },
          { key: "opened", name: "새 이슈", color: color("--s2") },
        ],
        groups: f.flow.map((w) => ({
          name: w.name,
          title: `${w.name} · ${F.monthDay(w.start)}~${F.monthDay(w.end)}`,
          partial: w.partial,
          values: { done: w.done, opened: w.opened },
          note: w.canceled ? `취소 ${w.canceled}건` : "",
        })),
        refLine: p.requiredVelocity
          ? {
              value: p.requiredVelocity,
              label: `필요 주 ${fmt(p.requiredVelocity)}건`,
            }
          : null,
      });
  }

  // ---------------------------------------------------------------- 화면: 이슈
  function renderIssues(model) {
    const { project, forecast } = model;
    if (!forecast) {
      return `<div class="view-head"><div><h1>이슈</h1></div></div><section class="card"><div class="empty"><b>이슈 트래커가 아직 연결되지 않았어요</b>리소스·연결 화면에서 저장소를 연결하세요.</div></section>`;
    }
    const f = state.issues;
    const all = forecast.issues;
    const milestoneName = new Map(
      forecast.views.map((v) => [v.number, v.title.split(" · ")[0]]),
    );
    const labels = [...new Set(all.flatMap((i) => i.labels))].sort();
    const assignees = [...new Set(all.flatMap((i) => i.assignees))].sort();
    const q = f.q.trim().toLowerCase();
    const list = all
      .filter((i) => f.state === "all" || i.state === f.state)
      .filter(
        (i) =>
          f.milestone === "all" ||
          String(i.milestone ?? "none") === f.milestone,
      )
      .filter((i) => f.label === "all" || i.labels.includes(f.label))
      .filter(
        (i) =>
          f.assignee === "all" ||
          (f.assignee === "none"
            ? !i.assignees.length
            : i.assignees.includes(f.assignee)),
      )
      .filter((i) => !q || `#${i.number} ${i.title}`.toLowerCase().includes(q))
      .sort((a, b) => b.number - a.number);
    const open = all.filter((i) => i.state === "open");
    const nowMs = new Date(forecast.syncedAt).getTime();
    const age = (i) =>
      Math.floor((nowMs - new Date(i.createdAt).getTime()) / F.DAY_MS);
    const byAssignee = assignees
      .map((name) => ({
        name,
        n: open.filter((i) => i.assignees.includes(name)).length,
      }))
      .concat([
        {
          name: "담당 없음",
          n: open.filter((i) => !i.assignees.length).length,
        },
      ])
      .filter((r) => r.n)
      .sort((a, b) => b.n - a.n);
    const maxA = Math.max(1, ...byAssignee.map((r) => r.n));
    const clientLabels = project.clientLabels || [];
    const waitingClient = open.filter((i) =>
      i.labels.some((l) => clientLabels.includes(l)),
    );
    const bugs = open.filter((i) => i.labels.includes("bug")).length;
    const old = open.filter((i) => age(i) > 14).length;
    const repoUrl = project.github.repoUrl;
    const option = (value, label, current) =>
      `<option value="${esc(value)}" ${String(current) === String(value) ? "selected" : ""}>${esc(label)}</option>`;
    return `
      <div class="view-head"><div><h1>이슈</h1><p>GitHub ${esc(forecast.syncedAt ? syncLabel(forecast.syncedAt) : "")} 스냅샷 · 열린 이슈 ${fmt(open.length)}건</p></div><a class="btn" href="${esc(repoUrl)}/issues" target="_blank" rel="noopener">${icon("ext")}GitHub에서 열기</a></div>
      <div class="stats" style="margin-bottom:16px">
        <div class="card stat"><div class="stat-label">열린 이슈</div><div class="stat-value num">${fmt(open.length)}</div><div class="stat-note">버그 ${fmt(bugs)} · 기능 ${fmt(open.filter((i) => i.labels.includes("enhancement")).length)}</div></div>
        <div class="card stat"><div class="stat-label">고객사·논의 대기</div><div class="stat-value num">${fmt(waitingClient.length)}</div><div class="stat-note">${clientLabels.map((l) => `‘${esc(l)}’`).join(", ")} 라벨</div></div>
        <div class="card stat"><div class="stat-label">2주 넘게 열린 이슈</div><div class="stat-value num">${fmt(old)}</div><div class="stat-note">만든 날부터 15일 이상</div></div>
        <div class="card stat"><div class="stat-label">담당 없음</div><div class="stat-value num">${fmt(open.filter((i) => !i.assignees.length).length)}</div><div class="stat-note">배정이 필요한 이슈</div></div>
      </div>
      <div class="grid g-12">
        <section class="card span-4"><div class="card-head"><h2>담당자별 열린 이슈</h2></div><div class="bar-list">${byAssignee
          .map(
            (r) =>
              `<div class="bar-item"><span class="name" title="${esc(r.name)}">${esc(r.name)}</span><span class="trackbar"><span style="width:${(r.n / maxA) * 100}%;background:var(--accent)"></span></span><span class="val">${r.n}</span></div>`,
          )
          .join("")}</div></section>
        <section class="card span-8">
          <div class="filters" style="margin-bottom:10px">
            <div class="seg" role="group" aria-label="상태">${["open", "closed", "all"].map((key) => `<button data-istate="${key}" aria-pressed="${f.state === key}">${{ open: "열림", closed: "닫힘", all: "전체" }[key]}</button>`).join("")}</div>
            <label class="sr-only" for="i-ms">마일스톤</label><select id="i-ms" class="search" style="min-width:0">${option("all", "모든 마일스톤", f.milestone)}${forecast.views.map((v) => option(v.number, v.title.split(" · ")[0], f.milestone)).join("")}${option("none", "마일스톤 없음", f.milestone)}</select>
            <label class="sr-only" for="i-lb">라벨</label><select id="i-lb" class="search" style="min-width:0">${option("all", "모든 라벨", f.label)}${labels.map((l) => option(l, l, f.label)).join("")}</select>
            <label class="sr-only" for="i-as">담당자</label><select id="i-as" class="search" style="min-width:0">${option("all", "모든 담당자", f.assignee)}${assignees.map((a) => option(a, a, f.assignee)).join("")}${option("none", "담당 없음", f.assignee)}</select>
            <label class="sr-only" for="i-q">이슈 찾기</label><input id="i-q" class="search" type="search" placeholder="번호·제목" value="${esc(f.q)}"/>
          </div>
          <div class="muted" style="font-size:12px;margin-bottom:6px">${fmt(list.length)}건${list.length > 80 ? " 중 최근 80건" : ""}</div>
          <div style="overflow-x:auto"><table class="issue-table"><thead><tr><th>번호</th><th>제목</th><th class="c-ms">마일스톤</th><th class="c-as">담당</th><th>경과</th></tr></thead><tbody>${list
            .slice(0, 80)
            .map(
              (i) =>
                `<tr><td class="no"><a href="${esc(repoUrl)}/issues/${i.number}" target="_blank" rel="noopener">#${i.number}</a></td><td>${esc(i.title)}<div>${i.labels.map((l) => `<span class="lbl-chip ${l === "bug" ? "bug" : clientLabels.includes(l) ? "client" : ""}">${esc(l)}</span>`).join("")}</div></td><td class="c-ms soft">${esc(milestoneName.get(i.milestone) || "-")}</td><td class="c-as soft">${esc(i.assignees.join(", ") || "-")}</td><td class="num soft">${i.state === "open" ? `${age(i)}일` : "닫힘"}</td></tr>`,
            )
            .join("")}</tbody></table></div>
        </section>
      </div>`;
  }

  // ---------------------------------------------------------------- 화면: 리소스·연결
  function renderResources(model) {
    const { project, forecast } = model;
    const resources = (project.resources || []).map((r) => ({ ...r, url: resourceUrl(project, r.id) ?? r.url }));
    const statusChip = (r) =>
      r.url
        ? chip({ cls: "good", icon: "ok" }, r.sync ? "동기화" : "링크 연결")
        : chip({ cls: "crit", icon: "plug" }, "연결 안 됨");
    const hasKey = (() => {
      try {
        return !!localStorage.getItem("pm-dashboard:anthropic-key");
      } catch {
        return false;
      }
    })();
    const srs = project.srs || {};
    return `
      <div class="view-head"><div><h1>리소스·연결</h1><p>원본은 각 도구에 두고, 대시보드는 위치와 상태만 모읍니다. 체크리스트 항목은 여기 연결한 리소스를 가리킵니다.</p></div></div>
      <div class="grid g-12" style="margin-bottom:16px">
        ${docsCardHtml()}
        <section class="card span-8">
          <div class="card-head"><h2>요구사항 명세 (SRS)</h2>${srs.exists ? chip({ cls: "info", icon: "inbox" }, "있음 · 고객 확인 중") : chip({ cls: "crit", icon: "alert" }, "없음")}</div>
          ${
            srs.exists
              ? `<p style="margin:0 0 10px">${esc(srs.summary || "")}</p>${srs.counts ? `<div class="btn-row" style="margin-bottom:12px"><span class="srs-tag ask" style="font-size:12px;padding:3px 8px">확인 요청 ${srs.counts.ask}</span><span class="srs-tag prop" style="font-size:12px;padding:3px 8px">제안 ${srs.counts.prop}</span><span class="srs-tag prep" style="font-size:12px;padding:3px 8px">준비 필요 ${srs.counts.prep}</span></div>` : ""}`
              : `<p style="margin:0 0 12px">SRS가 없으면 범위 다툼과 재작업이 생깁니다. 계약 범위·회의록·이슈로 초안을 만들고 고객 확인을 받으세요.</p>`
          }
          <div class="btn-row">${srs.url ? `<a class="btn" href="${esc(srs.url)}" target="_blank" rel="noopener">${icon("ext")}SRS 열기</a>` : ""}<button class="btn accent" data-srs-wizard>${icon("sparkles")}${srs.exists ? "SRS 보완 도우미" : "SRS 생성 도우미"}</button></div>
        </section>
        <section class="card span-4">
          <div class="card-head"><h2>연결 상태</h2></div>
          <div class="list">
            <div class="list-row"><div><div class="t">GitHub 이슈</div><div class="d">${forecast ? `${esc(syncLabel(forecast.syncedAt))} 스냅샷 · ${fmt(forecast.issues.length)}건` : "연결 전"}</div></div>${forecast ? chip({ cls: "good", icon: "ok" }, "동기화") : chip({ cls: "crit", icon: "plug" }, "없음")}</div>
            <div class="list-row"><div><div class="t">고객 요청 DB</div><div class="d">${project.channels?.notion?.url ? "링크 연결 · 상태는 체크리스트에서 관리" : "연결 전"}</div></div>${project.channels?.notion?.url ? chip({ cls: "info", icon: "link" }, "링크") : chip({ cls: "crit", icon: "plug" }, "없음")}</div>
            <div class="list-row" data-internal><div><div class="t">리미 (Claude)</div><div class="d">${hasKey ? "Claude 연결됨" : "내장 모드 · 대화창에서 키를 넣으면 Claude로 답합니다"}</div></div>${hasKey ? chip({ cls: "good", icon: "ok" }, "연결") : chip({ cls: "neutral", icon: "minus" }, "내장")}</div>
          </div>
        </section>
      </div>
      <div class="res-grid">${resources
        .map(
          (r) =>
            `<div class="res-card" data-res="${esc(r.id)}"><div class="res-icon" aria-hidden="true">${esc(r.glyph || r.name.slice(0, 1))}</div><div style="min-width:0"><h3>${esc(r.name)}</h3><p>${esc(r.desc || "")}</p><div class="actions">${statusChip(r)}${r.url ? `<a class="link-btn" href="${esc(r.url)}" target="_blank" rel="noopener">열기 ${icon("ext")}</a>` : ""}<button class="link-btn" data-res-link="${esc(r.id)}">${r.url ? "링크 바꾸기" : "링크 연결"}</button></div></div></div>`,
        )
        .join("")}</div>`;
  }

  function linkResource(resId) {
    const project = PROJECTS[state.projectId];
    const r = project.resources.find((x) => x.id === resId);
    openDrawer({
      kicker: '<span class="muted" style="font-size:12px">리소스 연결</span>',
      title: r.name,
      sub: `<span class="muted" style="font-size:12px">${esc(r.desc || "")}</span>`,
      body: `<label class="field" style="margin-top:0">링크<input id="res-url" placeholder="https://" value="${esc(resourceUrl(project, resId) || r.url || "")}"/></label><div class="btn-row" style="margin-top:12px"><button class="btn accent" id="res-save">저장</button></div><p class="muted" style="font-size:12px">링크만 저장합니다. 비밀번호·API 키 같은 값은 넣지 마세요.</p>`,
    });
    $("#res-save").addEventListener("click", () => {
      const url = $("#res-url").value.trim();
      setResource(resId, /^https?:\/\//.test(url) ? url : "");
      closeDrawer();
      render();
      toast("링크를 연결했습니다");
    });
  }


  // ---------------------------------------------------------------- 킥오프 진행·고객사 요청·계약·문서
  const Docs = window.PMDocs;
  const LIB = window.PM_LIBRARY || { features: [], categories: [] };
  const featureLabel = (key) => LIB.features.find((f) => f.key === key)?.label || key;

  function stepperHtml(model) {
    const ko = model.kickoff;
    return `<ol class="stepper">${ko.stages
      .map((st, i) => {
        const cls = st.complete ? "done" : ko.current?.id === st.id ? "now" : "";
        const pct = st.total ? Math.round((st.done / st.total) * 100) : 100;
        return `<li class="step-item ${cls}"><span class="step-no">${st.complete ? icon("ok") : i + 1}</span><div style="min-width:0;flex:1"><b>${esc(st.name)}</b><span class="muted num"> ${st.done}/${st.total}</span><div class="step-hint">${esc(st.hint)}</div><div class="meter"><span style="width:${pct}%;background:${st.complete ? "var(--good)" : "var(--accent)"}"></span></div></div></li>`;
      })
      .join("")}</ol>`;
  }

  function weekHtml(model, limit = 8) {
    const week = model.thisWeek;
    if (!week.length) return '<div class="empty"><b>이번 주 할 일이 없어요</b>요청한 자료의 회신을 기다리는 중입니다.</div>';
    return `<div class="list">${week
      .slice(0, limit)
      .map((a) => {
        const target = a.item ? `data-item="${esc(a.item)}"` : a.type === "contract" ? 'data-go="kickoff" data-anchor="contract"' : a.type === "sprint" ? 'data-go="schedule"' : "";
        return `<button class="row-btn list-row" ${target}><div><div class="t">${a.late ? `<span class="chip crit" style="margin-right:6px">${icon("alert")}늦음</span>` : ""}${esc(a.text)}</div></div><span class="muted num" style="font-size:12px">${a.date ? F.monthDay(a.date) : ""}</span></button>`;
      })
      .join("")}${week.length > limit ? `<div class="card-foot">외 ${week.length - limit}개</div>` : ""}</div>`;
  }

  function scopeHtml(project) {
    const features = project.scope?.features || [];
    return `<div class="btn-row">${features.length ? features.map((key) => `<span class="chip outline">${esc(featureLabel(key))}</span>`).join("") : '<span class="muted">아직 고르지 않았어요</span>'}</div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">범위를 바꾸면 체크리스트와 고객사 요청 목록이 같이 바뀝니다. Claude에게 “결제 기능 추가해 줘”라고 하거나 <code>pm scope --add payment</code>.</p>`;
  }

  function contractHtml(model) {
    const c = model.contract;
    const review = model.project.contract?.review || [];
    if (!c) return "";
    const rows = review
      .map((r) => {
        const st = r.status || "unchecked";
        const control = SERVER
          ? `<select class="search" style="min-width:0" data-review="${esc(r.id)}" aria-label="${esc(r.title)} 상태">${Object.entries(Core.CONTRACT_REVIEW)
              .map(([key, meta]) => `<option value="${key}" ${key === st ? "selected" : ""}>${esc(meta.label)}</option>`)
              .join("")}</select>`
          : chip(Core.CONTRACT_REVIEW[st]);
        return `<tr><td><div class="title">${esc(r.title)}</div><div class="note">${esc(r.note || r.why || "")}</div></td><td style="width:130px">${control}</td></tr>`;
      })
      .join("");
    const pays = c.payments
      .map(
        (p) =>
          `<div class="list-row"><div><div class="t">${esc(p.name)}${p.ratio ? ` <span class="muted num">${p.ratio}%</span>` : ""}</div><div class="d">${esc(p.trigger)}${p.dueDate ? ` · ${F.shortDate(p.dueDate)} 예정` : ""}${p.paidAt ? ` · ${p.paidAt} 받음` : ""}</div></div><div class="btn-row">${chip({ cls: p.status === "paid" ? "good" : p.status === "invoiced" ? "warn" : "neutral", icon: p.status === "paid" ? "ok" : "clock" }, Core.PAYMENT_STATUS[p.status])}${SERVER && p.status !== "paid" ? `<button class="btn small" data-pay="${esc(p.name)}" data-pay-status="${p.status === "planned" ? "invoiced" : "paid"}">${p.status === "planned" ? "청구함" : "받음"}</button>` : ""}</div></div>`,
      )
      .join("");
    return `<section class="card span-12" id="contract" data-internal>
      <div class="card-head"><h2>계약 점검</h2><span class="sub">${c.signed ? `체결 ${esc(c.signedAt)}` : "체결 전"} · 있음 ${c.review.ok} · 불리·모호 ${c.review.risk} · 없음 ${c.review.missing} · 확인 전 ${c.review.unchecked}</span></div>
      <div class="grid g-12"><div class="span-8"><table class="check-table" style="table-layout:auto"><tbody>${rows}</tbody></table>
      <p class="muted" style="font-size:12px">놓치기 쉬운 것을 점검하는 목록이고 법무 검토를 대신하지 않습니다. ${SERVER ? "" : "상태를 바꾸려면 pm serve로 열거나 Claude에게 말하세요."}</p></div>
      <div class="span-4"><h3 style="font-size:13px;margin:0 0 6px">대금 단계</h3><div class="list">${pays || '<div class="empty">대금 단계가 없어요</div>'}</div>
      <p class="muted" style="font-size:12px">잔금은 최종 검수 완료와 연결해 둡니다. 고객사 대기가 길어지면 검수일과 함께 밀립니다.</p></div></div>
    </section>`;
  }

  function infoHtml(project, item) {
    const lines = (item.fields || []).map(
      (f) =>
        `<div class="info-line"><span class="lbl">${esc(f.label)}</span> ${f.answer ? `<span class="ans">${esc(f.answer)}</span>` : f.proposal ? `<span class="prop">(제안) ${esc(Core.fill(f.proposal, project))}</span>` : '<span class="muted">—</span>'}</div>`,
    );
    if (item.answer) lines.push(`<div class="info-line"><span class="ans">ㄴ ${esc(item.answer)}</span></div>`);
    return lines.join("") || '<span class="muted">—</span>';
  }

  function renderRequests(model) {
    const { project, sheet } = model;
    const groups = sheet.rounds.map((r) => ({ ...r, sent: true }));
    if (!CLIENT && sheet.pending.length) groups.push({ date: null, items: sheet.pending, sent: false });
    const catName = (id) => project.categories.find((c) => c.id === id)?.name || id;
    const groupHtml = (g, idx) => {
      const title = g.sent ? (idx === 0 ? `요청 ${g.date ? F.shortDate(g.date) : ""}` : `추가 확인 요청 ${F.shortDate(g.date)}`) : "이번에 보낼 요청";
      let lastCat = null;
      const rows = g.items
        .map((item) => {
          const showCat = item.cat !== lastCat;
          lastCat = item.cat;
          const star = g.items.some((i) => i.cat === item.cat && i.priority);
          return `<tr ${CLIENT ? "" : `data-answer="${esc(item.id)}" tabindex="0"`}>
            <td>${showCat ? `<b>${esc(catName(item.cat))}</b>${star ? " ⭐" : ""}` : ""}</td>
            <td><div class="title">${esc(item.title)}</div><div style="margin-top:4px">${chip(STATUS[item.status])}</div></td>
            <td>${esc(item.need ? Core.fill(item.need, project) : "")}${item.blocksDate ? `<div class="note">${esc(item.blocks)}(${F.monthDay(item.blocksDate)}) 전에 필요</div>` : ""}</td>
            <td>${infoHtml(project, item)}</td>
            <td>${item.askBy && item.status !== "confirmed" ? `<div class="wait ${item.late || item.overdue ? "late" : ""}">회신 ${F.shortDate(item.askBy)}까지</div>` : ""}${item.waitDays != null ? `<div class="note">요청 D+${item.waitDays}</div>` : ""}${item.note ? `<div class="note">${esc(item.note)}</div>` : ""}</td>
          </tr>`;
        })
        .join("");
      return `<div class="check-group"><h3>${esc(title)} <span class="muted num" style="font-weight:500">${g.items.length}</span></h3>
        ${g.sent && idx > 0 ? `<p class="muted" style="font-size:12px;margin:-4px 0 8px">${esc(Docs.NEXT_GUIDE)}</p>` : ""}
        <div style="overflow-x:auto"><table class="check-table sheet-table"><thead><tr><th class="col-cat">분야</th><th class="col-item">항목</th><th class="col-why">확인/요청 내용</th><th>정보</th><th class="col-note">비고</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    };
    const st = sheet.stats;
    return `
      <div class="view-head">
        <div><h1>${CLIENT ? "개발 관련 요청사항" : "고객사 확인 요청"}</h1><p>${CLIENT ? `${esc(project.name)} 개발에 필요한 자료와 확인 사항입니다.` : "개발 범위로 정해진 목록입니다. 고객사에 안내하고 답을 모읍니다."}</p></div>
        <div class="btn-row" data-internal>
          <button class="btn" data-doc="sheet-md">${icon("copy")}Markdown</button>
          <button class="btn" data-doc="sheet-notion">${icon("doc")}Notion 형식</button>
          ${sheet.pending.length ? `<button class="btn accent" data-mark-sent>${icon("send")}보낸 것으로 표시 (${sheet.pending.length})</button>` : ""}
        </div>
      </div>
      <div class="callout info" style="margin-bottom:12px">${icon("doc")}<span>${esc(Docs.FIRST_GUIDE)}</span></div>
      <div class="filters">
        <div class="legend-row"><span class="prop">분홍</span> 우리가 채운 제안값 <span class="ans">노랑</span> 고객사 답 <span>⭐ 일정상 먼저 필요</span></div>
        <span style="flex:1"></span>
        <span class="meta-pill num">보냄 ${st.sent}/${st.total} · 답 ${st.answered} · 기다림 ${st.waiting}${CLIENT ? "" : ` · 보낼 것 ${sheet.pending.length}`}</span>
      </div>
      ${groups.length ? groups.map(groupHtml).join("") : '<section class="card"><div class="empty"><b>요청할 항목이 없어요</b>개발 범위를 정하면 목록이 만들어집니다.</div></section>'}
      ${CLIENT ? "" : '<p class="muted" style="font-size:12px">항목을 누르면 고객사 답을 적을 수 있습니다. 고객사 공유본(pm build --client)에는 보낸 항목만 나옵니다.</p>'}`;
  }

  function saveAnswers(itemId, answers, note, confirm) {
    const project = PROJECTS[state.projectId];
    const base = project.checklist.find((i) => i.id === itemId);
    if ([...Object.values(answers), note].some((v) => /비밀번호|password/i.test(v || ""))) {
      toast("비밀번호는 적지 마세요. 계정은 권한 초대로 받습니다");
      return false;
    }
    const status = confirm ? "confirmed" : "received";
    const patch = { status, answeredAt: realToday(), updated: realToday() };
    if (!confirm) patch.ball = "us";
    if (note) patch.answer = note;
    const log = `고객사 답 기록 · ${STATUS[status].label}`;
    if (SERVER) {
      for (const f of base.fields || []) if (f.label in answers) f.answer = answers[f.label];
      Object.assign(base, patch);
      base.history = [...(base.history || []), { date: realToday(), text: log }];
      api(`/api/projects/${encodeURIComponent(project.id)}/items/${encodeURIComponent(itemId)}`, "POST", { patch, fieldAnswers: answers, logText: log });
      render();
    } else {
      const current = getModel().checklist.find((i) => i.id === itemId);
      const fields = (current.fields || []).map((f) => ({ ...f, answer: f.label in answers ? answers[f.label] : f.answer }));
      setItem(itemId, { ...patch, fields }, log);
    }
    return true;
  }

  function openAnswerDrawer(itemId) {
    const model = getModel();
    const item = model.checklist.find((i) => i.id === itemId);
    if (!item) return;
    const fields = (item.fields || [])
      .map(
        (f) =>
          `<label class="field">${esc(f.label)}<input data-field="${esc(f.label)}" value="${esc(f.answer || "")}" placeholder="${esc(f.proposal ? `(제안) ${Core.fill(f.proposal, model.project)}` : "")}"/></label>`,
      )
      .join("");
    openDrawer({
      kicker: '<span class="muted" style="font-size:12px">고객사 답 기록</span>',
      title: item.title,
      sub: `${chip(STATUS[item.status])}${item.askBy ? ` <span class="wait ${item.late || item.overdue ? "late" : ""}">회신 ${F.shortDate(item.askBy)}까지</span>` : ""}`,
      body: `${item.need ? `<div class="callout">${icon("doc")}<span>${esc(Core.fill(item.need, model.project))}</span></div>` : ""}
        ${fields || '<p class="muted">입력 칸이 없는 항목입니다. 아래에 답을 적으세요.</p>'}
        <label class="field">기타 답 (ㄴ)<textarea id="ans-note" style="min-height:80px">${esc(item.answer || "")}</textarea></label>
        <p class="muted" style="font-size:12px">비밀번호·키는 적지 마세요. 계정은 개발사 계정을 권한 초대로 받습니다. 빈 칸에 (제안)이 보이면 그 값이 우리 제안입니다.</p>
        <div class="btn-row" style="margin-top:12px"><button class="btn" id="ans-save">${icon("inbox")}받음·검토로 저장</button><button class="btn accent" id="ans-confirm">${icon("ok")}확정</button><button class="btn" id="ans-accept">${icon("sparkles")}빈 칸은 제안값으로 확정</button></div>
        <div class="section-title">${icon("send")}리마인드</div><div class="btn-row"><button class="btn small" id="ans-remind">요청서·리마인드 초안 열기</button></div>`,
    });
    const body = $("#drawer-body");
    const collect = (fillProposals) => {
      const answers = {};
      for (const input of $$("input[data-field]", body)) {
        const field = (item.fields || []).find((f) => f.label === input.dataset.field);
        const value = input.value.trim() || (fillProposals && field?.proposal ? Core.fill(field.proposal, model.project) : "");
        if (value) answers[input.dataset.field] = value;
      }
      return answers;
    };
    const done = (confirm, fillProposals) => {
      if (saveAnswers(itemId, collect(fillProposals), $("#ans-note", body).value.trim(), confirm)) {
        closeDrawer();
        toast(confirm ? "확정했습니다" : "받은 답을 저장했습니다");
      }
    };
    $("#ans-save", body).addEventListener("click", () => done(false, false));
    $("#ans-confirm", body).addEventListener("click", () => done(true, false));
    $("#ans-accept", body).addEventListener("click", () => done(true, true));
    $("#ans-remind", body).addEventListener("click", () => {
      closeDrawer();
      openItem(itemId);
    });
    hydrateIcons(body);
  }

  function markSheetSent() {
    const project = PROJECTS[state.projectId];
    const pending = getModel().sheet.pending.map((i) => i.id);
    const date = realToday();
    const log = "고객사 확인 요청 목록으로 요청";
    if (SERVER) {
      for (const id of pending) {
        const item = project.checklist.find((i) => i.id === id);
        Object.assign(item, { status: "requested", requested: date, ball: "client", updated: date });
        item.history = [...(item.history || []), { date, text: log }];
      }
      api(`/api/projects/${encodeURIComponent(project.id)}/sheet/sent`, "POST", { date, ids: pending });
    } else {
      const projectStore = projectOverrides(project.id);
      for (const id of pending) {
        const current = (projectStore[id] ||= {});
        Object.assign(current, { status: "requested", requested: date, ball: "client", updated: date });
        current.log = [...(current.log || []), { date, text: log }];
      }
      saveStore();
    }
    render();
    toast(`${pending.length}건을 요청함으로 바꿨습니다`);
  }

  const DOCS = {
    "sheet-md": { title: "고객사 확인 요청 목록 (Markdown)", note: "Notion·메일·문서에 붙여 넣습니다.", make: (m) => Docs.sheetDocument(m, { format: "md", company }) },
    "sheet-notion": { title: "고객사 확인 요청 목록 (Notion 형식)", note: "Claude가 Notion 요청 페이지에 올릴 때 쓰는 형식입니다(분홍·노랑 배경 포함). Claude에게 “요청 목록 Notion에 올려 줘”라고 하면 확인을 받은 뒤 올립니다.", make: (m) => Docs.sheetDocument(m, { format: "notion", company }) },
    kickoff: { title: "킥오프 회의 자료", note: "고객사와 함께 보는 판입니다.", make: (m) => Docs.kickoffKit(m, { company, features: LIB.features }) },
    "kickoff-internal": { title: "킥오프 회의 자료 (내부 준비 포함)", note: "계약 점검·대금·위험이 들어 있어 고객사에 보내지 않습니다.", make: (m) => Docs.kickoffKit(m, { internal: true, company, features: LIB.features }) },
    report: { title: "주간 진행상황 (내부)", note: "팀 채널용입니다. 속도·위험·결정이 들어 있습니다.", make: (m) => Docs.weeklyReport(m) },
    "report-client": { title: "주간 진행상황 (고객사)", note: "고객사에 보내는 판입니다.", make: (m) => Docs.weeklyReport(m, { client: true }) },
  };

  function openDocDrawer(kind) {
    const doc = DOCS[kind];
    const text = doc.make(getModel());
    openDrawer({
      kicker: `<span class="muted" style="font-size:12px">${esc(getModel().project.name)} · 초안</span>`,
      title: doc.title,
      sub: `<span class="muted" style="font-size:12px">${esc(doc.note)} 보내는 것은 사람이 합니다.</span>`,
      body: `<div class="btn-row" style="margin-bottom:10px"><button class="btn accent" id="doc-copy">${icon("copy")}복사</button></div><pre class="doc-pre">${esc(text)}</pre>`,
    });
    $("#doc-copy").addEventListener("click", () => copyText(text));
    hydrateIcons($("#drawer-body"));
  }

  function docsCardHtml() {
    return `<section class="card span-12" data-internal><div class="card-head"><h2>문서 만들기</h2><span class="sub">초안을 만들어 복사합니다</span></div>
      <div class="btn-row">${Object.entries(DOCS)
        .map(([kind, doc]) => `<button class="btn" data-doc="${kind}">${icon("doc")}${esc(doc.title)}</button>`)
        .join("")}</div></section>`;
  }

  function renderEmpty() {
    const ws = MODE.workspace ? `<code>${esc(MODE.workspace)}</code>` : "PM 워크스페이스";
    return `<div class="view-head"><div><h1>시작하기</h1><p>${ws}에 아직 프로젝트가 없어요.</p></div></div>
      <section class="card"><div class="steps">
        <div class="step"><div class="step-head">PM 저장소 만들기</div>GitHub에 <b>비공개</b> 저장소를 하나 만들고 내려받습니다. 모든 프로젝트의 PM 기록이 여기에 쌓입니다.</div>
        <div class="step"><div class="step-head">워크스페이스 세팅</div>내려받은 폴더에서 Claude에게 “PM 워크스페이스로 세팅해 줘”라고 하거나 <code>pm setup --company 회사이름</code>.</div>
        <div class="step"><div class="step-head">프로젝트 등록</div>“새 프로젝트 등록해 줘. 고객사는 ○○, 앱·관리자·결제·카카오 로그인, 개발 10/26~12/18, 출시 1/15”. 범위를 말하면 고객사 요청 목록이 만들어집니다.</div>
        <div class="step"><div class="step-head">킥오프</div>계약 점검 → 범위·SRS → 고객사 요청 목록 전달 → 기본 세팅(저장소 라벨·스프린트). 킥오프 회의 자료도 만들어 줍니다.</div>
      </div></section>`;
  }

  // ---------------------------------------------------------------- 렌더링과 이벤트
  const VIEWS = {
    requests: renderRequests,
    overview: renderOverview,
    kickoff: renderKickoff,
    schedule: renderSchedule,
    issues: renderIssues,
    resources: renderResources,
  };

  function updateChrome() {
    const model = getModel();
    const { project, health, forecast } = model;
    $("#client-name").textContent = `${project.client} · ${project.kind || ""}`;
    $("#health-chip").innerHTML = chip(health, `${health.label}`);
    $("#health-chip").title = health.reasons.join(" · ");
    const launch = project.dates?.launch;
    $("#dday").innerHTML = launch
      ? `${icon("flag")}출시 ${F.monthDay(launch)} · D-${F.daysBetween(realToday(), launch)}`
      : `${icon("flag")}출시일 미정`;
    const q = model.queue.length;
    $("#queue-count").textContent = q;
    $("#queue-count").classList.toggle("zero", q === 0);
    $("#nav-kickoff").textContent = model.missing.length
      ? `${model.missing.length}`
      : "";
    $("#nav-kickoff").classList.toggle("alert", model.missing.length > 0);
    const pendingSheet = model.sheet.pending.length;
    $("#nav-requests").textContent = pendingSheet ? `${pendingSheet}` : model.sheet.stats.waiting ? `${model.sheet.stats.waiting}` : "";
    $("#nav-requests").classList.toggle("alert", pendingSheet > 0);
    $("#nav-issues").textContent = forecast
      ? fmt(forecast.issues.filter((i) => i.state === "open").length)
      : "";
    $("#sync-info").textContent = forecast
      ? `GitHub ${syncLabel(forecast.syncedAt)} 스냅샷`
      : "GitHub 연결 전";
    $("#brand-sub").textContent = `${company} 외주 개발`;
    for (const btn of $$(".nav-btn"))
      btn.setAttribute(
        "aria-current",
        btn.dataset.view === state.view ? "page" : "false",
      );
    window.dispatchEvent(new CustomEvent("pm:update", { detail: model }));
  }

  function render() {
    chartRenderers = [];
    const model = getModel();
    const content = $("#content");
    content.innerHTML = (VIEWS[state.view] || renderOverview)(model);
    if (state.view === "schedule") mountScheduleCharts(model);
    hydrateIcons(content);
    updateChrome();
    store.project = state.projectId;
    store.view = state.view;
    saveStore();
    const hash = `#/${state.projectId}/${state.view}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function navigate(view, opts = {}) {
    if (opts.projectId && PROJECTS[opts.projectId])
      state.projectId = opts.projectId;
    if (VIEWS[view]) state.view = view;
    if (opts.filter) state.kickoff.status = opts.filter;
    if (opts.category) state.kickoff.category = opts.category;
    if (opts.scenario) state.scenario = { ...state.scenario, ...opts.scenario };
    render();
    window.scrollTo({ top: 0 });
    if (opts.item) openItem(opts.item, opts.preset);
    if (opts.anchor)
      document
        .getElementById(opts.anchor)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  document.addEventListener("click", (event) => {
    const t = event.target.closest("button, tr[data-item], tr[data-answer], [data-item]");
    if (!t) return;
    if (t.matches(".nav-btn")) return navigate(t.dataset.view);
    if (t.dataset.go)
      return navigate(t.dataset.go, { filter: t.dataset.filter, anchor: t.dataset.anchor });
    if (t.dataset.item) return openItem(t.dataset.item);
    if (t.dataset.answer) return openAnswerDrawer(t.dataset.answer);
    if (t.dataset.doc) return openDocDrawer(t.dataset.doc);
    if (t.hasAttribute("data-mark-sent")) return markSheetSent();
    if (t.dataset.pay) {
      const project = PROJECTS[state.projectId];
      const payment = project.contract.payments.find((x) => x.name === t.dataset.pay);
      payment.status = t.dataset.payStatus;
      if (payment.status === "paid") payment.paidAt = realToday();
      api(`/api/projects/${encodeURIComponent(project.id)}/contract/payment/${encodeURIComponent(payment.name)}`, "POST", { status: payment.status });
      return render();
    }
    if (t.dataset.brief != null) {
      const item = briefing()[Number(t.dataset.brief)];
      if (item)
        return navigate(item.view, {
          filter: item.filter,
          item: item.item,
          anchor: item.anchor,
        });
    }
    if (t.dataset.status) {
      state.kickoff.status = t.dataset.status;
      return render();
    }
    if (t.dataset.cat) {
      state.kickoff.category =
        state.kickoff.category === t.dataset.cat ? "all" : t.dataset.cat;
      return render();
    }
    if (t.dataset.istate) {
      state.issues.state = t.dataset.istate;
      return render();
    }
    if (t.hasAttribute("data-srs-wizard"))
      return openSrsWizard({ reset: true });
    if (t.hasAttribute("data-close-modal")) return closeModal();
    if (t.hasAttribute("data-reset-scenario")) {
      state.scenario = { velocityPct: 0, inflowPct: 0, descope: 0 };
      return render();
    }
    if (t.dataset.resLink) return linkResource(t.dataset.resLink);
    if (t.hasAttribute("data-batch-requests")) {
      const model = getModel();
      for (const item of model.missing) {
        if (queueOf(model.project.id).some((q) => q.itemId === item.id)) continue;
        const opts = {
          receive: item.receiveAt || model.project.receiveDefault || "notion",
          mode: item.mode || "ask",
          due: item.due || F.addDays(realToday(), 5),
        };
        addToQueue({
          kind: "request",
          itemId: item.id,
          title: `${item.title} 요청`,
          to: model.project.clientContact || `${model.project.client} 담당자`,
          channel: RECEIVE[opts.receive].label,
          ...opts,
          text: requestText(model, item, opts),
          by: "limi",
        });
      }
      toast("없는 자료 요청서를 승인 대기열에 모았습니다");
      return openQueue();
    }
    if (t.hasAttribute("data-open-limi")) return window.PMAgent?.open();
    if (t.dataset.askLimi) return window.PMAgent?.ask(t.dataset.askLimi);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if ($("#modal").classList.contains("open")) closeModal();
      else if ($("#drawer").classList.contains("open")) closeDrawer();
    }
    if (event.key === "Enter" && event.target.matches("tr[data-item]"))
      openItem(event.target.dataset.item);
    if (event.key === "Enter" && event.target.matches("tr[data-answer]"))
      openAnswerDrawer(event.target.dataset.answer);
  });
  document.addEventListener("input", (event) => {
    const t = event.target;
    if (t.id === "kick-q") {
      state.kickoff.q = t.value;
      const pos = t.selectionStart;
      render();
      const input = $("#kick-q");
      input.focus();
      input.setSelectionRange(pos, pos);
    } else if (t.id === "i-q") {
      state.issues.q = t.value;
      const pos = t.selectionStart;
      render();
      const input = $("#i-q");
      input.focus();
      input.setSelectionRange(pos, pos);
    } else if (t.dataset.scn) {
      // 끄는 동안에는 숫자만 바꾸고, 손을 떼면(change) 다시 계산해 그린다
      state.scenario[t.dataset.scn] = Number(t.value);
      const value = Number(t.value);
      t.previousElementSibling.textContent =
        t.dataset.scn === "descope"
          ? `-${value}건`
          : `${value > 0 ? "+" : ""}${value}%`;
    }
  });
  document.addEventListener("change", (event) => {
    const t = event.target;
    if (t.dataset.scn) {
      const key = t.dataset.scn;
      render();
      $(`[data-scn="${key}"]`)?.focus();
      return;
    }
    if (t.dataset.review) {
      const project = PROJECTS[state.projectId];
      const row = project.contract.review.find((r) => r.id === t.dataset.review);
      row.status = t.value;
      api(`/api/projects/${encodeURIComponent(project.id)}/contract/review/${encodeURIComponent(row.id)}`, "POST", { status: t.value });
      render();
      document.getElementById("contract")?.scrollIntoView({ block: "center" });
      return;
    }
    const map = { "i-ms": "milestone", "i-lb": "label", "i-as": "assignee" };
    if (map[t.id]) {
      state.issues[map[t.id]] = t.value;
      render();
    }
  });
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#scrim").addEventListener("click", closeDrawer);
  $("#queue-btn").addEventListener("click", openQueue);
  $("#project-select").addEventListener("change", (event) => {
    state.projectId = event.target.value;
    state.kickoff = { status: "all", category: "all", q: "" };
    state.scenario = { velocityPct: 0, inflowPct: 0, descope: 0 };
    render();
  });
  $("#client-view-btn").addEventListener("click", (event) => {
    const on = !document.body.classList.contains("client-view");
    document.body.classList.toggle("client-view", on);
    event.currentTarget.setAttribute("aria-pressed", String(on));
    window.PMAgent?.close();
    if (on && ["schedule", "issues", "kickoff", "resources"].includes(state.view)) state.view = "requests";
    render();
  });
  $("#theme-btn").addEventListener("click", () => {
    const current =
      document.documentElement.dataset.theme ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.theme = next;
    saveStore();
    render();
  });

  // 주소의 #/<프로젝트>/<화면>이 바뀌면(뒤로 가기, 링크) 그 화면으로
  window.addEventListener("hashchange", () => {
    const [, hp, hv] = location.hash.match(/^#\/([^/]+)\/([^/]+)/) || [];
    if ((PROJECTS[hp] && hp !== state.projectId) || (VIEWS[hv] && hv !== state.view)) {
      if (PROJECTS[hp]) {
        state.projectId = hp;
        $("#project-select").value = hp;
      }
      navigate(VIEWS[hv] ? hv : state.view);
    }
  });

  // ---------------------------------------------------------------- 시작
  if (store.theme) document.documentElement.dataset.theme = store.theme;
  if (!projectIds.length) {
    // 프로젝트가 없으면 시작 안내만 보여 준다
    document.body.classList.add("no-projects");
    $("#content").innerHTML = renderEmpty();
    hydrateIcons(document);
    return;
  }
  if (CLIENT) {
    // 고객사 공유본은 내부 정보를 빼고 만든 파일이라 공유 보기로 고정한다
    document.body.classList.add("client-view", "client-only");
    if (["schedule", "issues", "kickoff", "resources"].includes(state.view) || !location.hash) state.view = "requests";
  }
  const [, hashProject, hashView] =
    location.hash.match(/^#\/([^/]+)\/([^/]+)/) || [];
  if (PROJECTS[hashProject]) state.projectId = hashProject;
  if (VIEWS[hashView]) state.view = hashView;
  $("#project-select").innerHTML = projectIds
    .map(
      (id) =>
        `<option value="${esc(id)}">${esc(PROJECTS[id].name)}${PROJECTS[id].sample ? " (샘플)" : ""}</option>`,
    )
    .join("");
  $("#project-select").value = state.projectId;
  hydrateIcons(document);

  window.PMApp = {
    getModel,
    briefing,
    navigate,
    openItem,
    openQueue,
    openSrsWizard,
    addToQueue,
    requestText,
    reminderText,
    forecastFor: (scenario) => forecastFor(PROJECTS[state.projectId], scenario),
    limiSvg,
    progressOf,
    toast,
    copyText,
    esc,
    fmt,
    icon,
    STATUS,
    BALL,
    RECEIVE,
    MODES,
    FORECAST_STATUS,
    company,
    SERVER,
    CLIENT,
    openDocDrawer,
    openAnswerDrawer,
    markSheetSent,
    docText: (kind) => DOCS[kind]?.make(getModel()),
    LIB,
    get state() {
      return state;
    },
  };
  render();
})();
