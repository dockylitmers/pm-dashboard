/**
 * 고객사·팀에 보낼 문서를 만든다: 고객사 확인 요청 목록, 주간 진행상황, 킥오프 회의 자료.
 * 브라우저(window.PMDocs)와 pm CLI(node)가 같이 쓴다. 문서는 초안이고, 보내는 것은 사람이다.
 *
 * 고객사 확인 요청 목록은 Notion 요청 페이지와 같은 모양이다:
 *   분야 | 항목 | 확인/요청 내용 | 정보 | 비고사항
 *   '정보' 칸은 `• 라벨: 값` 줄이고, 우리 제안값은 분홍(pink_bg), 고객사 답은 노랑(yellow_bg)
 *   첫 차수 뒤에는 '추가 확인 요청 (M/D)' 구분 줄로 차수를 나눈다
 */
((root) => {
  const node = typeof module !== "undefined" && module.exports;
  const F = node ? require("./forecast.js") : root.PMForecast;
  const Core = node ? require("./core.js") : root.PMCore;

  const FIRST_GUIDE =
    "아래는 개발에 필요한 자료와 확인 사항입니다. 분홍색은 저희가 미리 채운 제안값입니다. 맞으면 그대로 두시고, 다르거나 비어 있는 부분만 노란색으로 적어 주세요. 계정은 비밀번호를 적지 마시고 개발사 계정을 권한 초대해 주세요.";
  const NEXT_GUIDE = "아래 항목은 지금까지 받은 내용과 개발 진행 상황을 바탕으로 미리 채워두었습니다. 맞는지 확인하시고 다르거나 비어 있는 부분만 수정해 주세요.";

  // Notion enhanced markdown에서 특수 문자로 쓰이는 글자를 이스케이프한다
  const notionEsc = (text) => String(text ?? "").replace(/[\\*~`$[\]<>{}|^]/g, (ch) => `\\${ch}`);
  // 일반 Markdown 표 칸 안의 | 와 줄바꿈
  const mdEsc = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  const catName = (project, id) => project.categories.find((c) => c.id === id)?.name || id;
  // 기한: '10/16(금) · D-2', 날짜가 아닌 옛 값은 그대로
  const dueText = (info) => (info.invalid ? info.raw : `${F.shortDate(info.date)} · ${info.label}`);

  function whyText(project, item) {
    const parts = [];
    if (item.need) parts.push(Core.fill(item.need, project));
    if (item.blocks && item.blocksDate) parts.push(`${item.blocks}(${F.monthDay(item.blocksDate)}) 전에 필요`);
    return parts;
  }

  function noteText(project, item) {
    const parts = [];
    if (item.askBy && item.status === "missing") parts.push(`회신 부탁: ${F.shortDate(item.askBy)}까지`);
    // 정보 칸에 제안값이 있으면 비고에 같은 제안을 또 쓰지 않는다
    if (item.proposal && !(item.fields || []).some((f) => f.proposal)) parts.push(`(제안) ${Core.fill(item.proposal, project)}`);
    if (item.note) parts.push(item.note);
    return parts;
  }

  // 정보 칸의 줄들: [{label, proposal, answer}] — 제안값은 날짜를 채워서
  function infoLines(project, item) {
    const lines = (item.fields || []).map((f) => ({ label: f.label, proposal: f.proposal ? Core.fill(f.proposal, project) : "", answer: f.answer || "" }));
    if (item.answer) lines.push({ label: null, proposal: "", answer: item.answer });
    return lines;
  }

  function sheetGroups(m, { onlyPending = false } = {}) {
    const groups = [];
    if (!onlyPending) for (const round of m.sheet.rounds) groups.push({ date: round.date, first: round.first, items: round.items, sent: true });
    if (m.sheet.pending.length) groups.push({ date: m.today, first: onlyPending ? false : groups.length === 0, items: m.sheet.pending, sent: false });
    return groups;
  }

  // 고객사 확인 요청 목록. format: "notion"(Notion에 붙여 넣기) | "md"(일반 Markdown)
  function sheetDocument(m, { format = "notion", onlyPending = false, company = "우리 회사" } = {}) {
    const { project } = m;
    const groups = sheetGroups(m, { onlyPending });
    const title = `${project.name} 개발 관련 요청사항`;
    if (format === "md") {
      const out = [`# ${title}`, "", `> ${FIRST_GUIDE}`, "", `작성: ${company} · ${F.shortDate(m.today)}`, ""];
      for (const group of groups) {
        out.push(group.first ? `## ${group.sent ? `요청 (${F.monthDay(group.date || m.today)})` : "요청"}` : `## 추가 확인 요청 (${F.monthDay(group.date)})`, "");
        if (!group.first) out.push(`> ${NEXT_GUIDE}`, "");
        out.push("| 분야 | 항목 | 확인/요청 내용 | 정보 | 비고사항 |", "|---|---|---|---|---|");
        let lastCat = null;
        for (const item of group.items) {
          const cat = item.cat !== lastCat ? `${catName(project, item.cat)}${group.items.some((i) => i.cat === item.cat && i.priority) ? " ⭐" : ""}` : "";
          lastCat = item.cat;
          const info = infoLines(project, item)
            .map((l) => (l.label ? `• ${l.label}: ${l.answer ? `**${l.answer}**` : l.proposal ? `(제안) ${l.proposal}` : ""}` : `ㄴ ${l.answer}`))
            .join("<br>");
          out.push(`| ${mdEsc(cat)} | ${mdEsc(item.title)} | ${mdEsc(whyText(project, item).join("\n"))} | ${info.replace(/\|/g, "\\|")} | ${mdEsc(noteText(project, item).join("\n"))} |`);
        }
        out.push("");
      }
      out.push("- (제안): 저희가 미리 채운 값입니다. 맞으면 그대로 두셔도 됩니다.", "- 굵은 글씨: 받은 답입니다.");
      return out.join("\n");
    }

    // Notion: 표 하나에 차수 구분 줄. 정보 칸은 분홍(제안)·노랑(답) 글자 배경
    const cell = (text) => `<td>${text}</td>`;
    const rows = [];
    rows.push(`<tr>${["**분야**", "**항목**", "**확인/요청 내용**", "**정보**", "**비고사항**"].map(cell).join("")}</tr>`);
    for (const group of groups) {
      if (!group.first)
        rows.push(`<tr>${cell(`**추가 확인 요청 (${F.monthDay(group.date || m.today)})**`)}${cell("")}${cell("")}${cell(`***- ${notionEsc(NEXT_GUIDE)} -***`)}${cell("")}</tr>`);
      let lastCat = null;
      for (const item of group.items) {
        const priority = group.items.some((i) => i.cat === item.cat && i.priority);
        const cat = item.cat !== lastCat ? `${notionEsc(catName(project, item.cat))}${priority ? " ⭐" : ""}` : "";
        lastCat = item.cat;
        const info = infoLines(project, item)
          .map((l) => {
            const answer = l.answer ? `<span color="yellow_bg">${notionEsc(l.answer)}</span>` : "";
            if (!l.label) return `ㄴ ${answer}`;
            const proposal = l.proposal ? ` <span color="pink_bg">(제안) ${notionEsc(l.proposal)}</span>` : "";
            return `  • ${notionEsc(l.label)}:${l.answer ? ` ${answer}` : proposal}`;
          })
          .join("<br>");
        rows.push(
          `<tr>${cell(cat)}${cell(notionEsc(item.title))}${cell(whyText(project, item).map(notionEsc).join("<br>"))}${cell(info)}${cell(noteText(project, item).map(notionEsc).join("<br>"))}</tr>`,
        );
      }
    }
    return [
      `<callout icon="📋" color="gray_bg">`,
      `\t${notionEsc(FIRST_GUIDE)}`,
      `</callout>`,
      `<table header-row="true">`,
      `\t<colgroup>`,
      `\t\t<col width="110">`,
      `\t\t<col width="170">`,
      `\t\t<col width="230">`,
      `\t\t<col width="440">`,
      `\t\t<col width="230">`,
      `\t</colgroup>`,
      ...rows.map((row) => `\t${row}`),
      `</table>`,
    ].join("\n");
  }

  // 주간 진행상황. client면 고객사에 보내는 판(속도·위험·결정 같은 내부 판단을 뺀다)
  function weeklyReport(m, { client = false } = {}) {
    const { project, forecast, today } = m;
    const monday = F.addDays(today, -((F.weekdayOf(today) + 6) % 7));
    const friday = F.addDays(monday, 4);
    const out = [`[${project.name}] 주간 진행상황 · ${F.shortDate(monday)}~${F.shortDate(friday)}`, ""];
    out.push("■ 요약");
    if (m.kickoff.active && m.kickoff.current) out.push(`- 킥오프 ${m.kickoff.completed}/${m.kickoff.stages.length}단계 진행 중: 지금은 ${m.kickoff.current.name}`);
    const p = forecast?.project;
    if (p && !client) out.push(`- ${p.targetLabel}(${F.monthDay(p.target)}) ${Core.FORECAST_STATUS[p.status].label}: 처리 주 ${Math.round(p.velocity)}건, 유입 주 ${Math.round(p.inflow)}건, 지금 추세면 ${F.monthDay(p.target)}에 약 ${p.remainingAtTarget}건 남음`);
    const current = forecast?.current;
    if (current) out.push(`- 진행 중: ${current.title} (${current.closed}/${current.total} 완료)`);
    const flow = forecast?.flow?.at(-1);
    if (flow) out.push(`- 이번 주 완료 ${flow.done}건${client ? "" : ` · 새 이슈 ${flow.opened}건`}`);
    out.push(`- 준비 자료 ${m.readiness.ready}/${m.readiness.total} 확정`);
    out.push("", "■ 다음 주");
    const next = forecast?.views?.find((v) => v.isSprint && current && v.due > current.due);
    if (next) out.push(`- ${next.title} (${next.total}건 계획)`);
    const nextLines = m.thisWeek.filter((a) => !client || a.type === "request").slice(0, 4).map((a) => `- ${a.text}`);
    // 다음 주에 회신 기한이 오는 요청
    const dueSoon = m.checklist.filter((i) => i.status === "requested" && i.askBy && i.askBy >= today && F.daysBetween(today, i.askBy) <= 7);
    for (const item of dueSoon.slice(0, 4)) nextLines.push(`- ${item.title} 회신 기한 ${F.shortDate(item.askBy)}`);
    out.push(...(nextLines.length ? nextLines : ["- 받은 자료 검토와 다음 단계 준비"]));
    const asks = m.checklist.filter((i) => i.inSheet && i.ball === "client" && (i.status === "requested" || (i.status === "missing" && i.priority)));
    if (asks.length) {
      out.push("", `■ 고객사 확인이 필요한 것 (${asks.length}건)`);
      for (const item of asks.slice(0, 8))
        out.push(`- ${item.title}${item.status === "requested" ? ` (요청 ${F.monthDay(item.requested)}${item.waitDays > Core.WAIT_LIMIT_DAYS ? `, D+${item.waitDays}` : ""})` : ""}${item.askBy ? ` — ${F.monthDay(item.blocksDate)} ${item.blocks} 전에 필요` : ""}`);
    }
    if (!client) {
      if (m.decisions?.length) {
        out.push("", "■ 결정 필요");
        for (const d of m.decisions) out.push(`- ${d.title} — 권장: ${d.recommend}${d.dueInfo ? ` (기한 ${dueText(d.dueInfo)})` : ""}`);
      }
      const done = (m.resolvedDecisions || []).filter((d) => d.decidedAt && F.daysBetween(d.decidedAt, today) <= 7);
      if (done.length) {
        out.push("", "■ 이번 주 정한 것");
        for (const d of done) out.push(`- ${d.title} — ${d.result} (${F.monthDay(d.decidedAt)})`);
      }
      if (m.risks?.length) {
        out.push("", "■ 위험");
        for (const r of m.risks.slice(0, 3)) out.push(`- ${r.title} → ${r.mitigation}${r.owner || r.dueInfo ? ` (${[r.owner && `담당 ${r.owner}`, r.dueInfo && `기한 ${dueText(r.dueInfo)}`].filter(Boolean).join(", ")})` : ""}`);
      }
    }
    return out.join("\n");
  }

  // 킥오프 회의 자료. internal이면 계약 점검·대금·위험 같은 내부 준비를 덧붙인다
  function kickoffKit(m, { internal = false, company = "우리 회사", features = [] } = {}) {
    const { project, today } = m;
    const d = Core.anchorDates(project.dates, today);
    const date = (key) => (d[key] ? F.shortDate(d[key]) : "미정");
    const byId = new Map(m.checklist.map((i) => [i.id, i]));
    const fieldLines = (id) =>
      (byId.get(id)?.fields || []).map((f) => `- ${f.label}: ${f.answer || (f.proposal ? `(제안) ${Core.fill(f.proposal, project)}` : "")}`);
    const out = [
      `# ${project.name} 킥오프 회의`,
      "",
      "- 일시: (정해 주세요) · 장소/링크:",
      `- 참석: ${project.client} 담당자·결정권자, ${company} PM·개발 리드`,
      "",
      "## 1. 프로젝트 개요",
      `- ${project.summary || project.name}`,
    ];
    const scope = project.scope?.features || [];
    if (scope.length) out.push(`- 범위: ${scope.map((key) => features.find((f) => f.key === key)?.label || key).join(", ")}`);
    out.push("", "## 2. 일정", "", "| 단계 | 날짜 |", "|---|---|");
    out.push(`| 킥오프 | ${date("kickoff")} |`, `| 개발 | ${date("devStart")} ~ ${date("devEnd")} |`, `| 고객사 QA | ${date("qaStart")} ~ ${date("qaEnd")} |`);
    if (scope.includes("app")) out.push(`| 스토어 심사 제출 | ${date("storeSubmit")} |`);
    out.push(`| 출시 | ${date("launch")} |`);
    out.push("", "## 3. 소통·보고 방식", ...fieldLines("channel"), ...fieldLines("report"), ...fieldLines("contacts"));
    out.push("", "## 4. 검수와 변경 관리", ...fieldLines("acceptance"), ...fieldLines("change-request"));
    out.push("", "## 5. 고객사에 요청드릴 것", "");
    out.push("자세한 내용과 입력 칸은 ‘개발 관련 요청사항’ 목록으로 따로 드립니다. ⭐는 일정상 먼저 필요한 것입니다.", "");
    // 아직 답을 받지 않은 것(보낼 것과 보낸 것)을 회신 기한 순으로
    const asks = m.checklist
      .filter((i) => i.inSheet && i.ball === "client" && (i.status === "missing" || i.status === "requested"))
      .sort((a, b) => (a.askBy || "9999").localeCompare(b.askBy || "9999"));
    for (const item of asks) out.push(`- ${item.priority ? "⭐ " : ""}${item.title}${item.askBy ? ` — ${F.shortDate(item.askBy)}까지 (${item.blocks} 준비)` : ""}`);
    if (!asks.length) out.push("- 지금 요청드릴 것은 없습니다.");
    out.push("", "## 6. 첫 2주 계획", "");
    for (let week = 0; week < 2; week += 1) {
      const start = F.addDays(today, week * 7);
      const end = F.addDays(start, 6);
      const work = m.checklist.filter(
        (i) => (i.status === "missing" || i.status === "requested") && i.askBy && (week === 0 ? i.askBy <= end : i.askBy > start && i.askBy <= end),
      );
      out.push(`### ${F.shortDate(start)} ~ ${F.shortDate(end)}`);
      if (week === 0) out.push("- 킥오프 회의, 요청 목록 전달, 소통 채널·보고 방식 확정");
      for (const item of work)
        out.push(`- ${item.ball === "client" ? (item.status === "requested" ? "고객사 회신" : "고객사에 요청") : company}: ${item.title}`);
      if (!work.length && week > 0) out.push("- 받은 자료 검토, 개발 착수 준비");
      out.push("");
    }
    const open = m.checklist.filter((i) => i.mode === "meeting" && i.status !== "confirmed");
    out.push("## 7. 회의에서 정할 것");
    out.push("- 범위 기준선(견적서 기능 목록)과 SRS 확인 방식", "- 검수 기준·하자 보수 기간", "- 담당자와 결정권자, 회신 기한을 지키기 어려울 때의 연락 방법");
    for (const item of open) out.push(`- ${item.title}`);
    if (internal) {
      out.push("", "---", "", "## (내부) 회의 전 준비", "");
      const c = m.contract;
      if (c) {
        out.push(`- 계약 점검: 있음 ${c.review.ok} · 불리·모호 ${c.review.risk} · 없음 ${c.review.missing} · 확인 전 ${c.review.unchecked}`);
        for (const r of (project.contract?.review || []).filter((r) => r.status === "risk" || r.status === "missing")) out.push(`  - ${r.title}${r.note ? ` — ${r.note}` : ""}`);
        if (c.next) out.push(`- 다음 대금: ${c.next.name} ${c.next.ratio ? `${c.next.ratio}% ` : ""}(${c.next.trigger}${c.next.dueDate ? `, ${F.shortDate(c.next.dueDate)} 예정` : ""})`);
      }
      for (const r of m.risks || []) out.push(`- 위험: ${r.title} → ${r.mitigation}${r.dueInfo ? ` (기한 ${dueText(r.dueInfo)})` : ""}`);
      for (const dcs of m.decisions || []) out.push(`- 결정 필요: ${dcs.title} (권장: ${dcs.recommend}${dcs.dueInfo ? `, 기한 ${dueText(dcs.dueInfo)}` : ""})`);
    }
    return out.join("\n");
  }

  const api = { sheetDocument, weeklyReport, kickoffKit, FIRST_GUIDE, NEXT_GUIDE };
  if (node) module.exports = api;
  else root.PMDocs = api;
})(typeof window !== "undefined" ? window : globalThis);
