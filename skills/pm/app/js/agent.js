/**
 * 리미: 대시보드를 관리하는 PM 에이전트 캐릭터.
 * - 내장 모드: 키가 없어도 대시보드 데이터로 답하고, 화면을 열거나 요청서 초안을 승인 대기열에 넣는다.
 * - Claude 모드: 사용자가 넣은 API 키로 브라우저에서 Claude Messages API를 직접 호출하고, 아래 도구로 대시보드를 읽고 조작한다.
 *   빌드 없이 file://로 여는 단일 페이지라 SDK 대신 fetch로 호출한다.
 * 리미는 고객사·팀에 직접 보내지 않는다. 나가는 글은 모두 승인 대기열을 거친다.
 */
(() => {
  const App = window.PMApp;
  if (!App) return;
  const $ = (selector) => document.querySelector(selector);
  const { esc, fmt, icon } = App;
  const KEY_STORE = "pm-dashboard:anthropic-key";
  const MODEL = "claude-opus-5-5";
  const MOOD_TEXT = {
    good: "프로젝트가 순항 중이라 파랗게 물들었어요",
    watch: "주의할 게 있어 보라색이에요",
    risk: "위험 신호가 있어 빨갛게 물들었어요",
  };

  const els = {
    fab: $("#limi-fab"),
    fabAvatar: $("#limi-fab-avatar"),
    fabBubble: $("#limi-fab-bubble"),
    fabDot: $("#limi-fab-dot"),
    chat: $("#chat"),
    chatAvatar: $("#limi-chat-avatar"),
    mood: $("#limi-mood"),
    mode: $("#limi-mode"),
    settings: $("#chat-settings"),
    log: $("#chat-log"),
    chips: $("#chat-chips"),
    form: $("#chat-form"),
    text: $("#chat-text"),
    apiKey: $("#api-key"),
  };

  let model = App.getModel();
  let busy = false;
  let claudeHistory = [];
  let historyProject = model.project.id;

  // pm serve에 ANTHROPIC_API_KEY가 있으면 true (/api/config로 확인)
  let serverClaude = false;
  const getKey = () => {
    try {
      return localStorage.getItem(KEY_STORE) || "";
    } catch {
      return "";
    }
  };

  // ---------------------------------------------------------------- 겉모습
  function paint() {
    const mood = model.health.key;
    const progress = App.progressOf(model);
    els.fabAvatar.innerHTML = App.limiSvg({
      size: 44,
      mood,
      progress,
      thinking: busy,
    });
    els.chatAvatar.innerHTML = App.limiSvg({
      size: 38,
      mood,
      progress,
      thinking: busy,
    });
    const signals = model.health.reasons.length;
    els.fabBubble.innerHTML = `리미<small>${esc(model.health.label)}${signals ? ` · 살펴볼 신호 ${signals}개` : ""} · 눌러서 브리핑</small>`;
    els.fabDot.hidden = !(
      model.waiting.some((item) => item.overdue) || model.health.level >= 2
    );
    els.mood.textContent = MOOD_TEXT[mood];
    const connected = claudeReady();
    els.mode.textContent = serverClaude ? "Claude 연결됨 (서버)" : connected ? "Claude 연결됨" : "내장 모드";
    els.mode.classList.toggle("on", connected);
    renderChips();
  }

  function renderChips() {
    const p = model.forecast?.project;
    const chips = ["오늘 뭐부터 해?"];
    if (p) chips.push(`${window.PMForecast.monthDay(p.target)} 맞출 수 있어?`);
    if (model.waiting.length) chips.push("고객사 답 기다리는 거 정리해줘");
    // 고객사에서 받아야 하는 정책 항목, 환불 관련을 먼저
    const open = (item) =>
      item.cat === "policy" &&
      item.ball === "client" &&
      (item.status === "missing" || item.status === "requested");
    const policyMissing =
      model.checklist.find(
        (item) => open(item) && item.title.includes("환불"),
      ) || model.checklist.find(open);
    if (policyMissing)
      chips.push(`${policyMissing.title.split("(")[0].trim()} 요청서 써줘`);
    chips.push(
      model.project.srs?.exists ? "SRS 어디까지 됐어?" : "SRS 만들어줘",
    );
    chips.push("위험 요소는?");
    els.chips.innerHTML = chips
      .map((c) => `<button type="button">${esc(c)}</button>`)
      .join("");
  }

  // ---------------------------------------------------------------- 대화창
  function addMessage(role, html, actions = []) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.innerHTML = html;
    if (actions.length) {
      const row = document.createElement("div");
      row.className = "act";
      for (const action of actions) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `btn small${action.primary ? " accent" : ""}`;
        btn.innerHTML = `${action.icon ? icon(action.icon) : ""}${esc(action.label)}`;
        btn.addEventListener("click", () => action.run());
        row.appendChild(btn);
      }
      div.appendChild(row);
    }
    els.log.appendChild(div);
    els.log.scrollTop = els.log.scrollHeight;
    return div;
  }

  function typing(on) {
    busy = on;
    let el = $("#limi-typing");
    if (on && !el) {
      el = document.createElement("div");
      el.id = "limi-typing";
      el.className = "msg bot typing";
      el.innerHTML = "<i></i><i></i><i></i>";
      els.log.appendChild(el);
      els.log.scrollTop = els.log.scrollHeight;
    } else if (!on && el) el.remove();
    paint();
  }

  function greet() {
    const items = App.briefing(model);
    addMessage(
      "bot",
      `안녕하세요, ${esc(model.project.name)} 대시보드를 맡고 있는 리미예요. 지금 프로젝트는 <b>${esc(model.health.label)}</b> 상태라 몸이 ${model.health.key === "good" ? "파랗게" : model.health.key === "watch" ? "보랏빛으로" : "빨갛게"} 물들었어요.\n\n${items.map((item, i) => `${i + 1}. ${item.text}`).join("\n")}\n\n일정·고객사 요청·SRS 무엇이든 물어보세요. 고객사에 보낼 글은 제가 초안을 쓰고, 보내는 건 승인 뒤에 사람이 해요.`,
    );
  }

  function open() {
    els.chat.classList.add("open");
    els.fab.hidden = true;
    if (!els.log.children.length) greet();
    els.text.focus();
  }
  function close() {
    els.chat.classList.remove("open");
    els.fab.hidden = false;
  }

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    addMessage("me", esc(message));
    els.text.value = "";
    if (claudeReady()) {
      typing(true);
      try {
        await claudeTurn(message);
      } catch (error) {
        addMessage(
          "sys",
          esc(`Claude 연결에 실패해 내장 모드로 답해요 (${error.message})`),
        );
        localReply(message);
      } finally {
        typing(false);
      }
    } else {
      typing(true);
      setTimeout(() => {
        typing(false);
        localReply(message);
      }, 380);
    }
  }

  function ask(text) {
    open();
    send(text);
  }

  // ---------------------------------------------------------------- 내장 모드
  function matchItem(text) {
    // 숫자만 있는 말(10/30 등)은 날짜라서 항목 찾기에 쓰지 않는다
    const words = text
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2 && /\p{L}/u.test(w));
    let best = null;
    let bestScore = 0;
    for (const item of model.checklist) {
      const title = item.title.replace(/\s+/g, "");
      let score = 0;
      for (const word of words) {
        const stem = word.replace(
          /(정책|규정|문서|요청서|요청|써줘|해줘|이|가|은|는|을|를|의)$/u,
          "",
        );
        if (stem.length >= 2 && title.includes(stem)) score += stem.length;
      }
      if (/정책|약관|방침/.test(text) && item.cat === "policy") score += 1;
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return bestScore >= 2 ? best : null;
  }

  function itemReply(item) {
    const st = App.STATUS[item.status];
    const lines = [
      `<b>${esc(item.title)}</b> — ${esc(st.label)}${item.waitDays != null ? ` · 요청한 지 D+${item.waitDays}` : ""}`,
    ];
    if (item.note) lines.push(esc(item.note));
    if (item.blocks)
      lines.push(`이게 없으면 <b>${esc(item.blocks)}</b>이(가) 막혀요.`);
    const actions = [];
    if (item.status === "missing") {
      lines.push(
        `\n없는 자료는 ① 받을 곳(요청 DB·드라이브·메일·저장소)을 고르고 ② 고객사에 요청할지, 우리가 (제안) 초안을 쓰고 확인만 받을지 정한 뒤 ③ 요청서를 승인 대기열에 넣으면 돼요.${item.proposal ? `\n(제안) 값도 미리 채워 둘게요: ${esc(item.proposal)}` : ""}`,
      );
      actions.push({
        label: "요청서 만들기",
        icon: "send",
        primary: true,
        run: () => App.navigate("kickoff", { item: item.id }),
      });
      if (item.cat === "policy")
        actions.push({
          label: "초안 쓰고 확인 받기",
          icon: "doc",
          run: () =>
            App.navigate("kickoff", {
              item: item.id,
              preset: { mode: "draft" },
            }),
        });
      actions.push({
        label: "바로 대기열에 넣기",
        icon: "sparkles",
        run: () => queueRequest(item),
      });
    } else if (item.status === "requested") {
      lines.push(
        item.waitDays > 7
          ? `\n일주일이 넘었어요. 막히는 기능과 기한을 적어 리마인드하는 걸 권해요.`
          : `\n아직 기다릴 만해요. ${item.due ? `${App.esc(item.due)} 기한 전까지` : "D+7이 되면"} 리마인드할게요.`,
      );
      actions.push({
        label: "리마인드 초안",
        icon: "send",
        primary: item.waitDays > 7,
        run: () => App.navigate("kickoff", { item: item.id }),
      });
    } else {
      actions.push({
        label: "자세히 보기",
        icon: "arrow",
        run: () => App.navigate("kickoff", { item: item.id }),
      });
    }
    if (item.res?.url)
      actions.push({
        label: "원본 열기",
        icon: "ext",
        run: () => window.open(item.res.url, "_blank", "noopener"),
      });
    addMessage("bot", lines.join("\n"), actions);
  }

  function queueRequest(item, mode = "ask") {
    const opts = {
      receive: item.receiveAt || model.project.receiveDefault || "notion",
      mode: item.mode || mode,
      due: item.due || addDaysToday(5),
    };
    const entry = App.addToQueue({
      kind: "request",
      itemId: item.id,
      title: `${item.title} 요청`,
      to: model.project.clientContact || `${model.project.client} 담당자`,
      channel: App.RECEIVE[opts.receive].label,
      ...opts,
      text: App.requestText(model, item, opts),
      by: "limi",
    });
    addMessage(
      "bot",
      `‘${esc(item.title)}’ 요청서를 승인 대기열에 넣었어요. 읽어 보고 보내 주세요.<div class="draft">${esc(entry.text)}</div>`,
      [
        {
          label: "승인 대기열 열기",
          icon: "send",
          primary: true,
          run: () => App.openQueue(),
        },
      ],
    );
    return entry;
  }

  const addDaysToday = (n) =>
    window.PMForecast.addDays(window.PMForecast.kstDate(new Date()), n);

  function scheduleReply() {
    const f = model.forecast;
    const p = f?.project;
    if (!p) {
      addMessage(
        "bot",
        `아직 이슈 트래커가 연결되지 않아 완료일을 예측할 수 없어요. 계획상 개발은 ${esc(model.project.dates.devStart)}~${esc(model.project.dates.devEnd)}, 출시는 ${esc(model.project.dates.launch)}예요.\n지금은 킥오프 준비율 <b>${model.readiness.percent}%</b>가 일정에 가장 큰 변수예요.`,
        [
          {
            label: "킥오프 체크리스트",
            icon: "check",
            run: () => App.navigate("kickoff"),
          },
        ],
      );
      return;
    }
    const st = App.FORECAST_STATUS[p.status];
    const S = window.PMForecast;
    const lines = [];
    if (p.status === "on")
      lines.push(
        `<b>네, 맞출 수 있어요.</b> 새 이슈 유입까지 감안해도 ${S.shortDate(p.netFinish)}에 끝나요.`,
      );
    else {
      lines.push(`<b>지금 추세로는 어려워요 (${esc(st.label)}).</b>`);
      lines.push(
        `• 새 이슈가 멈추면 ${S.shortDate(p.expected)} 완료 (낙관 ${S.monthDay(p.optimistic)} ~ 비관 ${S.monthDay(p.pessimistic)})`,
      );
      lines.push(
        `• 하지만 주 ${fmt(p.inflow)}건이 새로 들어오고 ${fmt(p.velocity)}건을 닫고 있어서, ${S.monthDay(p.target)}에 <b>약 ${fmt(p.remainingAtTarget)}건</b>이 남아요.`,
      );
      lines.push(`\n맞추려면 셋 중 하나(또는 조합)가 필요해요:`);
      lines.push(
        `① 처리량을 주 ${fmt(p.requiredVelocity)}건으로 (+${fmt(((p.requiredVelocity - p.velocity) / p.velocity) * 100)}%)`,
      );
      const weeks = Math.max(0.1, S.daysBetween(f.today, p.target) / 7);
      const maxInflow = p.velocity - p.remaining / weeks;
      lines.push(
        maxInflow > 0
          ? `② 새 이슈 유입을 주 ${fmt(maxInflow)}건 이하로 (내부 QA 버그 분류·중복 정리, 출시 후로 미룰 것 표시)`
          : `② 유입을 0으로 줄여도 지금 속도로는 부족해요 — 유입 관리만으로는 안 돼요`,
      );
      lines.push(
        `③ 범위 조정: 출시에 꼭 필요하지 않은 이슈를 descope로 빼기 (단, 유입이 처리보다 많으면 범위만 줄여서는 다시 쌓여요)`,
      );
      const late = f.views.filter((v) => v.isLate);
      if (late.length)
        lines.push(
          `\n그리고 ${late.map((v) => esc(v.title.split(" ")[0])).join(", ")}에 지난 마감 이슈 ${late.reduce((s, v) => s + v.open, 0)}건이 남아 있어요. 다음 스프린트로 옮길지 먼저 정리해요.`,
        );
    }
    addMessage("bot", lines.join("\n"), [
      {
        label: "일정·속도 보기",
        icon: "chart",
        primary: true,
        run: () => App.navigate("schedule"),
      },
      {
        label: "가정: 유입 -30%",
        icon: "sparkles",
        run: () => App.navigate("schedule", { scenario: { inflowPct: -30 } }),
      },
      {
        label: "가정: 속도 +30%",
        icon: "sparkles",
        run: () => App.navigate("schedule", { scenario: { velocityPct: 30 } }),
      },
    ]);
  }

  function waitingReply() {
    const w = model.waiting;
    if (!w.length)
      return addMessage("bot", "고객사 답을 기다리는 항목이 없어요. 👍");
    const lines = [
      `고객사 답을 기다리는 항목 <b>${w.length}건</b>이에요 (오래된 순).`,
    ];
    for (const item of w.slice(0, 6))
      lines.push(
        `• <b>D+${item.waitDays}</b> ${esc(item.title)}${item.blocks ? ` → ${esc(item.blocks)} 막힘` : ""}`,
      );
    const overdue = w.filter((item) => item.overdue);
    if (overdue.length)
      lines.push(
        `\n일주일 넘은 ${overdue.length}건은 막히는 기능과 기한을 적어 한 번에 리마인드하는 걸 권해요. 회신이 없을 때의 대안((제안) 값)도 같이 적을게요.`,
      );
    addMessage(
      "bot",
      lines.join("\n"),
      [
        overdue.length && {
          label: `리마인드 ${overdue.length}건 초안`,
          icon: "send",
          primary: true,
          run: () => {
            for (const item of overdue)
              App.addToQueue({
                kind: "reminder",
                itemId: item.id,
                title: `${item.title} 리마인드`,
                to: `${model.project.client} 담당자`,
                channel:
                  App.RECEIVE[
                    item.receiveAt || model.project.receiveDefault || "notion"
                  ].label,
                receive:
                  item.receiveAt || model.project.receiveDefault || "notion",
                text: App.reminderText(model, item),
                by: "limi",
              });
            addMessage(
              "bot",
              `리마인드 초안 ${overdue.length}건을 승인 대기열에 넣었어요.`,
              [
                {
                  label: "승인 대기열 열기",
                  icon: "send",
                  primary: true,
                  run: () => App.openQueue(),
                },
              ],
            );
          },
        },
        {
          label: "대기 목록 보기",
          icon: "clock",
          run: () => App.navigate("kickoff", { filter: "requested" }),
        },
      ].filter(Boolean),
    );
  }

  function kickoffReply() {
    const { readiness, missing } = model;
    const byCat = model.project.categories
      .map((cat) => ({
        cat,
        n: missing.filter((item) => item.cat === cat.id).length,
      }))
      .filter((r) => r.n);
    const lines = [
      `킥오프 준비율 <b>${readiness.percent}%</b> (${readiness.ready}/${readiness.total} 확정), 아직 없는 자료 <b>${missing.length}건</b>.`,
    ];
    if (byCat.length)
      lines.push(byCat.map((r) => `• ${esc(r.cat.name)} ${r.n}건`).join("\n"));
    const soon = missing
      .filter((item) => item.blocksDate)
      .sort((a, b) => a.blocksDate.localeCompare(b.blocksDate))
      .slice(0, 3);
    if (soon.length)
      lines.push(
        `\n먼저 챙길 것 (막는 일정이 빠른 순):\n${soon.map((item) => `• ${esc(item.title)} → ${esc(item.blocks)} ${esc(window.PMForecast.shortDate(item.blocksDate))}`).join("\n")}`,
      );
    addMessage(
      "bot",
      lines.join("\n"),
      [
        missing.length && {
          label: "없는 자료 요청서 한꺼번에",
          icon: "send",
          primary: true,
          run: () => {
            App.navigate("kickoff", { filter: "missing" });
            document.querySelector("[data-batch-requests]")?.click();
          },
        },
        {
          label: "체크리스트 보기",
          icon: "check",
          run: () =>
            App.navigate("kickoff", {
              filter: missing.length ? "missing" : "all",
            }),
        },
      ].filter(Boolean),
    );
  }

  function srsReply() {
    const srs = model.project.srs || {};
    if (srs.exists) {
      const c = srs.counts;
      addMessage(
        "bot",
        `SRS는 있어요: ${esc(srs.summary || "")}\n${c ? `고객사 답이 필요한 표시가 <b>확인 요청 ${c.ask}</b> · 제안 ${c.prop} · 준비 필요 ${c.prep}개예요.\n` : ""}\n권장: 돈·날짜·상태·권한·개인정보에 닿는 페이지부터 고객사 확인을 받아 기준선을 먼저 잠그세요. 기준선이 없으면 검수 때 버그와 변경 요청을 구분할 수 없어요.\n보완 도우미로 빠진 절을 찾아 확인 요청 초안까지 만들 수 있어요.`,
        [
          {
            label: "SRS 보완 도우미",
            icon: "sparkles",
            primary: true,
            run: () => App.openSrsWizard({ reset: true }),
          },
          srs.url && {
            label: "SRS 열기",
            icon: "ext",
            run: () => window.open(srs.url, "_blank", "noopener"),
          },
        ].filter(Boolean),
      );
    } else {
      addMessage(
        "bot",
        `이 프로젝트엔 아직 SRS가 없어요. 계약 범위·회의록·기존 이슈를 모아 9개 절짜리 초안을 만들고, 모르는 값은 (제안)으로 채운 뒤 고객사 확인 요청까지 만들어 드릴게요.`,
        [
          {
            label: "SRS 생성 도우미 열기",
            icon: "sparkles",
            primary: true,
            run: () => App.openSrsWizard({ reset: true }),
          },
        ],
      );
    }
  }

  function riskReply() {
    const risks = model.project.risks || [];
    if (!risks.length) return addMessage("bot", "등록된 위험이 없어요.");
    addMessage(
      "bot",
      `지금 위험은 ${risks.length}가지예요 (영향 큰 순).\n${risks.map((r, i) => `${i + 1}. <b>${esc(r.title)}</b>${r.level === "high" ? " (높음)" : ""}\n   ${esc(r.detail)}\n   → ${esc(r.mitigation)}`).join("\n")}`,
      [
        {
          label: "오늘 화면",
          icon: "home",
          run: () => App.navigate("overview"),
        },
      ],
    );
  }

  function issuesReply() {
    const f = model.forecast;
    if (!f) return addMessage("bot", "이슈 트래커가 아직 연결되지 않았어요.");
    const open = f.issues.filter((i) => i.state === "open");
    const by = {};
    for (const i of open)
      for (const a of i.assignees.length ? i.assignees : ["담당 없음"])
        by[a] = (by[a] || 0) + 1;
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
    const bugs = open.filter((i) => i.labels.includes("bug")).length;
    addMessage(
      "bot",
      `열린 이슈 <b>${open.length}건</b> (버그 ${bugs}).\n${rows.map(([name, n]) => `• ${esc(name)} ${n}건`).join("\n")}\n\n한 사람에게 몰려 있으면 다음 스프린트 계획에서 나누는 걸 권해요. 담당 없는 이슈는 배정부터요.`,
      [
        {
          label: "이슈 보기",
          icon: "list",
          primary: true,
          run: () => App.navigate("issues"),
        },
      ],
    );
  }

  function decisionReply(text) {
    const decisions = model.project.decisions || [];
    const target = decisions.find((d) => text.includes(d.title)) || null;
    if (target) {
      addMessage(
        "bot",
        `<b>${esc(target.title)}</b> (기한 ${esc(target.due)})\n\n권장안: <b>${esc(target.recommend)}</b>\n\n결정 요청은 이렇게 정리하면 돼요:\n1) 권장안과 이유 한 줄\n2) 다른 선택지 1~2개와 각각의 대가\n3) 기한과, 그때까지 정하지 않으면 막히는 것\n\n더 깊은 비교(근거·대가 계산)는 Claude 연결 모드에서 해 드릴 수 있어요.`,
      );
    } else {
      addMessage(
        "bot",
        decisions.length
          ? `오늘 결정할 일 ${decisions.length}건이에요.\n${decisions.map((d) => `• <b>${esc(d.title)}</b> — 권장: ${esc(d.recommend)} (기한 ${esc(d.due)})`).join("\n")}`
          : "지금 결정할 일은 없어요.",
      );
    }
  }

  function localReply(text) {
    const t = text.toLowerCase();
    if (/srs|요구사항|명세/.test(t)) return srsReply();
    if (/결정/.test(t)) return decisionReply(text);
    const item = matchItem(text);
    if (
      item &&
      /(요청|보내|받|없|상태|어디|어때|진행|써|초안|리마인드|\?)/.test(text)
    ) {
      if (/요청서|써줘|초안|보내/.test(text) && item.status === "missing")
        return queueRequest(item, item.cat === "policy" ? "draft" : "ask");
      return itemReply(item);
    }
    if (/일정|예측|마감|언제|속도|맞출|끝나|늦|지연|\d+\/\d+/.test(t))
      return scheduleReply();
    if (/고객|대기|기다|회신|답|리마인드/.test(t)) return waitingReply();
    if (/위험|리스크|걱정|문제/.test(t)) return riskReply();
    if (/이슈|버그|담당|누가|배정|roger|nai/.test(t)) return issuesReply();
    if (/킥오프|준비|체크|없는|자료/.test(t)) return kickoffReply();
    if (/오늘|뭐부터|브리핑|요약|현황|상황|안녕|어때/.test(t)) {
      const items = App.briefing(model);
      return addMessage(
        "bot",
        `오늘은 이 순서로 보세요.\n${items.map((item, i) => `${i + 1}. ${item.text}`).join("\n")}`,
        items.slice(0, 3).map((item, i) => ({
          label: ["첫째 보기", "둘째 보기", "셋째 보기"][i],
          icon: "arrow",
          primary: i === 0,
          run: () =>
            App.navigate(item.view, {
              filter: item.filter,
              item: item.item,
              anchor: item.anchor,
            }),
        })),
      );
    }
    addMessage(
      "bot",
      `제가 할 수 있는 건 이래요:\n• 오늘 브리핑과 우선순위\n• 일정 예측과 ‘맞추려면 뭘 바꿔야 하나’\n• 고객사 대기 항목 정리, 요청서·리마인드 초안\n• 없는 자료(예: 환불 정책) 확보 절차\n• SRS 생성·보완 도우미\n• 위험과 담당자별 이슈\n\nClaude를 연결하면 자유 질문도 깊게 답해요.`,
    );
  }

  // ---------------------------------------------------------------- Claude 모드
  const SYSTEM = `너는 '리미'다. ${App.company}(외주 개발사)의 PM 대시보드를 관리하는 PM 에이전트 캐릭터이고, 리트머스 시험지 모양이라 프로젝트 상태에 따라 색이 바뀐다(파랑 순항, 보라 주의, 빨강 위험).
사용자는 ${App.company}의 외주 개발 PM이다. 한국어로, 결론 먼저, 짧은 문장과 목록으로 답한다.

일하는 원칙:
- 숫자와 사실은 도구로 확인한 대시보드 데이터에서만 가져온다. 모르면 모른다고 말하고 어디서 확인할지 알려 준다.
- 일정 예측은 범위로 말한다(예상일, 낙관~비관, 목표일에 남을 양). 유입(새 이슈)과 처리 속도를 구분한다.
- 외주 프로젝트에서는 '공'이 누구에게 있는지가 중요하다. 고객사 대기 항목은 대기 일수와 막히는 일정을 같이 말한다.
- 없는 자료는 받을 곳과 진행 방식(고객사 요청 / ${App.company} 초안 후 확인 / 회의 안건)을 제안하고, 요청서는 빈칸 대신 (제안) 값을 채운다.
- 고객사에 보내는 글은 결론만 쓴다. 이슈 번호, 내부 메모, 코드 용어를 넣지 않는다.
- 결정을 도울 때는 권장안 먼저, 선택지 2~3개, 기한, 정하지 않으면 막히는 것을 쓴다.
- 너는 아무것도 직접 보내지 않는다. 요청서·리마인드는 draft_client_request 도구로 승인 대기열에 넣고, 사람이 읽고 보낸다고 말한다.
- 화면을 보여 주는 게 도움이 되면 open_view 도구로 해당 화면을 연다.`;

  const TOOLS = [
    {
      name: "get_dashboard",
      description:
        "현재 프로젝트의 대시보드 상태를 읽는다: 일정·마일스톤, 일정 예측(처리·유입 속도, 예상 완료일, 목표일에 남을 이슈), 이번 스프린트, 킥오프 체크리스트 전체(상태·공·대기 일수·막는 일정·제안값), 결정 필요, 위험, SRS 요약, 승인 대기열 수. 답하기 전에 먼저 호출한다.",
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "run_scenario",
      description:
        "가정을 바꿔 일정 예측을 다시 계산한다. 처리 속도·유입 변화율(%)과 범위에서 뺄 이슈 수를 넣으면 예상 완료일과 목표일에 남을 이슈 수를 돌려준다.",
      input_schema: {
        type: "object",
        properties: {
          velocity_pct: {
            type: "number",
            description: "주간 처리 속도 변화율(%). 예: 30은 30% 빠르게",
          },
          inflow_pct: {
            type: "number",
            description: "새 이슈 유입 변화율(%). 예: -50은 절반으로",
          },
          descope: { type: "integer", description: "범위에서 뺄 열린 이슈 수" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "list_issues",
      description:
        "GitHub 이슈 스냅샷에서 이슈를 찾는다. 최대 limit건(기본 20)의 번호·제목·라벨·담당·마일스톤·경과 일수를 돌려준다.",
      input_schema: {
        type: "object",
        properties: {
          state: { type: "string", enum: ["open", "closed", "all"] },
          label: { type: "string" },
          assignee: {
            type: "string",
            description: "GitHub 아이디. 'none'이면 담당 없음",
          },
          query: { type: "string", description: "제목에 들어간 말" },
          limit: { type: "integer" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "draft_client_request",
      description:
        "체크리스트 항목에 대한 고객사 요청서 또는 리마인드 초안을 만들어 승인 대기열에 넣는다. 보내지는 않는다. extra_note에 덧붙일 문장을 넣을 수 있다.",
      input_schema: {
        type: "object",
        properties: {
          item_id: {
            type: "string",
            description: "get_dashboard의 checklist[].id",
          },
          receive: {
            type: "string",
            enum: ["notion", "drive", "email", "repo"],
            description: "받을 곳",
          },
          mode: {
            type: "string",
            enum: ["ask", "draft", "meeting"],
            description: `고객사 요청 / ${App.company} 초안 후 확인 / 회의 안건`,
          },
          due: { type: "string", description: "회신 기한 YYYY-MM-DD" },
          extra_note: { type: "string" },
        },
        required: ["item_id"],
        additionalProperties: false,
      },
    },
    {
      name: "open_view",
      description: "사용자 화면에서 대시보드 화면이나 체크리스트 항목을 연다.",
      input_schema: {
        type: "object",
        properties: {
          view: {
            type: "string",
            enum: ["overview", "kickoff", "schedule", "issues", "resources"],
          },
          item_id: { type: "string", description: "열 체크리스트 항목(선택)" },
          filter: {
            type: "string",
            enum: ["all", "missing", "requested", "received", "confirmed"],
          },
        },
        required: ["view"],
        additionalProperties: false,
      },
    },
    {
      name: "open_srs_wizard",
      description:
        "SRS 생성(또는 보완) 도우미를 연다. SRS가 없거나 고객 확인 요청을 만들 때 쓴다.",
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ];

  function dashboardSnapshot() {
    const m = App.getModel();
    const f = m.forecast;
    const p = f?.project;
    const round = (n) => (n == null ? null : Math.round(n * 10) / 10);
    return {
      today: window.PMForecast.kstDate(new Date()),
      project: {
        id: m.project.id,
        name: m.project.name,
        client: m.project.client,
        summary: m.project.summary,
        dates: m.project.dates,
        dataAsOf: m.project.asOf,
      },
      health: { label: m.health.label, reasons: m.health.reasons },
      forecast: p
        ? {
            snapshot: f.syncedAt,
            target: p.target,
            targetLabel: p.targetLabel,
            remainingOpenInScope: p.remaining,
            velocityPerWeek: round(p.velocity),
            inflowPerWeek: round(p.inflow),
            expectedIfNoNewIssues: p.expected,
            optimistic: p.optimistic,
            pessimistic: p.pessimistic,
            finishWithInflow: p.netFinish,
            remainingAtTargetAtCurrentTrend: p.remainingAtTarget,
            requiredVelocityPerWeek: round(p.requiredVelocity),
            status: App.FORECAST_STATUS[p.status].label,
            method:
              "최근 4주 7일 구간 가중 평균, 낙관·비관 ±40%",
          }
        : null,
      milestones: f
        ? f.views.map((v) => ({
            title: v.title,
            due: v.due,
            open: v.open,
            closed: v.closed,
            late: v.isLate,
            current: !!v.isCurrent,
          }))
        : [],
      weeklyFlow: f ? f.flow : [],
      sprint: f?.sprint
        ? {
            title: f.sprint.view.title,
            open: f.sprint.open,
            total: f.sprint.total,
            pacePerDay: round(f.sprint.pace),
            carryover: f.sprint.carryover,
          }
        : null,
      readiness: m.readiness,
      checklist: m.checklist.map((i) => ({
        id: i.id,
        category: m.project.categories.find((c) => c.id === i.cat)?.name,
        title: i.title,
        status: App.STATUS[i.status].label,
        ball: App.BALL[i.ball],
        waitDays: i.waitDays,
        requested: i.requested || null,
        due: i.due || null,
        blocks: i.blocks || null,
        note: i.note || null,
        need: i.need || null,
        proposal: i.proposal || null,
        internal: i.internal || null,
        resource: i.res?.label || null,
      })),
      decisions: m.project.decisions || [],
      risks: m.project.risks || [],
      srs: m.project.srs
        ? {
            exists: m.project.srs.exists,
            summary: m.project.srs.summary || null,
            counts: m.project.srs.counts || null,
          }
        : null,
      approvalQueue: m.queue.map((q) => ({
        title: q.title,
        by: q.by || "user",
      })),
    };
  }

  function runTool(name, input) {
    const m = App.getModel();
    switch (name) {
      case "get_dashboard":
        return dashboardSnapshot();
      case "run_scenario": {
        const scenario = {
          velocityPct: Number(input.velocity_pct) || 0,
          inflowPct: Number(input.inflow_pct) || 0,
          descope: Math.max(0, Math.round(Number(input.descope) || 0)),
        };
        const f = App.forecastFor(scenario);
        if (!f?.project)
          return {
            error: "이 프로젝트는 이슈 트래커가 연결되지 않아 예측할 수 없다",
          };
        const p = f.project;
        return {
          scenario,
          target: p.target,
          velocityPerWeek: Math.round(p.velocity),
          inflowPerWeek: Math.round(p.inflow),
          remaining: p.remaining,
          expectedIfNoNewIssues: p.expected,
          optimistic: p.optimistic,
          pessimistic: p.pessimistic,
          finishWithInflow: p.netFinish,
          remainingAtTarget: p.remainingAtTarget,
          status: App.FORECAST_STATUS[p.status].label,
        };
      }
      case "list_issues": {
        const f = m.forecast;
        if (!f) return { error: "이슈 트래커가 연결되지 않았다" };
        const now = new Date(f.syncedAt).getTime();
        const names = new Map(f.views.map((v) => [v.number, v.title]));
        const q = (input.query || "").toLowerCase();
        const list = f.issues
          .filter(
            (i) =>
              (input.state || "open") === "all" ||
              i.state === (input.state || "open"),
          )
          .filter((i) => !input.label || i.labels.includes(input.label))
          .filter(
            (i) =>
              !input.assignee ||
              (input.assignee === "none"
                ? !i.assignees.length
                : i.assignees.includes(input.assignee)),
          )
          .filter((i) => !q || i.title.toLowerCase().includes(q))
          .sort((a, b) => b.number - a.number);
        return {
          total: list.length,
          issues: list.slice(0, Math.min(50, input.limit || 20)).map((i) => ({
            number: i.number,
            title: i.title,
            state: i.state,
            labels: i.labels,
            assignees: i.assignees,
            milestone: names.get(i.milestone) || null,
            ageDays: Math.floor(
              (now - new Date(i.createdAt).getTime()) / 86400000,
            ),
          })),
        };
      }
      case "draft_client_request": {
        const item = m.checklist.find((i) => i.id === input.item_id);
        if (!item)
          return { error: `체크리스트에 ${input.item_id} 항목이 없다` };
        const opts = {
          receive: App.RECEIVE[input.receive]
            ? input.receive
            : item.receiveAt || m.project.receiveDefault || "notion",
          mode: App.MODES[input.mode] ? input.mode : item.mode || "ask",
          due: /^\d{4}-\d{2}-\d{2}$/.test(input.due || "")
            ? input.due
            : item.due || addDaysToday(5),
        };
        let text =
          item.status === "requested"
            ? App.reminderText(m, item)
            : App.requestText(m, item, opts);
        if (input.extra_note)
          text = text.replace(
            /\n감사합니다\.$/,
            `\n${String(input.extra_note).slice(0, 600)}\n감사합니다.`,
          );
        const entry = App.addToQueue({
          kind: item.status === "requested" ? "reminder" : "request",
          itemId: item.id,
          title: `${item.title} ${item.status === "requested" ? "리마인드" : "요청"}`,
          to: `${m.project.client} 담당자`,
          channel: App.RECEIVE[opts.receive].label,
          ...opts,
          text,
          by: "limi",
        });
        return {
          queued: true,
          queueId: entry.id,
          text,
          note: "승인 대기열에 넣었다. 아직 보내지 않았다.",
        };
      }
      case "open_view":
        App.navigate(input.view, { item: input.item_id, filter: input.filter });
        return { opened: input.view, item: input.item_id || null };
      case "open_srs_wizard":
        App.openSrsWizard({ reset: true });
        return { opened: "srs_wizard" };
      default:
        return { error: `알 수 없는 도구 ${name}` };
    }
  }

  async function callClaude(messages) {
    // pm serve가 키를 갖고 있으면 서버를 거친다. 아니면 이 브라우저에 저장한 키로 직접 호출한다
    const url = serverClaude ? "/api/claude" : "https://api.anthropic.com/v1/messages";
    const headers = serverClaude
      ? { "content-type": "application/json" }
      : {
          "content-type": "application/json",
          "x-api-key": getKey(),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          // 안전 분류기가 거절하면 서버가 권장 모델로 다시 시도한다
          "anthropic-beta": "server-side-fallback-2026-07-01",
        };
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        fallbacks: "default",
        system: SYSTEM,
        tools: TOOLS,
        messages,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const reason = body?.error?.message || response.statusText;
      if (response.status === 401) throw new Error("API 키가 맞지 않아요");
      if (response.status === 429)
        throw new Error("요청이 많아 잠시 뒤에 다시 시도해 주세요");
      throw new Error(`${response.status} ${reason}`);
    }
    return response.json();
  }

  const renderText = (text) =>
    esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/^#{1,4}\s*(.+)$/gm, "<b>$1</b>")
      .replace(/^[-*]\s+/gm, "• ");

  async function claudeTurn(message) {
    if (historyProject !== model.project.id) {
      claudeHistory = [];
      historyProject = model.project.id;
    }
    // 대화 기록은 덧붙이기만 한다(이전 턴을 고치지 않는다)
    claudeHistory.push({ role: "user", content: message });
    for (let round = 0; round < 8; round += 1) {
      const result = await callClaude(claudeHistory);
      claudeHistory.push({ role: "assistant", content: result.content });
      if (result.stop_reason === "refusal") {
        addMessage("bot", "이 요청은 답하기 어려워요. 다르게 물어봐 주세요.");
        return;
      }
      const text = result.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const toolUses = result.content.filter((b) => b.type === "tool_use");
      if (text && (result.stop_reason !== "tool_use" || toolUses.length))
        addMessage("bot", renderText(text));
      if (result.stop_reason !== "tool_use" || !toolUses.length) {
        if (result.stop_reason === "max_tokens")
          addMessage("sys", "답이 길어 중간에 끊겼어요.");
        return;
      }
      const results = toolUses.map((block) => {
        try {
          const output = runTool(block.name, block.input || {});
          return {
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(output),
            ...(output?.error ? { is_error: true } : {}),
          };
        } catch (error) {
          return {
            type: "tool_result",
            tool_use_id: block.id,
            content: `도구 실행 실패: ${error.message}`,
            is_error: true,
          };
        }
      });
      for (const block of toolUses)
        if (block.name === "draft_client_request")
          addMessage("sys", "리미가 요청서 초안을 승인 대기열에 넣었어요");
      claudeHistory.push({ role: "user", content: results });
      model = App.getModel();
    }
    addMessage("sys", "도구 호출이 너무 많아 여기서 멈췄어요.");
  }

  // ---------------------------------------------------------------- 이벤트
  els.fab.addEventListener("click", open);
  $("#chat-close").addEventListener("click", close);
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    send(els.text.value);
  });
  els.text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send(els.text.value);
    }
  });
  els.chips.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (btn) send(btn.textContent);
  });
  els.mode.addEventListener("click", () => {
    els.settings.classList.toggle("open");
    if (els.settings.classList.contains("open")) els.apiKey.focus();
  });
  $("#api-save").addEventListener("click", () => {
    const value = els.apiKey.value.trim();
    if (!value) return;
    try {
      localStorage.setItem(KEY_STORE, value);
    } catch {
      App.toast("이 브라우저에서는 키를 저장할 수 없어요");
      return;
    }
    els.apiKey.value = "";
    els.settings.classList.remove("open");
    claudeHistory = [];
    addMessage("sys", "Claude에 연결했어요. 이제 자유롭게 물어보세요.");
    paint();
  });
  $("#api-clear").addEventListener("click", () => {
    try {
      localStorage.removeItem(KEY_STORE);
    } catch {
      // 저장소를 쓸 수 없으면 지울 것도 없다
    }
    claudeHistory = [];
    els.settings.classList.remove("open");
    addMessage("sys", "Claude 연결을 해제했어요. 내장 모드로 답해요.");
    paint();
  });
  window.addEventListener("pm:update", (event) => {
    const projectChanged = event.detail.project.id !== model.project.id;
    model = event.detail;
    paint();
    if (projectChanged && els.log.children.length) {
      addMessage("sys", `${model.project.name} 프로젝트로 바꿨어요`);
      greet();
    }
  });

  const claudeReady = () => serverClaude || !!getKey();
  if (App.SERVER)
    fetch("/api/config")
      .then((response) => (response.ok ? response.json() : {}))
      .then((config) => {
        serverClaude = !!config.claude;
        paint();
      })
      .catch(() => {});

  window.PMAgent = { open, close, ask };
  paint();
})();
