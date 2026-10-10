/**
 * 일정 예측 계산 (Linear 프로젝트 그래프와 같은 방식).
 * - 최근 7일 구간을 최대 4개 보고, 최근 구간일수록 가중치를 크게 둔다
 * - 낙관·비관 일정은 예상 기간의 ±40%
 * - 기준선(baselineEnd)까지 만든 이슈는 처음부터 있던 범위로 보고 새 이슈 유입에서 뺀다
 * 브라우저(window.PMForecast)와 bun/node(module.exports) 양쪽에서 읽는다. DOM에 의존하지 않는다.
 */
((root) => {
  const KST = "Asia/Seoul";
  const DAY_MS = 86_400_000;
  const WEEK_MS = 7 * DAY_MS;
  const FORECAST_WEEKS = 4;
  const FORECAST_BUFFER = 0.4;
  const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

  const kstFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // 날짜 계산은 KST 날짜 문자열(YYYY-MM-DD) 단위로 한다
  const kstDate = (value) =>
    kstFormatter.format(value instanceof Date ? value : new Date(value));
  const kstMidnight = (date) => new Date(`${date}T00:00:00+09:00`);
  const addDays = (date, days) =>
    kstDate(new Date(kstMidnight(date).getTime() + days * DAY_MS));
  const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
  const isWorkday = (date) => weekdayOf(date) !== 0 && weekdayOf(date) !== 6;
  const daysBetween = (from, to) =>
    Math.round(
      (kstMidnight(to).getTime() - kstMidnight(from).getTime()) / DAY_MS,
    );

  function workdaysBetween(from, to) {
    let count = 0;
    for (let day = from; day <= to; day = addDays(day, 1))
      if (isWorkday(day)) count += 1;
    return count;
  }

  function nextWorkday(date) {
    let day = date;
    while (!isWorkday(day)) day = addDays(day, 1);
    return day;
  }

  // from을 첫날로 세어 count번째 근무일
  function nthWorkday(from, count) {
    let day = from;
    let seen = isWorkday(day) ? 1 : 0;
    while (seen < count) {
      day = addDays(day, 1);
      if (isWorkday(day)) seen += 1;
    }
    return day;
  }

  // 예: 10/8(목)
  function shortDate(date) {
    if (!date) return "-";
    const [, month, day] = date.split("-");
    return `${Number(month)}/${Number(day)}(${WEEKDAYS_KO[weekdayOf(date)]})`;
  }

  function monthDay(date) {
    if (!date) return "-";
    const [, month, day] = date.split("-");
    return `${Number(month)}/${Number(day)}`;
  }

  // sync-github.ts의 짧은 키를 풀어 쓴다
  function normalizeIssues(rawIssues) {
    return rawIssues.map((item) => ({
      number: item.n,
      title: item.t,
      state: item.s,
      reason: item.r,
      createdAt: item.c,
      closedAt: item.x,
      milestone: item.m,
      labels: item.l,
      assignees: item.a,
    }));
  }

  const isCompleted = (item) =>
    item.state === "closed" &&
    item.reason !== "not_planned" &&
    item.reason !== "duplicate";
  const isDropped = (item) => item.state === "closed" && !isCompleted(item);
  const closedBefore = (item, time) =>
    !!item.closedAt && new Date(item.closedAt).getTime() < time;
  const createdBefore = (item, time) =>
    new Date(item.createdAt).getTime() < time;

  function sprintStart(view) {
    const match = view.title.match(/(\d{1,2})\/(\d{1,2})\s*~/);
    if (!view.due) return null;
    if (!match) return addDays(view.due, -4);
    return `${view.due.slice(0, 4)}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  }

  /**
   * @param {object} input
   * @param {Array} input.issues        normalizeIssues 결과
   * @param {Array} input.milestones    sync-github.ts의 milestones
   * @param {number} input.now          기준 시각(ms). 스냅샷이면 동기화 시각
   * @param {object} input.config       { baselineEnd, epicLabel, descopeLabel }
   * @param {object} [input.scenario]   { velocityPct, inflowPct, descope } — 가정 시뮬레이션
   */
  // 스프린트·출시 마일스톤을 알아보는 제목 규칙. 프로젝트마다 forecastConfig로 바꿀 수 있다
  const DEFAULT_SPRINT_PATTERN = "^(SP|Sprint|스프린트)[-\\s]?\\d+";
  const DEFAULT_RELEASE_PATTERN = "출시|release|launch";

  function compute({ issues, milestones, now, config, scenario = {} }) {
    const sprintPattern = new RegExp(config.sprintPattern || DEFAULT_SPRINT_PATTERN, "i");
    const releasePattern = new RegExp(config.releasePattern || DEFAULT_RELEASE_PATTERN, "i");
    const today = kstDate(new Date(now));
    const baselineCutoff = kstMidnight(
      addDays(config.baselineEnd, 1),
    ).getTime();
    const isNewWork = (item) => !createdBefore(item, baselineCutoff);
    const hasLabel = (item, names) =>
      item.labels.some((name) => names.includes(name));

    const views = milestones
      .map((item) => {
        const total = item.open + item.closed;
        return {
          number: item.number,
          title: item.title,
          due: item.due,
          open: item.open,
          closed: item.closed,
          total,
          percent: total === 0 ? 0 : Math.round((item.closed / total) * 100),
          isSprint: sprintPattern.test(item.title),
          isRelease: releasePattern.test(item.title),
        };
      })
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
    for (const view of views) {
      view.start = view.isSprint ? sprintStart(view) : null;
      view.isLate = !!view.due && view.due < today && view.open > 0;
    }
    const current =
      views.find((view) => view.due !== null && view.due >= today) ?? null;
    if (current) current.isCurrent = true;

    const sprints = views.filter((view) => view.isSprint && view.due);
    const release = views.find((view) => view.isRelease) ?? null;
    const lastSprint = sprints.at(-1);
    // 일정 예측 목표: 남은 스프린트가 있으면 마지막 스프린트 마감(개발 마감), 없으면 출시 마일스톤
    const target =
      lastSprint && lastSprint.due >= today
        ? { date: lastSprint.due, label: "개발 마감" }
        : release?.due && release.due >= today
          ? { date: release.due, label: "출시" }
          : null;
    const trackingStart = sprints[0]?.start ?? addDays(today, -28);

    // 예측 범위: 에픽·descope와 목표일 뒤 마일스톤 이슈는 뺀다
    const dueByMilestone = new Map(
      views.map((view) => [view.number, view.due]),
    );
    const scope = issues.filter((item) => {
      if (hasLabel(item, [config.epicLabel, config.descopeLabel])) return false;
      const due = item.milestone ? dueByMilestone.get(item.milestone) : null;
      return !(target && due && due > target.date);
    });

    // 최근 7일 구간별 완료 수(velocity)와 순유입 수(inflow = 생성 - 취소)
    const trackingStartMs = kstMidnight(trackingStart).getTime();
    let velocity = 0;
    let inflow = 0;
    let weightSum = 0;
    let weeks = 0;
    const weekly = [];
    for (let index = 0; index < FORECAST_WEEKS; index += 1) {
      const end = now - index * WEEK_MS;
      const start = end - WEEK_MS;
      if (start < trackingStartMs) break;
      const inWindow = (time) =>
        !!time &&
        new Date(time).getTime() >= start &&
        new Date(time).getTime() < end;
      const done = scope.filter(
        (item) => isCompleted(item) && inWindow(item.closedAt),
      ).length;
      const created = scope.filter(
        (item) => isNewWork(item) && inWindow(item.createdAt),
      ).length;
      const dropped = scope.filter(
        (item) => isDropped(item) && inWindow(item.closedAt),
      ).length;
      const weight = FORECAST_WEEKS - index;
      velocity += done * weight;
      inflow += (created - dropped) * weight;
      weightSum += weight;
      weeks += 1;
      weekly.unshift({
        end: kstDate(new Date(end - 1)),
        done,
        created,
        dropped,
      });
    }
    const rates =
      weeks > 0 && velocity > 0
        ? {
            velocity: velocity / weightSum,
            inflow: Math.max(0, inflow / weightSum),
            weeks,
          }
        : null;

    const openScope = scope.filter((item) => item.state === "open").length;
    let project = null;
    if (target && rates) {
      const velocityAdj =
        rates.velocity * (1 + (scenario.velocityPct ?? 0) / 100);
      const inflowAdj = rates.inflow * (1 + (scenario.inflowPct ?? 0) / 100);
      const remaining = Math.max(0, openScope - (scenario.descope ?? 0));
      const daysToFinish = (remaining / velocityAdj) * 7;
      // 예상일이 주말이면 다음 월요일로 본다
      const after = (days) => nextWorkday(addDays(today, Math.ceil(days)));
      const net = velocityAdj - inflowAdj;
      const daysToTarget = Math.max(
        0,
        (kstMidnight(addDays(target.date, 1)).getTime() - now) / DAY_MS,
      );
      const netFinish = net > 0 ? after((remaining / net) * 7) : null;
      const expected = after(daysToFinish);
      const status =
        netFinish && netFinish <= target.date
          ? "on"
          : expected <= target.date
            ? "risk"
            : "off";
      // 목표일까지 남은 이슈를 0으로 만들려면 필요한 주간 처리량(유입 포함)
      const requiredVelocity =
        daysToTarget > 0 ? remaining / (daysToTarget / 7) + inflowAdj : null;
      project = {
        target: target.date,
        targetLabel: target.label,
        velocity: velocityAdj,
        inflow: inflowAdj,
        baseVelocity: rates.velocity,
        baseInflow: rates.inflow,
        weeks: rates.weeks,
        remaining,
        expected,
        optimistic: after(daysToFinish * (1 - FORECAST_BUFFER)),
        pessimistic: after(daysToFinish * (1 + FORECAST_BUFFER)),
        netFinish,
        remainingAtTarget: Math.max(
          0,
          Math.round(remaining - (net * daysToTarget) / 7),
        ),
        requiredVelocity,
        status,
      };
    }

    // 남은 이슈 추이: 실적과 두 가지 전망(새 이슈가 없을 때, 지금 추세가 이어질 때)
    const chart = { actual: [], noNewWork: [], trend: [] };
    for (let day = trackingStart; day <= today; day = addDays(day, 1)) {
      const end = day === today ? now : kstMidnight(addDays(day, 1)).getTime();
      chart.actual.push({
        x: day,
        y: scope.filter(
          (item) => createdBefore(item, end) && !closedBefore(item, end),
        ).length,
      });
    }
    if (project) {
      const net = project.velocity - project.inflow;
      const horizon =
        project.pessimistic > project.target
          ? project.pessimistic
          : project.target;
      for (
        let day = today, offset = 0;
        day <= horizon;
        day = addDays(day, 1), offset += 1
      ) {
        // 0에 닿으면 선을 멈춘다
        if (chart.noNewWork.at(-1)?.y !== 0) {
          chart.noNewWork.push({
            x: day,
            y: Math.max(
              0,
              Math.round(project.remaining - (project.velocity * offset) / 7),
            ),
          });
        }
        if (day <= project.target)
          chart.trend.push({
            x: day,
            y: Math.max(0, Math.round(project.remaining - (net * offset) / 7)),
          });
      }
    }

    // 이번 스프린트: 지금까지의 근무일 하루 평균 완료 속도로 마감일까지 끝낼 수 있는지
    let sprint = null;
    if (current?.isSprint) {
      const sprintIssues = issues.filter(
        (item) => item.milestone === current.number,
      );
      const open = sprintIssues.filter((item) => item.state === "open").length;
      const base = {
        view: current,
        start: current.start,
        open,
        total: sprintIssues.length,
      };
      const elapsed =
        current.start < today
          ? workdaysBetween(current.start, addDays(today, -1))
          : 0;
      if (open === 0)
        sprint = {
          ...base,
          pace: null,
          finish: today,
          carryover: 0,
          status: "on",
        };
      else if (elapsed === 0)
        sprint = {
          ...base,
          pace: null,
          finish: null,
          carryover: 0,
          status: null,
        };
      else {
        const startMs = kstMidnight(current.start).getTime();
        const doneSinceStart = sprintIssues.filter(
          (item) => isCompleted(item) && !closedBefore(item, startMs),
        ).length;
        const pace = doneSinceStart / elapsed;
        const daysLeft = workdaysBetween(today, current.due);
        const daysNeeded =
          pace > 0 ? Math.ceil(open / pace) : Number.POSITIVE_INFINITY;
        if (daysNeeded <= daysLeft)
          sprint = {
            ...base,
            pace,
            finish: nthWorkday(today, daysNeeded),
            carryover: 0,
            status: "on",
          };
        else {
          const carryover = Math.max(1, Math.round(open - pace * daysLeft));
          const status =
            carryover <= Math.max(1, Math.round(sprintIssues.length * 0.2))
              ? "risk"
              : "off";
          sprint = { ...base, pace, finish: null, carryover, status };
        }
      }
    }

    // 스프린트 주(월~일)별 생성·완료·취소 수. 진행 중인 주는 지금까지만 센다
    const flow = sprints
      .filter((view) => view.start <= today)
      .map((view) => {
        const end = addDays(view.start, 6);
        const partial = today <= end;
        const from = kstMidnight(view.start).getTime();
        const to = partial ? now : kstMidnight(addDays(end, 1)).getTime();
        const inWindow = (time) =>
          !!time &&
          new Date(time).getTime() >= from &&
          new Date(time).getTime() < to;
        return {
          name: view.title.split(" ")[0],
          start: view.start,
          end,
          partial,
          opened: scope.filter(
            (item) => isNewWork(item) && inWindow(item.createdAt),
          ).length,
          done: scope.filter(
            (item) => isCompleted(item) && inWindow(item.closedAt),
          ).length,
          canceled: scope.filter(
            (item) => isDropped(item) && inWindow(item.closedAt),
          ).length,
        };
      });

    return {
      today,
      now,
      target,
      trackingStart,
      views,
      current,
      release,
      scope,
      openScope,
      rates,
      weekly,
      project,
      chart,
      sprint,
      flow,
    };
  }

  const api = {
    compute,
    normalizeIssues,
    isCompleted,
    kstDate,
    addDays,
    daysBetween,
    shortDate,
    monthDay,
    weekdayOf,
    DAY_MS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PMForecast = api;
})(typeof window !== "undefined" ? window : globalThis);
