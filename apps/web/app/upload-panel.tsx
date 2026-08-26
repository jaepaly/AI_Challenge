"use client";

import { useEffect, useState } from "react";
import type { CardPreset } from "../lib/marginguard/snapshot";
import { toUploadedPreset } from "../lib/marginguard/uploaded-card";

/**
 * 약관 업로드 (D)
 * ---------------------------------------------------------------------------
 * 심사위원이 자기 약관을 올려 **AI 가 어디 있는지** 보는 화면이다. 계산은 여전히
 * 엔진이 하고, 이 패널이 하는 일은 파일을 `/api/ingest` 로 보내 조건카드를 받아
 * 카드 목록에 얹는 것뿐이다.
 *
 * ## 왜 진행 상황을 초 단위로 보여주는가
 *
 * 2패스 실측이 **43.8~68.1초**다. 스피너만 돌리면 그 시간이 "멈춘 것"으로 읽힌다.
 * 남은 시간을 지어내지 않고 **경과 초와 실측 기준**을 함께 적는다 — 예측이 아니라 관측이다.
 *
 * ⚠ **한 값이 아니라 범위다.** 성공 기록이 둘이고 서로 다르다::
 *
 *     4차  2026-08-16  프롬프트 70ce01c9  68.1초
 *     8차  2026-08-25  프롬프트 c7b6effc  43.8초   <- 현재 코드
 *
 *   최신값 하나만 쓰면 44초라고 말하게 되는데, **짧게 부르는 쪽이 더 나쁘다** —
 *   68초가 걸리는 날 사용자는 멈춘 줄 안다. n=2 를 n=1 인 척하지 않는다.
 *
 * ⚠ 단계(1패스/2패스)는 **표시하지 않는다.** 서버가 진행률을 스트리밍하지 않으므로
 *   브라우저는 지금 어느 패스인지 모른다. 모르는 것을 그럴듯하게 그리지 않는다.
 *
 * ## 실패는 화면을 죽이지 않는다
 *
 * 업로드가 안 되는 상태(미연결·한도·상류 장애)에서도 **사전 계산된 카드로 계속 쓸 수
 * 있다**는 것이 사실이고, 그 문장을 서버가 이미 준다(`route.ts`). 여기서는 그것을
 * 지어내지 않고 받은 대로 보여준다.
 */

/**
 * 한투 실측 범위. 예측이 아니라 **"이만큼 걸린 적이 있다"** 는 관측이다.
 * 값을 고칠 일이 생기면 `benchmarks/results/` 의 성공 기록에서 가져와라 — 기억으로
 * 고치지 마라. 지금 근거는 `hankook_two_pass.json`(68.1초)과
 * `hankook_two_pass_attempt8_success.json`(43.8초) 둘이다.
 */
const OBSERVED_MIN_SECONDS = 44;
const OBSERVED_MAX_SECONDS = 68;

type State =
  | { phase: "idle" }
  | { phase: "sending"; startedAt: number }
  | { phase: "failed"; message: string; detail?: string }
  | { phase: "done"; label: string };

export default function UploadPanel({ onCard }: { onCard: (preset: CardPreset) => void }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state.phase !== "sending") return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - state.startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [state]);

  async function send(file: File) {
    setElapsed(0);
    setState({ phase: "sending", startedAt: Date.now() });

    const body = new FormData();
    body.append("file", file);

    let response: Response;
    try {
      response = await fetch("/api/ingest", { method: "POST", body });
    } catch {
      setState({ phase: "failed", message: "요청을 보내지 못했습니다 — 연결을 확인해 주세요" });
      return;
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      /* 본문이 JSON 이 아닐 수 있다 — 아래에서 상태 코드로 말한다 */
    }
    const asRecord = (payload ?? {}) as { error?: string; detail?: string };

    if (!response.ok) {
      setState({
        phase: "failed",
        // 서버가 이유를 알고 우리보다 정확하다. 여기서 다시 쓰지 않는다.
        message: asRecord.error ?? `약관 분석에 실패했습니다 (${response.status})`,
        detail: asRecord.detail,
      });
      return;
    }

    const result = toUploadedPreset(payload, file.name);
    if (!result.ok) {
      setState({ phase: "failed", message: result.reason });
      return;
    }
    onCard(result.preset);
    setState({ phase: "done", label: result.preset.label });
  }

  const busy = state.phase === "sending";

  return (
    <section className="upload" aria-label="약관 업로드" id="uploadPanel">
      <h2>내 증권사 약관으로 직접 해 보기</h2>
      <p className="uploadLead">
        신용거래설명서(PDF·HTML)를 올리면 <b>AI 가 조항을 읽고 인용해</b> 조건카드를
        만듭니다. <b>계산은 그 카드로 엔진이 합니다</b> — 수치를 모델이 만들지 않습니다.
      </p>

      <div className="uploadRow">
        <input
          id="uploadFile"
          type="file"
          accept=".pdf,.htm,.html"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void send(file);
          }}
        />
        {busy && (
          <button type="button" className="uploadBtn" disabled>
            분석 중…
          </button>
        )}
      </div>

      {state.phase === "sending" && (
        <p id="uploadStatus" className="uploadBusy" role="status">
          <b>{elapsed}초</b> 경과 — 실측 기준 약 {OBSERVED_MIN_SECONDS}~{OBSERVED_MAX_SECONDS}초
          걸립니다. 인용을 모으고 카드를 조립하는 두 단계라 오래 걸립니다. 창을 닫지 마세요.
        </p>
      )}

      {state.phase === "failed" && (
        <p id="uploadStatus" className="uploadFail" role="alert">
          ⚠ {state.message}
          {state.detail && <span className="uploadDetail"> — {state.detail}</span>}
        </p>
      )}

      {state.phase === "done" && (
        <p id="uploadStatus" className="uploadDone" role="status">
          ✔ <b>{state.label}</b> 카드를 만들었습니다. 위 카드 목록에서 선택돼 있습니다 —
          <b>검수 전(draft)</b> 이라 참고 모드 배너가 함께 뜹니다.
        </p>
      )}

      {/* ⚠ 이 문단은 **확인한 것만** 적는다. "저장하지 않는다"는 우리 코드를 읽고
          확인했다(인제스트는 업로드 바이트를 메모리에서 파싱만 하고 어디에도 쓰지
          않는다). 그런데 **Anthropic 으로 전송되는 것은 사실**이고, 금융 문서를 올리는
          사람에게 그건 알아야 할 정보다. 우리 저장소만 말하고 전송을 빼면 절반만
          말하는 것이 된다. */}
      <p className="uploadNote">
        올린 파일은 <b>우리 서버에 저장하지 않습니다</b> — 조건카드를 만드는 데만 씁니다.
        다만 조항을 읽기 위해 <b>Anthropic API 로 전송</b>됩니다. 대외비 문서는 올리지
        마세요. PDF·HTML, 4MB 까지.
      </p>
    </section>
  );
}
