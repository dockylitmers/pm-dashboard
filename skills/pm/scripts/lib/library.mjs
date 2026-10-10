/**
 * 개발 범위(플랫폼·기능)를 고르면 표준 항목 라이브러리(templates/library.json)에서
 * 그 프로젝트에 필요한 체크리스트 항목과 고객사 확인 요청 목록이 정해진다.
 */
import { template, today } from "./common.mjs";

export const library = () => template("library.json");

const included = (libItem, features) => !libItem.when?.length || libItem.when.some((key) => features.includes(key));

function fromLibrary(libItem) {
  const { when, ...rest } = libItem;
  return { ...JSON.parse(JSON.stringify(rest)), status: "missing", lib: true };
}

// 범위를 반영한다. 진행된 항목(요청함·받음·확정)과 직접 만든 항목은 건드리지 않는다
export function applyScope(project, features) {
  const lib = library();
  const valid = new Set(lib.features.map((f) => f.key));
  const unknown = features.filter((key) => !valid.has(key));
  if (unknown.length) throw new Error(`모르는 기능: ${unknown.join(", ")} (pm scope --list로 확인)`);
  project.scope = { ...(project.scope || {}), features: [...new Set(features)] };
  project.categories = project.categories?.length ? project.categories : lib.categories;
  for (const cat of lib.categories) if (!project.categories.some((c) => c.id === cat.id)) project.categories.push(cat);
  project.checklist ||= [];
  const added = [];
  const disabled = [];
  const enabled = [];
  for (const libItem of lib.items) {
    const existing = project.checklist.find((item) => item.id === libItem.id);
    const want = included(libItem, project.scope.features);
    if (!existing) {
      if (want) {
        project.checklist.push(fromLibrary(libItem));
        added.push(libItem.title);
      }
      continue;
    }
    if (!want && existing.status === "missing") {
      existing.status = "not_needed";
      existing.scopeOff = true;
      existing.history = [...(existing.history || []), { date: today(), text: "범위에 없어 해당 없음" }];
      disabled.push(existing.title);
    } else if (want && existing.status === "not_needed" && existing.scopeOff) {
      existing.status = "missing";
      delete existing.scopeOff;
      existing.history = [...(existing.history || []), { date: today(), text: "범위에 다시 들어옴" }];
      enabled.push(existing.title);
    }
  }
  return { added, disabled, enabled };
}

export function newProject({ id, name, client, repo, dates, features, from }) {
  if (from === "sample") {
    const sample = template("sample-project.json");
    return { ...sample, id };
  }
  const base = template("project.json");
  const contract = template("contract.json");
  const project = {
    ...base,
    id,
    name: name || id,
    client: client || "",
    asOf: today(),
    dates: { ...base.dates, ...dates },
    contract: {
      signedAt: null,
      review: contract.review.map((r) => ({ ...r, status: "unchecked", note: "" })),
      payments: contract.payments.map((p) => ({ ...p, status: "planned" })),
    },
  };
  if (repo) project.github = { repo };
  applyScope(project, features);
  return project;
}
