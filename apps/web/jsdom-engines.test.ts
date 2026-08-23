/**
 * jsdom 이 **CI 의 node 에서 실제로 설치되는지** 지킨다.
 * ---------------------------------------------------------------------------
 * 2026-08-23, #72 에서 실제로 일어난 일:
 *
 *   apps/web/package.json   "jsdom": "^29.1.1"      ← 고쳤다
 *   CI(node 20) 결과        Test Files 16 / Tests 198 / Errors 1
 *                           Cannot find package 'jsdom' imported from
 *                           node_modules/vitest/dist/chunks/index.*.js
 *
 * 새로 넣은 jsdom 환경 테스트 8 개가 **한 개도 안 돌았는데 그게 안 보였다.**
 * 로컬은 초록이었다 — 로컬 node_modules 에 옛 jsdom 30.0.1 이 남아 있었고
 * 로컬 node 는 22 라 그게 그냥 돌았다. 선언은 29 인데 검증은 30 으로 한 것이다.
 *
 * 기전은 셋이 겹쳐 있다:
 *   ① vitest 가 루트 node_modules 로 호이스팅되고, jsdom 을 자기 위치에서 찾는다.
 *      apps/web 에만 적은 ^29 는 apps/web/node_modules 에 들어가 소용이 없었다
 *   ② 루트가 비어 있으면 npm 이 그 자리를 vitest 의 optional peer(`jsdom: "*"`)로
 *      채우며 **최신 메이저**를 고른다 — 30.x
 *   ③ 30.x 의 engines 는 node ^22.22.2 || ^24.15.0 || >=26.0.0 이고 **optional 이라
 *      node 20 에서 npm 이 경고 없이 건너뛴다.** engines 불일치 경고조차 안 난다
 *
 * 그래서 루트 package.json 이 jsdom 을 직접 선언해 그 자리를 점유한다. 아래 검사는
 * 셋이 다시 겹치지 않는지를 각각 본다.
 *
 * ⚠ 이 파일은 **jsdom 환경을 쓰지 않는다**(기본 node 환경). 확인 대상이 jsdom 자신이라,
 *   jsdom 이 없으면 못 도는 검사는 바로 그 순간에 침묵한다 — 막으려는 실패가 그것이다.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** vitest 는 워크스페이스(apps/web)에서 돈다. 저장소 루트는 두 단계 위다. */
const ROOT = resolve(process.cwd(), "..", "..");

const readJson = (...parts: string[]): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(ROOT, ...parts), "utf8")) as Record<string, unknown>;

/**
 * engines 범위가 어떤 메이저를 받아 주는지 — **보수적으로** 읽는다.
 * 해석하지 못한 절은 "안 받아 준다"로 친다. 틀리는 방향이 헛경보여야 한다.
 * 조용한 통과는 안 된다 — 이 파일이 생긴 이유가 바로 조용한 통과다.
 */
function admitsMajor(range: string, major: number): boolean {
  return range.split("||").some((clause) => {
    const c = clause.trim();
    const caret = /^\^\s*(\d+)\./.exec(c);
    if (caret) return Number(caret[1]) === major;
    const gte = /^>=\s*(\d+)\./.exec(c);
    if (gte) return major >= Number(gte[1]);
    const gt = /^>\s*(\d+)\./.exec(c);
    if (gt) return major > Number(gt[1]);
    return false;
  });
}

/** ci.yml 이 선언한 node 메이저 전부. 잡 하나만 보면 다른 잡이 새어 나간다. */
function ciNodeMajors(): number[] {
  const yml = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
  const hits = yml.match(/node-version:\s*['"]?\d+/g) ?? [];
  return hits.map((hit) => Number(/(\d+)$/.exec(hit)?.[1] ?? NaN));
}

describe("jsdom 은 CI 의 node 에서 설치된다", () => {
  it("이 검사가 보는 곳이 저장소 루트가 맞다", () => {
    // cwd 가 바뀌면 아래 검사들이 조용히 무의미해진다. 그 전에 여기서 멈춘다.
    expect(existsSync(resolve(ROOT, "package-lock.json"))).toBe(true);
    expect(readJson("package.json").name).toBe("marginguard");
  });

  it("루트 package.json 이 jsdom 을 직접 선언한다 — 그 자리를 optional peer 에 내주지 않는다", () => {
    const dev = readJson("package.json").devDependencies as Record<string, string> | undefined;
    expect(
      dev?.jsdom,
      "루트 선언이 없으면 npm 이 그 자리를 vitest 의 optional peer 로 채우며 최신 메이저를 고른다",
    ).toBeTruthy();
  });

  it("락파일의 jsdom 은 optional 이 아니다 — optional 이면 npm 이 engines 불일치를 조용히 건너뛴다", () => {
    const packages = readJson("package-lock.json").packages as Record<
      string,
      { version?: string; optional?: boolean; peer?: boolean }
    >;
    const entry = packages["node_modules/jsdom"];
    expect(entry, "루트 node_modules/jsdom 항목이 락파일에 없다").toBeTruthy();
    expect(entry.optional, "optional 이면 node 20 에서 통째로 안 깔린다").toBeFalsy();
  });

  it("락파일에 jsdom 이 하나만 있다 — 둘이면 vitest 가 어느 쪽을 쓰는지 알 수 없다", () => {
    const packages = readJson("package-lock.json").packages as Record<string, unknown>;
    const entries = Object.keys(packages).filter((key) => key.endsWith("node_modules/jsdom"));
    expect(entries).toEqual(["node_modules/jsdom"]);
  });

  it("설치된 jsdom 의 engines 가 ci.yml 의 node 메이저를 전부 받아 준다", () => {
    const engines = readJson("node_modules", "jsdom", "package.json").engines as
      | { node?: string }
      | undefined;
    const range = engines?.node;
    expect(range, "jsdom 이 루트에 없다 — vitest 가 resolve 하는 자리다").toBeTruthy();

    const majors = ciNodeMajors();
    expect(majors.length, "ci.yml 에서 node-version 을 하나도 못 읽었다").toBeGreaterThan(0);

    const rejected = majors.filter((major) => !admitsMajor(range as string, major));
    expect(
      rejected,
      `ci.yml 의 node ${rejected.join(",")} 가 jsdom engines "${range}" 밖이다. ` +
        "이 조합에서는 jsdom 환경 테스트가 통째로 안 돈다. jsdom 을 올리려면 " +
        "ci.yml 의 node-version 을 **먼저** 올려라(#72).",
    ).toEqual([]);
  });

  it("지금 도는 node 도 그 engines 안에 있다", () => {
    const engines = readJson("node_modules", "jsdom", "package.json").engines as { node: string };
    const major = Number(process.version.replace(/^v/, "").split(".")[0]);
    expect(
      admitsMajor(engines.node, major),
      `이 node(${process.version})는 jsdom engines "${engines.node}" 밖이다`,
    ).toBe(true);
  });
});
