const KIS_MIN_INTERVAL_MS = 1_000;

let lastRunAt = 0;
let queue = Promise.resolve();

/**
 * 데드라인을 존중하는 sleep — 예산이 끝났으면 자지 않고, 자는 중 끝나면 깬다.
 *
 * 만료를 오류로 만들지 않고 조용히 반환한다. 호출부가 곧바로 fetch를 시도하고,
 * 이미 abort된 signal을 받은 fetch가 즉시 거부하며 그쪽에서 504로 매핑된다 —
 * 만료 처리는 한 곳(client.ts의 isAbortError)에만 두는 편이 낫다.
 */
function sleep(ms: number, deadline?: AbortSignal) {
  if (deadline?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      deadline?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    deadline?.addEventListener("abort", finish, { once: true });
  });
}

export function enqueueKisCall<T>(
  task: () => Promise<T>,
  deadline?: AbortSignal,
): Promise<T> {
  const run = queue.then(async () => {
    // 큐 대기도 예산 안이다 — 앞선 요청이 길면 여기서만 몇 초를 쓴다
    const waitMs = Math.max(0, KIS_MIN_INTERVAL_MS - (Date.now() - lastRunAt));
    if (waitMs > 0) {
      await sleep(waitMs, deadline);
    }

    try {
      return await task();
    } finally {
      lastRunAt = Date.now();
    }
  });

  queue = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

/**
 * 레이트리밋 백오프 — **요청 데드라인을 넘겨 자지 않는다.**
 *
 * 데드라인을 안 보면 8초 예산이 실질 10초가 된다. 만료가 백오프 도중에 오면
 * 그 sleep이 끝까지 자고 나서야 다음 시도가 거부되기 때문이다. 2회차 백오프가
 * 2초라 최악은 t=7.99s 도착 → 백오프 2s → t=9.99s이고, 라우트의 maxDuration이
 * 10초라 **여유가 0**이었다. 그 창에 걸리면 우리 {ok:false} 대신 플랫폼 오류가
 * 나간다 — 저하 모드가 정확히 필요한 순간에만 사라지는 셈이다(#39 리뷰).
 *
 * 실측(수정 전): 429 지연 2,700ms에서 총 9,441ms.
 */
export async function backoffKisRateLimit(
  attempt: number,
  deadline?: AbortSignal,
) {
  await sleep(1_000 * attempt, deadline);
}
