/**
 * 대시보드(브라우저)와 pm CLI(node)가 함께 쓰는 프로젝트 모델 계산.
 * - 체크리스트 상태(대기 일수, 기한 지남), 필요 시점과 요청 시작일, 준비율, 건강도, 오늘의 브리핑
 * - 킥오프 4단계와 이번 주 할 일, 고객사 확인 요청 목록(차수별), 계약 점검 요약
 * - 고객사 요청서·리마인드 문안 (빈칸 대신 (제안) 값, 결론만, 이슈 번호 없음)
 * DOM에 의존하지 않는다. 브라우저에서는 window.PMCore, node에서는 module.exports.
 */
((root) => {
  const F = typeof module !== "undefined" && module.exports ? require("./forecast.js") : root.PMForecast;

  const STATUS = {
    missing: { label: "없음", cls: "crit", icon: "alert", order: 0 },
    requested: { label: "요청함", cls: "warn", icon: "clock", order: 1 },
    received: { label: "받음·검토", cls: "info", icon: "inbox", order: 2 },
    confirmed: { label: "확정", cls: "good", icon: "ok", order: 3 },
    not_needed: { label: "해당 없음", cls: "neutral", icon: "minus", order: 4 },
  };
  const FORECAST_STATUS = {
    on: { label: "순항", cls: "good", icon: "ok" },
    risk: { label: "주의", cls: "warn", icon: "alert" },
    off: { label: "위험", cls: "crit", icon: "alert" },
  };
  const HEALTH = [
    { key: "good", label: "순항", cls: "good", icon: "ok" },
    { key: "watch", label: "주의", cls: "warn", icon: "alert" },
    { key: "risk", label: "위험", cls: "crit", icon: "alert" },
  ];
  // 대기 일수가 이 값을 넘으면 기한 지남으로 보고 리마인드를 권한다
  const WAIT_LIMIT_DAYS = 7;
  // 필요 시점(needBy)의 이름. 날짜는 anchorDates가 프로젝트 날짜로 정한다
  const ANCHORS = {
    kickoff: "킥오프",
    devStart: "개발 착수",
    devMid: "기능 개발",
    devEnd: "개발 완료",
    qaStart: "고객사 QA",
    qaEnd: "최종 검수",
    storeSubmit: "스토어 심사 제출",
    launch: "출시",
  };
  // 킥오프 4단계. items의 항목이 done 상태 이상이면 끝난 것으로 본다(프로젝트에 없는 항목은 빼고 센다)
  const STAGES = [
    { id: "contract", name: "계약 확인", items: ["contract", "scope"], done: "confirmed", contractReview: true, hint: "계약서·견적서를 받고 계약 점검을 끝낸다" },
    { id: "scope", name: "범위·SRS", items: ["srs", "schedule", "acceptance", "change-request"], done: "received", hint: "범위 기준선과 SRS 초안, 일정·검수·변경 절차를 고객사와 맞춘다" },
    { id: "requests", name: "고객사 요청", sheet: true, hint: "고객사 확인 요청 목록을 보내 계정·정책·자료를 요청한다" },
    { id: "setup", name: "기본 세팅", items: ["contacts", "channel", "report", "repo", "labels"], done: "confirmed", hint: "소통 채널·보고 방식을 정하고 저장소 라벨·스프린트를 만든다" },
  ];
  const CONTRACT_REVIEW = {
    unchecked: { label: "확인 전", cls: "neutral", icon: "minus" },
    ok: { label: "있음", cls: "good", icon: "ok" },
    risk: { label: "불리·모호", cls: "warn", icon: "alert" },
    missing: { label: "없음", cls: "crit", icon: "alert" },
    na: { label: "해당 없음", cls: "neutral", icon: "minus" },
  };
  const PAYMENT_STATUS = { planned: "예정", invoiced: "청구함", paid: "받음" };

  const rank = (status) => STATUS[status]?.order ?? 0;
  const atLeast = (status, target) => status !== "not_needed" && rank(status) >= rank(target);
  const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");

  // 회사 이름이 들어가는 문구. 회사 이름은 워크스페이스 설정(company)에서 온다
  function labels(company = "우리 회사") {
    return {
      company,
      BALL: { client: "고객사", us: company, dev: "개발팀" },
      RECEIVE: {
        notion: { label: "Notion 요청 DB", desc: "고객 소통 원본. 항목을 만들고 고객사가 답을 남긴다" },
        drive: { label: "공유 드라이브 폴더", desc: "파일(로고, 계약서, 이미지)을 받을 때" },
        email: { label: "이메일 회신", desc: "담당자 메일로 받는다. 받은 뒤 원본 위치에 옮긴다" },
        repo: { label: "저장소 문서", desc: `${company}가 docs/에 정리하고 고객사가 확인한다` },
      },
      MODES: {
        ask: { label: "고객사에 요청", desc: "고객사가 자료를 만들어 보낸다" },
        draft: { label: `${company} 초안 → 고객 확인`, desc: "우리가 (제안) 초안을 쓰고 확인만 받는다" },
        meeting: { label: "정기 회의 안건", desc: "회의에서 정하고 결과를 남긴다" },
      },
    };
  }

  // 필요 시점별 날짜. 없는 날짜는 다른 날짜로 짐작한다(기능 개발 = 개발 기간 가운데, 스토어 제출 = 출시 2주 전)
  function anchorDates(dates = {}, today = F.kstDate(new Date())) {
    const out = { ...dates };
    if (!out.kickoff) out.kickoff = out.devStart ? F.addDays(out.devStart, -14) : today;
    if (!out.devMid && out.devStart && out.devEnd) out.devMid = F.addDays(out.devStart, Math.round(F.daysBetween(out.devStart, out.devEnd) / 2));
    if (!out.storeSubmit && out.launch) out.storeSubmit = F.addDays(out.launch, -14);
    return out;
  }

  // 제안값의 {devStart} 같은 자리를 날짜로 채운다
  function fill(text, project) {
    if (!text) return text;
    const dates = anchorDates(project.dates);
    return String(text).replace(/\{(\w+)\}/g, (match, key) => (isDate(dates[key]) ? F.shortDate(dates[key]) : match));
  }

  // 체크리스트에 대기 일수·기한 지남·요청 시작일을 붙인다. overrides는 정적 보기에서 브라우저에 저장한 변경분
  function checklist(project, overrides = {}, today = F.kstDate(new Date())) {
    const dates = anchorDates(project.dates, today);
    return (project.checklist || []).map((base) => {
      const item = { ...base, ...(overrides[base.id] || {}) };
      item.history = [...(base.history || []), ...(overrides[base.id]?.log || [])];
      if (!item.blocksDate && item.needBy && isDate(dates[item.needBy])) item.blocksDate = dates[item.needBy];
      if (!item.blocks && item.needBy) item.blocks = ANCHORS[item.needBy];
      item.askBy = item.blocksDate ? F.addDays(item.blocksDate, -(item.leadDays ?? 5)) : null;
      item.inSheet = item.sheet ?? item.ball === "client";
      item.waitDays = item.status === "requested" && item.requested ? Math.max(0, F.daysBetween(item.requested, today)) : null;
      item.late = item.status === "missing" && !!item.askBy && item.askBy < today;
      item.overdue =
        (!!item.due && item.due < today && item.status !== "confirmed" && item.status !== "not_needed") ||
        (item.waitDays ?? 0) > WAIT_LIMIT_DAYS;
      item.priority = item.status !== "confirmed" && item.status !== "not_needed" && !!item.askBy && F.daysBetween(today, item.askBy) <= 7;
      return item;
    });
  }

  function readiness(items) {
    const counted = items.filter((item) => item.status !== "not_needed");
    const ready = counted.filter((item) => item.status === "confirmed").length;
    return { ready, total: counted.length, percent: counted.length ? Math.round((ready / counted.length) * 100) : 0 };
  }

  function contractSummary(project, today = F.kstDate(new Date())) {
    const contract = project.contract;
    if (!contract) return null;
    const review = contract.review || [];
    const count = (status) => review.filter((r) => (r.status || "unchecked") === status).length;
    const dates = anchorDates(project.dates, today);
    const payments = (contract.payments || []).map((p) => ({ ...p, status: p.status || "planned", dueDate: p.due || (p.anchor && isDate(dates[p.anchor]) ? dates[p.anchor] : null) }));
    const next = payments.find((p) => p.status !== "paid") || null;
    return {
      signed: !!contract.signedAt,
      signedAt: contract.signedAt || null,
      review: { total: review.length, ok: count("ok"), risk: count("risk"), missing: count("missing"), unchecked: count("unchecked"), na: count("na") },
      reviewDone: review.length > 0 && count("unchecked") === 0,
      payments,
      next,
    };
  }

  // 킥오프 4단계 진행 상황
  function kickoff(project, items, today = F.kstDate(new Date())) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const contract = contractSummary(project, today);
    const stages = STAGES.map((stage) => {
      let targets;
      if (stage.sheet) targets = items.filter((item) => item.inSheet && item.status !== "not_needed");
      else targets = stage.items.map((id) => byId.get(id)).filter((item) => item && item.status !== "not_needed");
      const doneItems = targets.filter((item) => (stage.sheet ? item.status !== "missing" : atLeast(item.status, stage.done)));
      let done = doneItems.length;
      let total = targets.length;
      if (stage.contractReview && contract) {
        total += 1;
        if (contract.reviewDone) done += 1;
      }
      const remaining = targets.filter((item) => !doneItems.includes(item));
      return { ...stage, done, total, complete: done >= total, remaining };
    });
    const current = stages.find((stage) => !stage.complete) || null;
    const devStart = project.dates?.devStart;
    // 개발 착수 2주 뒤까지 또는 끝나지 않은 단계가 있는 동안 킥오프 화면을 보여 준다
    const active = !!current || (devStart ? F.daysBetween(devStart, today) < 14 : true);
    return { stages, current, active, completed: stages.filter((s) => s.complete).length };
  }

  // 이번 주(오늘부터 horizon일) 할 일. 요청 시작일이 지난 것부터
  function thisWeek(project, items, { today = F.kstDate(new Date()), horizon = 7, forecast = null } = {}) {
    const actions = [];
    const limit = F.addDays(today, horizon);
    for (const item of items.filter((i) => i.status === "missing" && i.askBy && i.askBy <= limit).sort((a, b) => a.askBy.localeCompare(b.askBy))) {
      actions.push({
        type: item.ball === "client" ? "request" : "prepare",
        item: item.id,
        late: item.askBy < today,
        date: item.askBy,
        text: item.ball === "client" ? `‘${item.title}’ 요청 (${item.blocks} ${F.monthDay(item.blocksDate)} 전에 필요)` : `‘${item.title}’ 준비 (${item.blocks} ${F.monthDay(item.blocksDate)} 전)`,
      });
    }
    for (const item of items.filter((i) => i.status === "requested" && (i.waitDays ?? 0) > WAIT_LIMIT_DAYS).sort((a, b) => b.waitDays - a.waitDays))
      actions.push({ type: "remind", item: item.id, late: true, date: item.requested, text: `‘${item.title}’ 리마인드 (요청 D+${item.waitDays})` });
    for (const item of items.filter((i) => i.status === "received" && i.ball === "us"))
      actions.push({ type: "review", item: item.id, late: false, date: item.updated || today, text: `‘${item.title}’ 받은 내용 검토·확정` });
    const contract = contractSummary(project, today);
    if (contract && !contract.reviewDone)
      actions.push({ type: "contract", late: false, date: today, text: `계약 점검 ${contract.review.unchecked}개 항목 확인` });
    const labels = items.find((i) => i.id === "labels");
    if (project.github?.repo && labels && labels.status !== "confirmed" && labels.status !== "not_needed")
      actions.push({ type: "setup-repo", item: "labels", late: false, date: today, text: "저장소 라벨·스프린트 마일스톤 만들기 (pm setup-repo)" });
    if (forecast?.views?.some((v) => v.isLate))
      actions.push({ type: "sprint", late: true, date: today, text: "마감이 지난 스프린트의 열린 이슈를 다음 스프린트로 옮길지 정리" });
    return actions;
  }

  // 고객사 확인 요청 목록. 보낸 항목은 요청한 날짜(차수)별로, 아직 안 보낸 항목은 '이번에 보낼 요청'으로 묶는다
  function sheet(project, items, today = F.kstDate(new Date())) {
    const order = new Map((project.categories || []).map((c, i) => [c.id, i]));
    const sortItems = (list) => list.sort((a, b) => (order.get(a.cat) ?? 99) - (order.get(b.cat) ?? 99) || (a.askBy || "9999").localeCompare(b.askBy || "9999"));
    const rows = items.filter((item) => item.inSheet && item.status !== "not_needed");
    const rounds = new Map();
    for (const item of rows.filter((i) => i.status !== "missing")) {
      const key = item.requested || "";
      if (!rounds.has(key)) rounds.set(key, []);
      rounds.get(key).push(item);
    }
    const sent = [...rounds.entries()]
      .sort(([a], [b]) => (a || "0000").localeCompare(b || "0000"))
      .map(([date, list], index) => ({ date: date || null, first: index === 0, items: sortItems(list) }));
    const pending = sortItems(rows.filter((i) => i.status === "missing"));
    const answered = rows.filter((i) => i.status === "received" || i.status === "confirmed" || (i.fields || []).some((f) => f.answer)).length;
    return {
      rounds: sent,
      pending,
      stats: { total: rows.length, sent: rows.length - pending.length, answered, waiting: rows.filter((i) => i.status === "requested").length, priority: rows.filter((i) => i.priority).length },
    };
  }

  function health(project, forecast, items, today = F.kstDate(new Date())) {
    const reasons = [];
    let level = 0;
    if (forecast?.project) {
      const s = forecast.project.status;
      if (s === "off") level = 2;
      else if (s === "risk") level = Math.max(level, 1);
      reasons.push(`${forecast.project.targetLabel} 예측 ${FORECAST_STATUS[s].label}`);
    }
    const overdue = items.filter((item) => item.overdue);
    if (overdue.length >= 3) level = Math.max(level, 1);
    if (overdue.length) reasons.push(`기한 넘긴 준비 항목 ${overdue.length}건`);
    const late = items.filter((item) => item.late);
    if (late.length) {
      level = Math.max(level, 1);
      reasons.push(`요청 시작일이 지났는데 아직 요청하지 않은 항목 ${late.length}건`);
    }
    const ready = readiness(items);
    const devStart = project.dates?.devStart;
    const toDevStart = devStart ? F.daysBetween(today, devStart) : null;
    if (toDevStart != null && toDevStart > 0 && toDevStart <= 21 && ready.percent < 60) {
      level = Math.max(level, 1);
      reasons.push(`개발 착수 ${toDevStart}일 전인데 준비율 ${ready.percent}%`);
    }
    const contract = contractSummary(project, today);
    if (contract?.review.missing || contract?.review.risk) reasons.push(`계약 점검: 없음 ${contract.review.missing} · 불리·모호 ${contract.review.risk}`);
    return { ...HEALTH[level], level, reasons };
  }

  function model(project, { forecast = null, overrides = {}, queue = [], today = F.kstDate(new Date()) } = {}) {
    const items = checklist(project, overrides, today);
    return {
      project,
      forecast,
      today,
      checklist: items,
      readiness: readiness(items),
      waiting: items.filter((item) => item.status === "requested" && item.ball === "client").sort((a, b) => (b.waitDays ?? 0) - (a.waitDays ?? 0)),
      missing: items.filter((item) => item.status === "missing"),
      health: health(project, forecast, items, today),
      kickoff: kickoff(project, items, today),
      thisWeek: thisWeek(project, items, { today, forecast }),
      sheet: sheet(project, items, today),
      contract: contractSummary(project, today),
      queue,
    };
  }

  const escHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const num = (n) => (n == null || Number.isNaN(n) ? "-" : Math.round(n).toLocaleString("ko-KR"));

  // 오늘의 브리핑: 결론 먼저, 최대 4줄. html은 화면용(<strong> 강조), text는 터미널용
  function briefing(m) {
    const { project, forecast, waiting, missing, readiness: ready, kickoff: ko, thisWeek: week } = m;
    const items = [];
    const add = (html, extra) => items.push({ html, text: html.replace(/<[^>]+>/g, ""), ...extra });
    const p = forecast?.project;
    if (ko?.active && ko.current) {
      const late = week.filter((a) => a.late).length;
      add(
        `킥오프 <strong>${ko.completed}/${ko.stages.length}단계</strong>, 지금은 ‘${escHtml(ko.current.name)}’(${ko.current.done}/${ko.current.total}). 이번 주 할 일 <strong>${week.length}개</strong>${late ? `, 그중 <strong>${late}개는 늦었어요</strong>` : ""}.`,
        { view: "kickoff" },
      );
    }
    if (p) {
      const label = `${p.targetLabel}(${F.monthDay(p.target)})`;
      if (p.status === "on") add(`${label}은 <strong>순항</strong>입니다. 지금 속도면 ${F.shortDate(p.netFinish)}에 남은 일이 끝납니다.`, { view: "schedule" });
      else
        add(
          `${label} <strong>${FORECAST_STATUS[p.status].label}</strong>: 새 이슈가 멈추면 ${F.shortDate(p.expected)} 완료, 지금처럼 주 ${num(p.inflow)}건이 들어오면 ${F.monthDay(p.target)}에 <strong>약 ${num(p.remainingAtTarget)}건</strong>이 남습니다.`,
          { view: "schedule" },
        );
    } else if (!ko?.active) {
      add(`킥오프 준비율 <strong>${ready.percent}%</strong> (${ready.ready}/${ready.total}). 일정 예측은 이슈 트래커를 연결하면 시작됩니다.`, { view: "kickoff" });
    }
    if (waiting.length) {
      const top = waiting[0];
      add(`고객사 답을 기다리는 항목 <strong>${waiting.length}건</strong>, 가장 오래된 것은 ‘${escHtml(top.title)}’ <strong>D+${top.waitDays}</strong>.`, { view: "requests" });
    }
    const first = week.find((a) => a.type === "request") || (missing[0] && { item: missing[0].id, text: `‘${missing[0].title}’` });
    if (missing.length && first) add(`아직 없는 자료 <strong>${missing.length}건</strong> — 먼저 ${escHtml(first.text)}.`, { view: "kickoff", filter: "missing", item: first.item });
    const late = forecast?.views.filter((view) => view.isLate) ?? [];
    if (late.length)
      add(
        `${late.map((view) => escHtml(view.title.split(" ")[0])).join(", ")} 마감이 지났는데 <strong>${late.reduce((sum, view) => sum + view.open, 0)}건</strong>이 열려 있습니다. 다음 스프린트로 옮길지 정리가 필요해요.`,
        { view: "schedule" },
      );
    if (project.decisions?.length)
      add(
        `오늘 결정할 일 <strong>${project.decisions.length}건</strong>: ${project.decisions
          .slice(0, 2)
          .map((d) => escHtml(d.title))
          .join(" · ")}`,
        { view: "overview", anchor: "decisions" },
      );
    return items.slice(0, 4);
  }

  // 고객사 요청서. 고객사에 그대로 나가는 글이라 결론만 쓰고 이슈 번호·내부 메모는 넣지 않는다
  function requestText(project, item, opts = {}, company = "우리 회사") {
    const { RECEIVE } = labels(company);
    const receive = RECEIVE[opts.receive] || RECEIVE.notion;
    const where = opts.receive === "notion" && project.channels?.notion?.url ? `${receive.label} (${project.channels.notion.url})` : receive.label;
    const lines = [
      `[${project.name}] ${item.title} ${opts.mode === "draft" ? "초안 확인 부탁드립니다" : "전달 부탁드립니다"}`,
      "",
      `안녕하세요, ${project.client} 담당자님. ${company} PM입니다.`,
    ];
    if (item.blocks) lines.push(`${item.blocks}${item.blocksDate ? `(${F.shortDate(item.blocksDate)})` : ""} 일정을 지키려면 아래 자료가 필요합니다.`);
    lines.push("", `■ 요청 항목: ${item.title}`);
    if (item.need) lines.push(`■ 필요한 내용: ${fill(item.need, project)}`);
    if (item.fields?.length)
      lines.push(...item.fields.map((f) => `  • ${f.label}: ${f.answer ? f.answer : f.proposal ? `(제안) ${fill(f.proposal, project)}` : ""}`));
    if (opts.mode === "draft") lines.push(`■ ${company}가 (제안) 초안을 먼저 작성했습니다. 고칠 부분만 알려 주시면 됩니다.`);
    if (item.proposal) lines.push(`■ (제안) ${fill(item.proposal, project)}`);
    if (item.cat === "accounts") lines.push("■ 계정 비밀번호는 보내지 마시고, 개발사 계정을 권한 초대해 주세요.");
    lines.push(`■ 전달 방법: ${where}`, `■ 회신 기한: ${opts.due ? F.shortDate(opts.due) : "협의"}`);
    if (opts.mode === "meeting") lines.push("■ 다음 정기 회의 안건으로 올려 함께 정하겠습니다. 미리 의견 주시면 반영하겠습니다.");
    lines.push("", "(제안) 값으로 진행해도 괜찮은 부분은 ‘그대로 진행’이라고만 답해 주셔도 됩니다.", "감사합니다.");
    return lines.join("\n");
  }

  function reminderText(project, item) {
    return [
      `[${project.name}] ${item.title} 회신 부탁드립니다 (요청 D+${item.waitDays ?? "?"})`,
      "",
      `${item.requested ? `${F.shortDate(item.requested)}에 ` : ""}요청드린 ‘${item.title}’ 회신을 기다리고 있습니다.`,
      item.blocks
        ? `${item.blocks} 일정에 영향을 주는 항목이라 ${item.due ? `${F.shortDate(item.due)}까지` : "이번 주 안에"} 회신 부탁드립니다.`
        : "확인 가능한 일정만 알려 주셔도 됩니다.",
      item.proposal ? `어려우시면 (제안) ${fill(item.proposal, project)} 로 진행해도 될지 알려 주세요.` : "",
      "",
      "감사합니다.",
    ]
      .filter((line, i, arr) => line !== "" || arr[i - 1] !== "")
      .join("\n");
  }

  // project.json에서 비어 있어도 되는 값을 채운다. 날짜만 있으면 일정 막대와 범위를 만들어 준다
  function normalize(source, today = F.kstDate(new Date())) {
    const project = JSON.parse(JSON.stringify(source));
    const dates = (project.dates ||= {});
    project.checklist ||= [];
    project.categories ||= [];
    project.resources ||= [];
    project.channels ||= {};
    project.queue ||= [];
    project.receiveDefault ||= "notion";
    project.forecastConfig = {
      baselineEnd: dates.devStart ? F.addDays(dates.devStart, 3) : today,
      epicLabel: "epic",
      descopeLabel: "descope",
      ...(project.forecastConfig || {}),
    };
    const repo = project.github?.repo;
    project.github = repo ? { ...project.github, key: project.id, repoUrl: `https://github.com/${repo}` } : null;
    if (repo && !project.resources.some((r) => r.id === "github"))
      project.resources.unshift({ id: "github", name: "GitHub 저장소·이슈", glyph: "GH", desc: "개발 이슈·마일스톤. 일정 예측의 원본", url: project.github.repoUrl, sync: true });
    if (!project.phases?.length) {
      project.phases = [];
      if (dates.kickoff && dates.devStart) project.phases.push({ name: "킥오프·준비", kind: "kickoff", start: dates.kickoff, end: F.addDays(dates.devStart, -1) });
      if (dates.devStart && dates.devEnd) project.phases.push({ name: "개발", kind: "dev", start: dates.devStart, end: dates.devEnd });
      if (dates.qaStart && dates.qaEnd) project.phases.push({ name: "고객사 QA", kind: "qa", start: dates.qaStart, end: dates.qaEnd });
    }
    if (!project.milestones?.length) project.milestones = dates.launch ? [{ name: "출시", date: dates.launch }] : [];
    if (!project.timeline?.start || !project.timeline?.end) {
      const known = [...Object.values(dates), ...project.phases.flatMap((p) => [p.start, p.end])].filter(isDate).sort();
      project.timeline = {
        start: F.addDays(known[0] || today, -7),
        end: F.addDays(known.at(-1) || F.addDays(today, 90), 7),
      };
    }
    return project;
  }

  // 고객사 공유본에서 빼는 내부 정보
  function clientSafe(project) {
    const copy = JSON.parse(JSON.stringify(project));
    for (const key of ["decisions", "risks", "team", "queue", "notes", "contract"]) delete copy[key];
    copy.checklist = (copy.checklist || []).map(({ internal, history, ...rest }) => rest);
    return copy;
  }

  const api = {
    STATUS,
    FORECAST_STATUS,
    HEALTH,
    WAIT_LIMIT_DAYS,
    ANCHORS,
    STAGES,
    CONTRACT_REVIEW,
    PAYMENT_STATUS,
    labels,
    anchorDates,
    fill,
    checklist,
    readiness,
    contractSummary,
    kickoff,
    thisWeek,
    sheet,
    health,
    model,
    briefing,
    requestText,
    reminderText,
    normalize,
    clientSafe,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PMCore = api;
})(typeof window !== "undefined" ? window : globalThis);
