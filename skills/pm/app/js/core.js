/**
 * 대시보드(브라우저)와 pm CLI(node)가 함께 쓰는 프로젝트 모델 계산.
 * - 체크리스트 상태(대기 일수, 기한 지남), 필요 시점과 요청 시작일, 준비율, 건강도, 오늘의 브리핑
 * - 킥오프 4단계와 이번 주 할 일, 고객사 확인 요청 목록(차수별), 계약 점검 요약
 * - 최신화: 항목마다 마지막 확인일·출처, 추정 값과 오래된 값(다시 확인할 목록)
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
  // 끝나지 않은 항목을 이 날수보다 오래 확인하지 않으면 '오래됨'으로 다시 확인할 목록에 올린다
  const STALE_DAYS = 14;
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
  // YYYY-MM-DD 모양이면서 달력에 있는 날짜(2026-02-30, 2026-13-45는 아님)
  const isDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  };
  const RISK_LEVEL = { high: "높음", mid: "중간", low: "낮음" };

  // 날짜와 오늘의 차이: 'D-2', '오늘', '2일 지남'
  const dayLabel = (days) => (days === 0 ? "오늘" : days > 0 ? `D-${days}` : `${-days}일 지남`);

  // 기한(YYYY-MM-DD)을 오늘과 비교한다. 날짜가 아닌 옛 값(예: '이번 주')은 글자 그대로 두고 계산하지 않는다
  function dueInfo(due, today = F.kstDate(new Date())) {
    if (!due) return null;
    if (!isDate(due)) return { raw: String(due), date: null, days: null, late: false, soon: false, invalid: true, label: String(due), text: String(due) };
    const days = F.daysBetween(today, due);
    const label = dayLabel(days);
    return { raw: due, date: due, days, late: days < 0, soon: days >= 0 && days <= 3, invalid: false, label, text: `${F.monthDay(due)} · ${label}` };
  }

  // 값을 마지막으로 확인한 날·출처(checked: { at, src, guess })
  const freshOf = (checked) => ({
    checkedAt: isDate(checked?.at) ? checked.at : null,
    checkedSrc: checked?.src || null,
    guess: !!checked?.guess,
  });

  // 결정·위험: 번호(목록 순서, CLI가 쓴다), 기한 계산, 확인일
  const decisionsOf = (project, today) => (project.decisions || []).map((d, i) => ({ ...d, n: i + 1, dueInfo: dueInfo(d.due, today), ...freshOf(d.checked) }));
  const risksOf = (project, today) => (project.risks || []).map((r, i) => ({ ...r, n: i + 1, dueInfo: dueInfo(r.due, today), ...freshOf(r.checked) }));

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
      // 최신화: 값을 마지막으로 원본에서 확인한 날. checked가 없으면 답 받은 날·최근 갱신일로 본다
      item.checkedAt = [item.checked?.at, item.answeredAt, item.updated].filter(isDate).sort().at(-1) || null;
      item.checkedSrc = item.checked?.src || null;
      item.ageDays = item.checkedAt ? Math.max(0, F.daysBetween(item.checkedAt, today)) : null;
      item.guess = !!item.checked?.guess;
      // 아무것도 하지 않은 새 항목(없음, 기록 없음)은 오래된 값이 아니라 할 일이라 빼고 요청 시작일로 챙긴다
      const open = item.status !== "confirmed" && item.status !== "not_needed";
      // 늦음은 두 가지로만 말한다: 필요일 지남(막는 일정 날짜 기준), 7일 넘게 답 없음(요청한 날 기준)
      item.needLate = open && !!item.blocksDate && item.blocksDate < today;
      item.needDays = item.blocksDate ? F.daysBetween(today, item.blocksDate) : null;
      item.noReply = item.status === "requested" && (item.waitDays ?? 0) > WAIT_LIMIT_DAYS;
      item.stale = open && (item.ageDays == null ? item.status !== "missing" : item.ageDays > STALE_DAYS);
      item.recheck = item.status !== "not_needed" && (item.guess || item.stale);
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
    // 킥오프 기간(개발 착수 전)에만 홈에 킥오프 진행을 보여 준다. 착수 뒤 남은 준비 항목은 이번 주 할 일로 챙긴다
    const active = isDate(devStart) ? today < devStart : !!current;
    return { stages, current, active, completed: stages.filter((s) => s.complete).length };
  }

  // 지금 단계: 오늘이 들어 있는 phase, 없으면 다음 phase
  function currentPhase(project, today = F.kstDate(new Date())) {
    const phases = (project.phases || []).filter((ph) => isDate(ph.start) && isDate(ph.end)).sort((a, b) => a.start.localeCompare(b.start));
    const now = phases.find((ph) => ph.start <= today && today <= ph.end);
    if (now) return { ...now, state: "now", dayOf: F.daysBetween(now.start, today) + 1, days: F.daysBetween(now.start, now.end) + 1 };
    const next = phases.find((ph) => ph.start > today);
    if (next) return { ...next, state: "next", inDays: F.daysBetween(today, next.start) };
    return phases.length ? { ...phases.at(-1), state: "done" } : null;
  }

  // 다음 관문: 오늘 이후 가장 가까운 필요 시점과 그때까지 갖춰야 할 항목
  function nextGate(project, items, today = F.kstDate(new Date())) {
    const dates = anchorDates(project.dates, today);
    const order = ["devStart", "devMid", "devEnd", "qaStart", "storeSubmit", "qaEnd", "launch"];
    const gates = order
      .filter((key) => isDate(dates[key]) && dates[key] >= today && (key !== "devMid" || project.dates?.devMid))
      .map((key) => ({ key, label: ANCHORS[key], date: dates[key] }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!gates.length) return null;
    const gate = gates[0];
    // 그 관문까지 필요한 항목(관문 날짜 이전에 막히는 것 포함)
    const need = items.filter((i) => i.status !== "not_needed" && i.blocksDate && i.blocksDate <= gate.date);
    const ready = need.filter((i) => i.status === "confirmed");
    const open = need.filter((i) => i.status !== "confirmed").sort((a, b) => (a.blocksDate || "").localeCompare(b.blocksDate || ""));
    return { ...gate, inDays: F.daysBetween(today, gate.date), total: need.length, ready: ready.length, open, after: gates.slice(1, 3) };
  }

  // 늦은 이유는 이 다섯 가지로만 쓴다
  const LATE = { need: "필요일 지남", ask: "요청 시작일 지남", wait: `${WAIT_LIMIT_DAYS}일 넘게 답 없음`, due: "기한 지남", sprint: "마감 지남" };
  // 필요일 표기: '필요일 10/8 · 6일 지남', '필요 11/2 · D-19'
  const needText = (item, today) => (item.blocksDate ? `${item.blocksDate < today ? "필요일" : "필요"} ${F.monthDay(item.blocksDate)} · ${dayLabel(F.daysBetween(today, item.blocksDate))}` : "");

  // 이번 주(오늘부터 horizon일) 할 일. 필요일(막는 일정)·기한 하나로 정렬한다
  // label은 화면 한 줄(날짜는 옆 칸에), text는 터미널·문서용 한 문장
  function thisWeek(project, items, { today = F.kstDate(new Date()), horizon = 7, forecast = null } = {}) {
    const actions = [];
    const limit = F.addDays(today, horizon);
    const need = (item) => (item.blocksDate ? { date: item.blocksDate, dateKind: "필요" } : { date: null, dateKind: null });
    for (const item of items.filter((i) => i.status === "missing" && i.askBy && i.askBy <= limit)) {
      const why = item.needLate ? LATE.need : item.askBy < today ? LATE.ask : null;
      const label = item.ball === "client" ? `‘${item.title}’ 요청` : `‘${item.title}’ 준비`;
      actions.push({ type: item.ball === "client" ? "request" : "prepare", item: item.id, late: !!why, why, ...need(item), label, text: `${label}${item.blocksDate ? ` (${item.blocks} ${F.monthDay(item.blocksDate)} 전에 필요)` : ""}` });
    }
    // 리마인드: 7일 넘게 답이 없거나, 필요일이 이미 지난 고객사 대기
    for (const item of items.filter((i) => i.status === "requested" && (i.noReply || i.needLate))) {
      const label = `‘${item.title}’ 리마인드 (요청 D+${item.waitDays})`;
      actions.push({ type: "remind", item: item.id, late: true, why: item.needLate ? LATE.need : LATE.wait, ...need(item), label, text: label });
    }
    for (const item of items.filter((i) => i.status === "received" && i.ball === "us")) {
      const label = `‘${item.title}’ 받은 내용 검토·확정`;
      actions.push({ type: "review", item: item.id, late: item.needLate, why: item.needLate ? LATE.need : null, ...need(item), label, text: label });
    }
    // 결정: 기한이 이번 주 안이거나 지난 것. 날짜가 아닌 옛 기한은 날짜 칸에 글자 그대로
    for (const d of decisionsOf(project, today).filter((x) => x.dueInfo && (x.dueInfo.invalid || x.dueInfo.date <= limit))) {
      const label = `‘${d.title}’ 결정`;
      actions.push({ type: "decision", decision: d.n, late: d.dueInfo.late, why: d.dueInfo.late ? LATE.due : null, date: d.dueInfo.date, dateKind: "기한", raw: d.dueInfo.invalid ? d.dueInfo.raw : null, label, text: `${label} (기한 ${d.dueInfo.text})` });
    }
    // 위험: 다시 볼 날(기한)이 이번 주 안이거나 지난 것
    for (const r of risksOf(project, today).filter((x) => x.dueInfo && !x.dueInfo.invalid && x.dueInfo.date <= limit)) {
      const label = `‘${r.title}’ 위험 대응 확인`;
      actions.push({ type: "risk", risk: r.n, late: r.dueInfo.late, why: r.dueInfo.late ? LATE.due : null, date: r.dueInfo.date, dateKind: "기한", label, text: `${label} (기한 ${r.dueInfo.text})` });
    }
    const recheck = items.filter((i) => i.recheck);
    if (recheck.length) {
      const guess = recheck.filter((i) => i.guess).length;
      const label = `다시 확인할 값 ${recheck.length}개 (${guess === recheck.length ? "모두 추정" : [guess && `추정 ${guess}`, recheck.length - guess && `${STALE_DAYS}일 넘게 확인 안 함 ${recheck.length - guess}`].filter(Boolean).join(" · ")})`;
      actions.push({ type: "recheck", late: false, date: null, label, text: label });
    }
    const contract = contractSummary(project, today);
    if (contract && !contract.reviewDone) {
      const label = `계약 점검 ${contract.review.unchecked}개 항목 확인`;
      actions.push({ type: "contract", late: false, date: null, label, text: label });
    }
    const labels = items.find((i) => i.id === "labels");
    if (project.github?.repo && labels && labels.status !== "confirmed" && labels.status !== "not_needed") {
      const label = "저장소 라벨·스프린트 마일스톤 만들기 (pm setup-repo)";
      actions.push({ type: "setup-repo", item: "labels", late: false, date: null, label, text: label });
    }
    const lateViews = forecast?.views?.filter((v) => v.isLate) || [];
    if (lateViews.length) {
      const label = `${lateViews.map((v) => v.title.split(" ")[0]).join(", ")}의 열린 이슈 ${lateViews.reduce((sum, v) => sum + v.open, 0)}건을 다음 스프린트로 옮길지 정리`;
      actions.push({ type: "sprint", sprint: lateViews[0].number, late: true, why: LATE.sprint, date: lateViews[0].due, dateKind: "마감", label, text: label });
    }
    // 날짜 있는 것을 날짜 순으로(지난 것이 자연히 먼저), 같은 날이면 늦은 것 먼저, 날짜 없는 것은 뒤로
    return actions.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || Number(b.late) - Number(a.late));
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

  // 건강도와 '살펴볼 신호'. 신호는 상태 칩 옆 이유 칩과 리미 말풍선이 같은 목록을 쓴다(누르면 그 화면으로)
  function health(project, forecast, items, today = F.kstDate(new Date())) {
    const signals = [];
    let level = 0;
    const add = (signal, lv = 0) => {
      signals.push({ cls: lv >= 2 ? "crit" : "warn", ...signal });
      level = Math.max(level, lv);
    };
    if (forecast?.project && forecast.project.status !== "on") {
      const s = forecast.project.status;
      add({ key: "forecast", text: `${forecast.project.targetLabel} 예측 ${FORECAST_STATUS[s].label}`, short: `${forecast.project.targetLabel} 예측 ${FORECAST_STATUS[s].label}`, view: "schedule", anchor: "velocity" }, s === "off" ? 2 : 1);
    }
    const lateDecisions = decisionsOf(project, today).filter((d) => d.dueInfo?.late);
    if (lateDecisions.length) add({ key: "decisions", text: `기한 지난 결정 ${lateDecisions.length}건`, short: `결정 기한 지남 ${lateDecisions.length}`, view: "overview", anchor: "decisions" }, 1);
    const noReply = items.filter((item) => item.noReply);
    if (noReply.length) add({ key: "noReply", text: `${WAIT_LIMIT_DAYS}일 넘게 답 없는 고객사 요청 ${noReply.length}건`, short: `${WAIT_LIMIT_DAYS}일 넘게 답 없음 ${noReply.length}`, view: "overview", anchor: "waiting" }, noReply.length >= 3 ? 1 : 0);
    const dueLate = items.filter((item) => !item.noReply && item.due && item.due < today && item.status !== "confirmed" && item.status !== "not_needed");
    if (dueLate.length) add({ key: "dueLate", text: `기한 지난 준비 항목 ${dueLate.length}건`, short: `준비 기한 지남 ${dueLate.length}`, view: "kickoff" }, dueLate.length >= 3 ? 1 : 0);
    const late = items.filter((item) => item.late);
    if (late.length) add({ key: "late", text: `요청 시작일이 지났는데 아직 요청하지 않은 항목 ${late.length}건`, short: `요청 늦음 ${late.length}`, view: "kickoff", filter: "missing" }, 1);
    const ready = readiness(items);
    const devStart = project.dates?.devStart;
    const toDevStart = devStart ? F.daysBetween(today, devStart) : null;
    if (toDevStart != null && toDevStart > 0 && toDevStart <= 21 && ready.percent < 60)
      add({ key: "readiness", text: `개발 착수 ${toDevStart}일 전인데 준비율 ${ready.percent}%`, short: `준비율 ${ready.percent}%`, view: "kickoff" }, 1);
    const lateRisks = risksOf(project, today).filter((r) => r.dueInfo?.late);
    if (lateRisks.length) add({ key: "risks", text: `대응 기한 지난 위험 ${lateRisks.length}건`, short: `위험 기한 지남 ${lateRisks.length}`, view: "overview", anchor: "risks" });
    const contract = contractSummary(project, today);
    if (contract?.review.missing || contract?.review.risk)
      add({ key: "contract", text: `계약 점검: 없음 ${contract.review.missing} · 불리·모호 ${contract.review.risk}`, short: `계약 점검 ${contract.review.missing + contract.review.risk}`, view: "kickoff", anchor: "contract" });
    return { ...HEALTH[level], level, signals, reasons: signals.map((x) => x.text) };
  }

  function model(project, { forecast = null, overrides = {}, queue = [], today = F.kstDate(new Date()) } = {}) {
    const items = checklist(project, overrides, today);
    return {
      project,
      forecast,
      today,
      checklist: items,
      decisions: decisionsOf(project, today),
      risks: risksOf(project, today),
      readiness: readiness(items),
      // 고객사 답 기다림: 막히는 일정이 가까운 것부터(가장 오래된 것이 아니라 가장 급한 것)
      waiting: items
        .filter((item) => item.status === "requested" && item.ball === "client")
        .sort((a, b) => (a.blocksDate || "9999").localeCompare(b.blocksDate || "9999") || (b.waitDays ?? 0) - (a.waitDays ?? 0)),
      missing: items.filter((item) => item.status === "missing"),
      recheck: items
        .filter((item) => item.recheck)
        .sort((a, b) => Number(b.guess) - Number(a.guess) || (a.blocksDate || "9999").localeCompare(b.blocksDate || "9999")),
      health: health(project, forecast, items, today),
      kickoff: kickoff(project, items, today),
      phase: currentPhase(project, today),
      gate: nextGate(project, items, today),
      thisWeek: thisWeek(project, items, { today, forecast }),
      sheet: sheet(project, items, today),
      contract: contractSummary(project, today),
      queue,
    };
  }

  // ---------------------------------------------------------------- 업데이트 기록(update.json) 읽기
  // 단계별로 무엇을 읽는지. 실패하면 이 원본의 값이 이전 시각 기준으로 남는다
  const STEP_SOURCE = {
    github: { label: "GitHub 이슈", obj: "GitHub 이슈를" },
    recheck: { label: "연결된 GitHub 이슈 상태", obj: "연결된 GitHub 이슈 상태를" },
    deep: { label: "고객사 답(Notion)·GitHub 코멘트", obj: "고객사 답(Notion)·GitHub 코멘트를" },
  };
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const clock = (h, m, ampm) => {
    let hour = Number(h);
    if (/pm/i.test(ampm || "") && hour < 12) hour += 12;
    if (/am/i.test(ampm || "") && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(Number(m || 0)).padStart(2, "0")}`;
  };
  const stepKey = (step) => step.key || (/GitHub 이슈/.test(step.name || "") ? "github" : /Claude|원본 확인/.test(step.name || "") ? "deep" : "recheck");

  // 실패한 단계의 원문(영어 오류 등)을 쉬운 말로: 무엇을 못 읽었는지, 왜, 언제 다시 하면 되는지
  function explainStep(step) {
    const key = stepKey(step);
    const raw = String(step.detail || "");
    let reason = null;
    let retry = null;
    if (/hit your .*limit|usage limit|weekly limit|limit reached|rate.?limit|\b429\b|사용 한도/i.test(raw)) {
      reason = /weekly|주간/i.test(raw) ? "Claude 주간 사용 한도" : "Claude 사용 한도";
      const md = raw.match(/resets?\s+(?:on\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
      const hm = raw.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
      if (md && MONTHS[md[1].slice(0, 3).toLowerCase()]) retry = `${MONTHS[md[1].slice(0, 3).toLowerCase()]}/${Number(md[2])}${md[3] ? ` ${clock(md[3], md[4], md[5])}` : ""}`;
      else if (hm) retry = clock(hm[1], hm[2], hm[3]);
    } else if (/claude 명령을 찾지|ENOENT|command not found/i.test(raw)) reason = "이 PC에서 Claude Code를 찾지 못함(pm doctor)";
    else if (/결과 JSON|JSON/i.test(raw)) reason = "Claude 결과를 읽지 못함";
    else if (/SIGTERM|timed?\s?out|시간 초과|ETIMEDOUT/i.test(raw)) reason = "시간 초과";
    else if (/\b40[13]\b|bad credentials|unauthori[sz]ed|auth|로그인/i.test(raw)) reason = key === "deep" ? "Claude·Notion 로그인 필요(pm doctor)" : "GitHub 로그인 필요(gh auth login)";
    else if (/ENOTFOUND|EAI_AGAIN|ECONN|network|fetch failed|socket/i.test(raw)) reason = "네트워크 연결 실패";
    const src = STEP_SOURCE[key] || { label: step.name, obj: `${step.name}을(를)` };
    return {
      key,
      source: src.label,
      reason,
      retry,
      raw,
      text: `${src.obj} 못 읽었어요 · ${reason || "원인은 원문 참고"} · ${retry ? `${retry} 이후 다시 시도` : "다음 업데이트 때 다시 시도"}`,
    };
  }

  // 업데이트 상태: 실패(일부 원본을 못 읽음) · 오래됨(staleHours 넘게 업데이트 없음) · 정상 · 기록 없음
  // sources는 원본별 마지막 성공 시각. 0.8 이전 기록에는 없어서 기록과 GitHub 스냅샷 시각으로 대신 계산한다
  function updateState(rec, { now = Date.now(), staleHours = 12, githubAt = null } = {}) {
    const last = rec?.last || null;
    const history = rec?.history || [];
    if (!last) return { state: "never", last: null, ageHours: null, sources: { github: githubAt, client: null }, failures: [], history };
    const steps = last.steps || [];
    const stepOk = (key) => steps.some((s) => stepKey(s) === key && s.ok);
    const sources = {
      github: githubAt || last.sources?.github || (stepOk("github") ? last.at : null),
      client: last.sources?.client || (last.mode === "deep" && stepOk("deep") ? last.at : history.find((h) => h.mode === "deep" && h.ok)?.at || null),
    };
    const ageHours = (now - new Date(last.at).getTime()) / 3_600_000;
    const failures = steps.filter((s) => !s.ok).map(explainStep);
    return { state: !last.ok ? "failed" : ageHours > staleHours ? "stale" : "ok", last, ageHours, sources, failures, history };
  }

  const escHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const num = (n) => (n == null || Number.isNaN(n) ? "-" : Math.round(n).toLocaleString("ko-KR"));

  // 고객사 답 기다림 한 줄의 날짜: 필요일이 지났으면 '필요일 10/8 · 6일 지남'
  const waitNeed = (item, today) => (item.blocksDate ? `${escHtml(item.blocks || "")} ${needText(item, today)}` : "");

  // 오늘의 브리핑(터미널·리미용): 결론 먼저, 기한 지난 결정이 1순위. html은 <strong> 강조, text는 글자만
  function briefing(m) {
    const { project, forecast, waiting, missing, readiness: ready, kickoff: ko, thisWeek: week, today } = m;
    const items = [];
    const add = (html, extra) => items.push({ html, text: html.replace(/<[^>]+>/g, ""), ...extra });
    const p = forecast?.project;
    const lateDecisions = (m.decisions || []).filter((d) => d.dueInfo?.late);
    if (lateDecisions.length)
      add(
        `기한 지난 결정 <strong>${lateDecisions.length}건</strong>: ${lateDecisions
          .slice(0, 2)
          .map((d) => `‘${escHtml(d.title)}’(${escHtml(d.dueInfo.label)})`)
          .join(" · ")}${lateDecisions.length > 2 ? ` 외 ${lateDecisions.length - 2}건` : ""}`,
        { view: "overview", anchor: "decisions", kind: "decision" },
      );
    if (ko?.active && ko.current) {
      const late = week.filter((a) => a.late).length;
      add(
        `킥오프 <strong>${ko.completed}/${ko.stages.length}단계</strong>, 지금은 ‘${escHtml(ko.current.name)}’(${ko.current.done}/${ko.current.total}). 이번 주 할 일 <strong>${week.length}개</strong>${late ? `, 그중 <strong>${late}개는 늦었어요</strong>` : ""}.`,
        { view: "kickoff", kind: "kickoff" },
      );
    }
    const urgent = waiting.filter((i) => i.needLate || i.noReply);
    if (urgent.length) {
      const top = urgent[0];
      add(
        `고객사 답 기다림 ${waiting.length}건 중 <strong>${urgent.length}건 리마인드</strong> — 가장 급한 것 ‘${escHtml(top.title)}’${top.blocksDate ? ` (${waitNeed(top, today)})` : ` (요청 D+${top.waitDays})`}.`,
        { view: "requests", kind: "remind" },
      );
    }
    if (p) {
      const label = `${p.targetLabel}(${F.monthDay(p.target)})`;
      if (p.status === "on") add(`${label}은 <strong>순항</strong>입니다. 지금 속도면 ${F.shortDate(p.netFinish)}에 남은 이슈가 끝납니다.`, { view: "schedule", kind: "forecast" });
      else
        add(
          `${label} <strong>${FORECAST_STATUS[p.status].label}</strong>: 지금 추세면 마감에 <strong>약 ${num(p.remainingAtTarget)}건이 남습니다</strong>${p.netFinish ? `(끝나는 날 ${F.monthDay(p.netFinish)})` : ""}. 맞추려면 주 ${num(p.requiredVelocity)}건을 닫아야 합니다(지금 ${num(p.velocity)}건).`,
          { view: "schedule", kind: "forecast" },
        );
    } else if (!ko?.active) {
      add(`킥오프 준비율 <strong>${ready.percent}%</strong> (${ready.ready}/${ready.total}). 일정 예측은 이슈 트래커를 연결하면 시작됩니다.`, { view: "kickoff", kind: "kickoff" });
    }
    const first = week.find((a) => a.type === "request") || (missing[0] && { item: missing[0].id, label: `‘${missing[0].title}’` });
    if (missing.length && first) add(`아직 없는 자료 <strong>${missing.length}건</strong> — 먼저 ${escHtml(first.label)}.`, { view: "kickoff", filter: "missing", item: first.item, kind: "missing" });
    const late = forecast?.views.filter((view) => view.isLate) ?? [];
    if (late.length)
      add(
        `${late.map((view) => escHtml(view.title.split(" ")[0])).join(", ")} 마감이 지났는데 <strong>${late.reduce((sum, view) => sum + view.open, 0)}건</strong>이 열려 있습니다. 다음 스프린트로 옮길지 정리가 필요해요.`,
        { view: "schedule", kind: "sprint" },
      );
    if (m.recheck?.length) {
      const guess = m.recheck.filter((i) => i.guess).length;
      add(
        `다시 확인할 값 <strong>${m.recheck.length}개</strong> — ${guess === m.recheck.length ? "모두 추정이에요. 직접 확인해 주세요" : guess ? `${guess}개는 추정이에요. 직접 확인해 주세요` : `${STALE_DAYS}일 넘게 원본에서 확인하지 않았어요`}.`,
        { view: "kickoff", filter: "recheck", kind: "recheck" },
      );
    }
    const soon = (m.decisions || []).filter((d) => !d.dueInfo?.late);
    if (soon.length && !lateDecisions.length)
      add(`결정할 일 <strong>${soon.length}건</strong>: ${soon.slice(0, 2).map((d) => `‘${escHtml(d.title)}’${d.dueInfo ? `(${escHtml(d.dueInfo.label)})` : ""}`).join(" · ")}`, { view: "overview", anchor: "decisions", kind: "decision" });
    return items.slice(0, 5);
  }

  // 오늘 먼저 할 것(홈 상태 카드): 지금 바로 할 행동 1~3개와 버튼. 순서: 기한 지난 결정 → 필요일 지난·답 없는 리마인드 → 요청 늦은 자료 → 지난 스프린트 → 위험 → 받은 자료 검토 → 다시 확인
  function todayFirst(m, limit = 3) {
    const { waiting, thisWeek: week, today } = m;
    const out = [];
    const add = (html, action, extra = {}) => out.push({ html, text: html.replace(/<[^>]+>/g, ""), action, ...extra });
    const lateDecisions = (m.decisions || []).filter((d) => d.dueInfo?.late).sort((a, b) => a.dueInfo.date.localeCompare(b.dueInfo.date));
    if (lateDecisions.length)
      add(
        `기한 지난 결정 <strong>${lateDecisions.length}건</strong> — ‘${escHtml(lateDecisions[0].title)}’ <span class="late-t">${escHtml(lateDecisions[0].dueInfo.label)}</span>${lateDecisions.length > 1 ? ` 외 ${lateDecisions.length - 1}건` : ""}`,
        { kind: "go", view: "overview", anchor: "decisions", label: "결정 보기" },
        { kind: "decision" },
      );
    const remind = waiting.filter((i) => i.needLate || i.noReply);
    if (remind.length) {
      const top = remind[0];
      add(
        `고객사 답 <strong>${remind.length}건</strong> 리마인드 — ‘${escHtml(top.title)}’ ${top.needLate ? `<span class="late-t">${escHtml(needText(top, today))}</span>` : `요청 <span class="late-t">D+${top.waitDays}</span>`}`,
        { kind: "remind", items: remind.map((i) => i.id), label: `리마인드 초안 ${remind.length}건` },
        { kind: "remind" },
      );
    }
    const missingLate = week.filter((a) => (a.type === "request" || a.type === "prepare") && a.late);
    if (missingLate.length)
      add(
        `요청·준비가 늦은 자료 <strong>${missingLate.length}건</strong> — 먼저 ${escHtml(missingLate[0].label)}${missingLate[0].date ? ` (${escHtml(`${missingLate[0].dateKind} ${F.monthDay(missingLate[0].date)}`)})` : ""}`,
        { kind: "item", item: missingLate[0].item, label: missingLate[0].type === "request" ? "요청서 만들기" : "열기" },
        { kind: "missing" },
      );
    const sprint = week.find((a) => a.type === "sprint");
    if (sprint) add(escHtml(sprint.label), { kind: "sprint", sprint: sprint.sprint, label: "스프린트 보기" }, { kind: "sprint" });
    const risks = week.filter((a) => a.type === "risk" && a.late);
    if (risks.length) add(`대응 기한 지난 위험 <strong>${risks.length}건</strong> — ${escHtml(risks[0].label)}`, { kind: "go", view: "overview", anchor: "risks", label: "위험 보기" }, { kind: "risk" });
    const review = week.filter((a) => a.type === "review");
    if (review.length) {
      const late = review.filter((a) => a.late).length;
      add(`받은 자료 검토·확정 <strong>${review.length}건</strong>${late ? ` — 그중 ${late}건은 <span class="late-t">필요일 지남</span>` : ""}`, { kind: "go", view: "kickoff", filter: "received", label: "검토 목록" }, { kind: "review" });
    }
    if (m.recheck?.length) {
      const guess = m.recheck.filter((i) => i.guess).length;
      add(`다시 확인할 값 <strong>${m.recheck.length}개</strong> — ${guess === m.recheck.length ? "모두 추정이에요" : guess ? `${guess}개는 추정이에요` : `${STALE_DAYS}일 넘게 확인 안 했어요`}`, { kind: "go", view: "kickoff", filter: "recheck", label: "다시 확인" }, { kind: "recheck" });
    }
    return out.slice(0, limit);
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
    // 스프린트 목표: { "SP-05": { goal } }. 키는 GitHub 마일스톤 제목의 첫 낱말
    project.sprints ||= {};
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
      // 오늘도 넣어 '오늘' 선이 항상 보이게 한다
      const known = [...Object.values(dates), ...project.phases.flatMap((p) => [p.start, p.end]), today].filter(isDate).sort();
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
    for (const key of ["decisions", "risks", "team", "queue", "notes", "contract", "sprints"]) delete copy[key];
    // 출처 링크는 고객 소통 공간(Notion)만 남긴다. GitHub 이슈·저장소 문서 경로는 내부 정보다
    const sharedRes = (res) => (res && /notion\.(so|site|com)/.test(res.url || "") && !/#\d|github/i.test(res.label || "") ? res : undefined);
    copy.checklist = (copy.checklist || []).map(({ internal, history, checked, res, ...rest }) => ({ ...rest, ...(sharedRes(res) ? { res } : {}) }));
    return copy;
  }

  const api = {
    STATUS,
    FORECAST_STATUS,
    HEALTH,
    WAIT_LIMIT_DAYS,
    STALE_DAYS,
    ANCHORS,
    STAGES,
    CONTRACT_REVIEW,
    PAYMENT_STATUS,
    RISK_LEVEL,
    isDate,
    dayLabel,
    dueInfo,
    freshOf,
    explainStep,
    updateState,
    labels,
    anchorDates,
    fill,
    checklist,
    readiness,
    currentPhase,
    nextGate,
    contractSummary,
    kickoff,
    thisWeek,
    sheet,
    health,
    model,
    briefing,
    todayFirst,
    needText,
    LATE,
    requestText,
    reminderText,
    normalize,
    clientSafe,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PMCore = api;
})(typeof window !== "undefined" ? window : globalThis);
