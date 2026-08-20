/**
 * 준비도 — **제품이 답을 내는가**를 서버에서 판정한다 (W5 무중단 리허설용).
 * ---------------------------------------------------------------------------
 * `/api/build`의 문서주석이 이미 옳은 말을 한다 — *"옛 커밋을 서빙하는 배포도
 * 200을 준다. 살아 있는 것과 올바른 것은 다르다."* 이 파일은 그 다음 층이다:
 *
 *   **올바른 커밋을 서빙해도 제품이 답을 못 낼 수 있다.**
 *
 * 실제 사례가 이미 정해져 있다(#54). 스냅숏 카드의 `verified_at`이 2026-08-09라
 * 30일 게이트가 2026-09-09에 닫힌다. 심사 기간은 9/7~9/11이므로:
 *
 *     9/07  29일  calculated
 *     9/08  30일  calculated
 *     9/09  31일  blocked      ← 여기부터 화면이 "산정 불가"
 *     9/10  32일  blocked
 *     9/11  33일  blocked
 *
 * **`/api/build`는 이 사흘 내내 200에 올바른 sha를 준다.** 서버는 살아 있고
 * 제품만 죽어 있다. 폴링이 sha만 보면 결격 사유를 사흘 동안 못 본다.
 *
 * ## 시간대 — 판정은 심사위원 기준(KST)으로 한다
 *
 * 화면의 `asOf`는 `todayISO(new Date())`, 즉 **브라우저 로컬 날짜**다. 심사위원은
 * 한국에 있고 서버(Vercel)는 UTC다. KST가 UTC+9이므로 **매일 9시간 동안 둘의
 * 날짜가 다르다**:
 *
 *     2026-09-08T15:30Z  →  서버 UTC 9/8 (fresh)  /  심사위원 KST 9/9 (blocked)
 *
 * 서버 날짜로 판정하면 그 9시간을 놓친다. 놓치는 방향이 **낙관**(문제 없다고
 * 말함)이라 더 나쁘다. 그래서 기본 판정 기준일은 KST다.
 *
 * ## 만료일을 상수로 복사하지 않는다
 *
 * `blockedFrom`은 엔진의 30일 상수를 베끼지 않고 **`freshnessView`를 날짜별로
 * 실제 호출해** 찾는다. 상수를 복사하면 엔진이 바뀔 때 이 파일만 조용히 낡는다.
 * 정본은 엔진이고 여기는 관측자다.
 *
 * API 호출은 0회다. 신선도 판정은 순수 계산이라 폴링해도 비용이 없다 —
 * `/api/ingest/health`를 무인 폴링 대상으로 삼지 말라는 README §5-C 경고가
 * 여기에는 걸리지 않는다.
 */

import type { ConditionCard } from "@marginguard/engine";
import { CARDS } from "./snapshot";
import { freshnessView, todayISO, type FreshnessMode } from "./freshness-view";

/** 앞으로 이만큼까지만 만료일을 찾는다. 못 찾으면 null — 없는 날짜를 지어내지 않는다. */
const FORECAST_HORIZON_DAYS = 120;

const MS_PER_DAY = 86_400_000;
/** 심사위원 기준 시간대. 서버가 어디서 돌든 화면이 보는 날짜로 판정한다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 주어진 순간의 KST 날짜(YYYY-MM-DD). */
export function kstToday(now: Date): string {
  return todayISO(new Date(now.getTime() + KST_OFFSET_MS - localOffsetMs(now)));
}

/**
 * `todayISO`가 로컬 시간대로 읽으므로, 로컬 오프셋을 먼저 상쇄해야 KST가 된다.
 * (서버가 UTC면 0, 개발자 노트북이 KST면 -9시간.)
 */
function localOffsetMs(now: Date): number {
  return -now.getTimezoneOffset() * 60_000;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export interface CardReadiness {
  broker: string;
  label: string;
  status: ConditionCard["status"];
  mode: FreshnessMode;
  reason: string;
  ageDays: number | null;
  /**
   * verified인데 `calculated`가 아니면 degraded.
   * draft는 설계상 항상 `reference`이므로 degraded가 아니다 — 그걸 degraded로
   * 세면 하한가형 카드 때문에 상시 빨간불이 되고, 진짜 신호가 묻힌다.
   */
  degraded: boolean;
  /** 이 카드가 `blocked`로 넘어가는 첫 날. 이미 blocked거나 예측 불가면 null. */
  blockedFrom: string | null;
}

export interface Readiness {
  /** verified 카드 중 하나라도 계산을 못 내면 false. */
  ok: boolean;
  /** 판정 기준일 (KST). */
  asOf: string;
  cards: CardReadiness[];
  /** degraded인 카드 label. 비어 있어야 정상. */
  degraded: string[];
  /** 가장 이른 `blockedFrom`. 지금 정상이어도 여기가 다가오면 조치가 필요하다. */
  nextBlockedAt: string | null;
  /** `nextBlockedAt`까지 남은 일수. 리허설이 임계값을 걸 자리다. */
  daysUntilBlocked: number | null;
}

function findBlockedFrom(card: ConditionCard, asOf: string): string | null {
  if (freshnessView(card, asOf).mode === "blocked") return null; // 이미 지났다
  for (let d = 1; d <= FORECAST_HORIZON_DAYS; d += 1) {
    const day = addDays(asOf, d);
    if (freshnessView(card, day).mode === "blocked") return day;
  }
  return null; // 지평선 안에 없다 — draft 카드가 여기로 온다
}

export function readiness(now: Date, cards = CARDS): Readiness {
  const asOf = kstToday(now);

  const rows: CardReadiness[] = cards.map((preset) => {
    const view = freshnessView(preset.card, asOf);
    return {
      broker: preset.card.broker,
      label: preset.label,
      status: preset.card.status,
      mode: view.mode,
      reason: view.verdict.reason,
      ageDays: view.verdict.ageDays,
      degraded: preset.card.status === "verified" && view.mode !== "calculated",
      blockedFrom: findBlockedFrom(preset.card, asOf),
    };
  });

  const upcoming = rows
    .map((r) => r.blockedFrom)
    .filter((d): d is string => d !== null)
    .sort();
  const nextBlockedAt = upcoming[0] ?? null;

  return {
    ok: rows.every((r) => !r.degraded),
    asOf,
    cards: rows,
    degraded: rows.filter((r) => r.degraded).map((r) => r.label),
    nextBlockedAt,
    daysUntilBlocked:
      nextBlockedAt === null
        ? null
        : Math.round((Date.parse(nextBlockedAt) - Date.parse(asOf)) / MS_PER_DAY),
  };
}
