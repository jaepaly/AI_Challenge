import { expect, test, type Page } from "@playwright/test";
import { policyRatio } from "@marginguard/engine";
import { CARDS, PRICE_START, positions } from "../lib/marginguard/snapshot";

/**
 * 유지비율 축 — **카드가 정한 r 이 화면 세 자리에서 같은가** (#64 P0-6 D-2)
 * ---------------------------------------------------------------------------
 * `#84` 로 화면이 `policyRatio(card, pos)` 를 쓰게 됐다. 그 전에는 계산이 원장 리터럴
 * 1.4 를 읽었고, 근거 패널은 카드의 값을 그렸다 — **두 숫자가 갈릴 수 있는 구조**였다.
 * 이 파일은 그 갈라짐이 다시 생기지 않게 고정한다.
 *
 * P0-6 의 골든 시나리오 그대로다::
 *
 *     카드 선택 → 유지비율 근거 확인 → 가격 변화 → 부족액 → 처분수량·경로
 *     → **같은 값이 계산과 근거 양쪽에 표시**
 *
 * ## 왜 브라우저인가
 *
 * `policy` 는 순수 계산이라 jsdom 으로도 충분해 보인다. 그런데 이 검사가 지키려는 것은
 * *"세 자리가 같은 값을 그린다"* 이고, **그중 하나(스냅숏 고지문)는 2026-08-25 까지
 * 리터럴이었다.** 리터럴은 어느 단위 검사에서도 안 걸린다 — 화면 전체를 한 번에 봐야
 * 보인다. 그게 이 파일이 있는 이유다.
 *
 * ⚠ `#75` 가 이미 그 함정을 밟았다: `getByText("140%").first()` 가 근거 패널이 아니라
 *   **상단 고지문**을 잡고 있었다(`evidence-panel.tsx` 주석). 그래서 아래는 전부
 *   **선택자로 범위를 좁혀서** 본다 — 문구로 찾지 않는다.
 *
 * ## 기대값을 리터럴로 박지 않는다
 *
 * `freshness.spec.ts` 가 날짜를 카드에서 파생시킨 것과 같은 이유다. 카드의 r 이 바뀌면
 * 이 파일은 **함께 움직여야** 하고, 바뀐 것을 못 따라가면 그건 검사의 결함이지 화면의
 * 결함이 아니다.
 */

const GOLDEN = CARDS.find((c) => c.key === "hantoo")!;
/** 카드가 이 계좌에 대해 정하는 r. 화면 세 자리가 전부 이 값이어야 한다. */
const GOLDEN_POLICY = policyRatio(GOLDEN.card, positions(PRICE_START)[0]!);

/** 임계가(8,400원) 아래 — `freshness.spec.ts` 와 같은 값을 쓴다. */
const BREACH_PRICE = "8100";

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("#headline")).not.toHaveText("—");
}

async function pick(page: Page, label: string) {
  await page.getByRole("button", { name: new RegExp(label) }).first().click();
}

async function dragToBreach(page: Page) {
  await page.getByLabel("가격 시나리오", { exact: true }).fill(BREACH_PRICE);
  await expect(page.locator("#liqBox")).toBeVisible();
}

/** 근거 패널의 **유지비율 행** 하나. `data-role` 로 좁힌다. */
const evidenceRatio = (page: Page) =>
  page.locator('#evidencePanel .evRow[data-role="ratio"] .evVal');

test.describe("전제 — 이 검사가 볼 대상이 실제로 있다", () => {
  test("골든 카드가 r 을 하나로 정한다", async () => {
    expect(GOLDEN_POLICY.resolved, "골든 카드가 r 을 못 정하면 아래가 전부 무의미하다").toBe(
      true,
    );
  });
});

test.describe("🔴 골든 — 카드의 유지비율이 화면 세 자리에서 같다", () => {
  test("고지문 · 근거 패널 · 계산이 같은 값을 그린다", async ({ page }) => {
    await open(page);
    await pick(page, GOLDEN.label);

    const expected = `${(GOLDEN_POLICY as { centi: number }).centi}%`;

    // ① 상단 고지문 — 2026-08-25 까지 리터럴이었던 자리
    await expect(page.locator("#snapshotRatio")).toHaveText(expected);

    // ② 근거 패널의 유지비율 행 — 약관 원문에서 온 값
    await expect(evidenceRatio(page)).toHaveText(expected);

    // ③ 계산이 그 값으로 돌아간다 — 임계가를 지나면 결론 블록이 뜬다
    await dragToBreach(page);
    await expect(page.locator("#liqQty")).not.toHaveText("");
  });

  test("근거를 펼치면 인용문과 좌표가 함께 보인다 — 값만 있고 출처가 없으면 안 된다", async ({
    page,
  }) => {
    await open(page);
    await pick(page, GOLDEN.label);
    const row = page.locator('#evidencePanel .evRow[data-role="ratio"]');
    await row.locator("summary").first().click();
    await expect(row.locator(".evFull")).toBeVisible();
    // 좌표는 `시작–끝` 형태로 찍힌다. 숫자 두 개가 붙어 있는지만 본다 —
    // 정확한 값은 카드가 정하므로 여기서 리터럴로 박지 않는다.
    await expect(row.locator(".evMeta")).toHaveText(/\d+[–-]\d+/);
  });

  test("처분 수량과 해소 경로가 함께 나온다 — 수량만 내고 끝내지 않는다", async ({ page }) => {
    await open(page);
    await pick(page, GOLDEN.label);
    await dragToBreach(page);
    await expect(page.locator("#liqBox")).toBeVisible();
    await expect(page.locator(".opt")).toBeVisible();
  });
});

test.describe("카드를 바꿔도 세 자리가 함께 움직인다", () => {
  /**
   * ⚠ **지금은 세 프리셋의 r 이 전부 1.4 라 이 검사는 값이 달라지는 것을 못 본다.**
   *   `#64` P0-6 이 지적한 그대로다 — *"세 프리셋의 카드 r 이 `makeCard()` 안에 리터럴
   *   1.4 로 박혀 있어 구조적으로 어긋날 수 없다."* `#84` 는 **화면이 카드를 읽게** 했지
   *   **카드가 서로 달라지게** 하지 않았다.
   *
   *   그래서 이 검사가 지금 지키는 것은 *"값이 바뀐다"* 가 아니라 **"세 자리가 서로
   *   어긋나지 않는다"** 다. r 이 다른 프리셋이 생기는 날 이 검사는 그대로 두고 값만
   *   따라간다 — 기대값을 카드에서 파생시킨 이유가 그것이다.
   */
  for (const preset of CARDS) {
    test(`${preset.label} — 고지문과 근거가 같다`, async ({ page }) => {
      await open(page);
      await pick(page, preset.label);
      const policy = policyRatio(preset.card, positions(PRICE_START)[0]!);
      const expected = policy.resolved ? `${policy.centi}%` : "정하지 못함";
      await expect(page.locator("#snapshotRatio")).toHaveText(expected);
      if (policy.resolved) {
        await expect(evidenceRatio(page)).toHaveText(expected);
      }
    });
  }
});

/**
 * ## 🔴 이 검사가 **못 잡는 것** — 실측으로 확인했다
 *
 * 뮤테이션을 돌렸다(chromium, 7건 기준선)::
 *
 *     고지문을 틀린 리터럴 `150%` 로        -> 4건 실패   ✅
 *     근거 행의 `data-role` 제거             -> 5건 실패   ✅
 *     고지문을 옛 리터럴 `140%` 로 되돌림     -> **7건 통과**  ❌
 *
 * 마지막이 이 파일의 한계였다. **세 프리셋의 r 이 전부 1.4 라, 파생값과 리터럴 140% 가
 * 화면에서 구별되지 않았다.**
 *
 * ⚠ **그건 우연이 아니라 구조였다**(A, `#91` 리뷰). `snapshot.ts` 의 `makeCard()` 가
 *   `ratio` 를 인자로 받지 않고 `ratio_rules` 를 통째로 하드코딩했다::
 *
 *       ratio_rules: [{ …, symbol_group: "일반", ratio: 1.4, … }]
 *
 *   세 프리셋이 전부 이 한 함수에서 나오므로 `hantoo`·`meritz`·`lower` 의 r 이
 *   **1.4 말고 다른 값이 될 수가 없었다.** *"지금 프리셋이 우연히 그렇다"* 로 읽으면
 *   프리셋을 하나 더 넣을 때 고쳐졌다고 착각하게 된다.
 *
 * ✅ **`#95` 로 그 구조가 열렸다.** `makeCard` 가 `ratios` 를 받고, 메리츠가
 *   `A∙B군 1.4` / `C∙D군 1.5` 두 줄이다. 이제 **r 이 1.4 가 아닌 카드가 실재하므로**
 *   `pos.group="C∙D군"` 으로 그린 화면에서는 리터럴 `140%` 가 파생값과 갈린다 —
 *   위 세 번째 줄(`옛 리터럴로 되돌림 → 7건 통과`)을 닫을 재료가 생겼다.
 *
 * ⚠ 다만 **이 파일은 아직 그 재료를 안 쓴다.** 화면에 종목군을 바꾸는 컨트롤이 없어서
 *   E2E 가 `C∙D군` 화면에 도달할 방법이 없기 때문이다(아래 「실패 축」과 같은 원인).
 *   그러니 이 검사가 **지금** 지키는 것은 여전히 *"파생시켰다"* 가 아니라
 *   **"세 자리가 서로 어긋나지 않는다"** 다. 그 이상을 주장하면 안 된다.
 *
 * ⚠ 처음 잰 값은 이것과 달랐다. `{policy…}` 를 `"140%"` 로 바꿨더니 4건이 실패해서
 *   *"잡는다"* 로 읽을 뻔했는데, JSX 텍스트 자리의 `"140%"` 는 **따옴표까지 렌더된다.**
 *   리터럴을 잡은 것이 아니라 따옴표를 잡은 것이었다. `{"140%"}` 로 다시 재니 통과했다.
 *
 * 이 한계는 아래 「실패 축」과 **같은 하나의 원인**에서 온다.
 *
 * ## 실패 축이 여기 없는 이유 — 지금 UI 로는 도달할 수 없다
 *
 * P0-6 이 적은 실패 시나리오는 *"draft 또는 모호 카드 → 근거는 보임 → 금액·수량 차단
 * → 사유 표시"* 인데, 둘 다 지금은 성립하지 않는다.
 *
 *   draft    P0-3 결정으로 **차단하지 않는다**(#30 유지). 참고 모드 라벨만 붙는다.
 *            그 라벨은 `app/landing-draft-label.test.tsx` 가 지킨다.
 *   모호 카드  프리셋 셋이 전부 단일 조항 r=1.4 라 `AMBIGUOUS` 가 안 나온다.
 *
 * **도달 가능한 실패는 신선도 축뿐이고 그것은 `freshness.spec.ts` 가 이미 덮는다.**
 * 유지비율 축의 실패 E2E 는 **r 이 다른 프리셋(또는 종목군 차등 카드)이 생겨야** 쓸 수
 * 있다 — 그게 `#64` §17 의 *"140%→150% 로 바꿨을 때 결과가 바뀌는 장면"* 이 아직
 * 불가능한 이유와 **같은 하나**다. 두 개가 아니라 하나다.
 *
 * ⚠ 여기서 가짜 카드를 만들어 넣지 않는다. 프리셋 카드는 근거 좌표·인용·문서 해시를
 *   달고 있고 그것이 이 제품의 주장이다. 검사를 위해 지어낸 카드를 화면에 넣으면 그
 *   주장이 화면 안에서 깨진다.
 */

/**
 * ## 실패 축 — **카드가 r 을 하나로 못 정하면 수량을 내지 않는다** (#64 P0-6)
 * ---------------------------------------------------------------------------
 * 이 파일 위쪽 「실패 축이 여기 없는 이유」가 **`#95` 로 닫혔다.** 그때는 프리셋 셋이
 * 전부 단일 조항 `r=1.4` 라 `AMBIGUOUS` 가 구조적으로 안 나왔다. 지금은 메리츠가
 * `A∙B군 1.4` / `C∙D군 1.5` 두 줄이다.
 *
 * ⚠ **그런데 화면에는 종목군을 바꾸는 컨트롤이 없다.** `positions()` 가 `"A∙B군"` 이라
 *   메리츠도 좁혀져서 `r=1.4` 로 답한다. 즉 **프리셋만으로는 실패 화면에 도달할 수 없다.**
 *
 * 도달하는 유일한 경로가 **업로드**다. 군이 계좌와 안 맞는 카드가 올라오면 좁히기가
 * 비고 `AMBIGUOUS` 가 된다 — 그리고 그것이 **실제 약관에서 제일 흔한 모양**이다
 * (일반 105% / 관리종목 170%).
 *
 * ## 돈을 쓰지 않는다
 *
 * `/api/ingest` 를 **가로채서** 카드를 돌려준다. 유료 호출은 이미 배포 URL 로 한 번
 * 끝까지 확인했고(첨부2 §5 ④), 이 검사가 보려는 것은 **그 카드를 받은 화면이 무엇을
 * 하는가** 다. 두 질문은 다르고, 뒤 질문에 매번 400원을 쓸 이유가 없다.
 *
 * ⚠ 가로채는 것은 **상류 응답뿐**이다. 업로드 패널 · `toUploadedPreset` · 화면 게이트는
 *   전부 진짜로 돈다. 카드를 손으로 만들어 `setState` 하는 것과 다르다 —
 *   그러면 이 경로에서 실제로 깨질 수 있는 자리를 전부 건너뛴다.
 */

/** 군이 계좌(`A∙B군`)와 안 맞는 카드 — 실제 약관에서 흔한 «일반 / 관리종목» 모양. */
function ambiguousCard() {
  const base = GOLDEN.card;
  const rule = base.ratio_rules[0]!;
  return {
    ...base,
    broker: "업로드테스트",
    // ⚠ **일부러 `verified` 로 보낸다.** 인제스트는 무조건 draft 를 내지만, 이 검사가
    //   보려는 것은 **화면이 그 약속에 기대지 않는다**는 것이다(`uploaded-card.ts:53`).
    //   모의 응답을 draft 로 보내면 강등 로직을 지워도 검사가 초록이다 — 직접 재보고
    //   고쳤다(2026-08-26).
    status: "verified",
    ratio_rules: [
      { ...rule, symbol_group: "일반", ratio: 1.05 },
      { ...rule, symbol_group: "관리종목", ratio: 1.7 },
    ],
  };
}

test.describe("🔴 실패 축 — 좁히지 못하면 숫자를 내지 않는다", () => {
  async function uploadAmbiguous(page: Page) {
    await page.route("**/api/ingest", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ambiguousCard()),
      });
    });
    await open(page);
    await page.locator("#uploadFile").setInputFiles({
      name: "테스트증권_신용거래설명서.htm",
      mimeType: "text/html",
      buffer: Buffer.from("<html><body>probe</body></html>"),
    });
    // 카드가 얹히면 상단 고지가 «정하지 못함» 으로 바뀐다 — 그것이 도착 신호다.
    await expect(page.locator("#snapshotRatio")).toHaveText("정하지 못함");
  }

  /**
   * ⚠ **처음 이 검사를 쓸 때 `#liqBox` 가 «산정 불가» 로 뜰 것이라고 가정했다. 틀렸다.**
   *
   * `r` 이 미정이면 `D = shortfall(V, L, NaN)` 이 `NaN` 이고 `NaN > 0` 은 거짓이라
   * `breached` 가 서지 않는다. 그래서 결론 블록이 **아예 안 뜬다.**
   *
   * 그게 더 정확하다. *"산정 불가"* 는 **관통했는데 수량을 못 낸다**는 뜻이고, 지금은
   * 관통 여부 자체를 모른다. 모르는 것을 «불가» 라고 말하면 그것도 주장이다.
   * 화면은 헤드라인 하나로만 말한다 — **"유지비율을 정하지 못했습니다"**.
   */
  test("가격을 어디로 끌어도 헤드라인이 «정하지 못했습니다» 다", async ({ page }) => {
    await uploadAmbiguous(page);
    const slider = page.getByLabel("가격 시나리오", { exact: true });
    for (const price of ["10000", BREACH_PRICE, "5000"]) {
      await slider.fill(price);
      await expect(page.locator("#headline")).toHaveText("유지비율을 정하지 못했습니다");
    }
  });

  test("결론 블록이 아예 안 뜬다 — 수량도, 거짓 «산정 불가» 도 없다", async ({ page }) => {
    await uploadAmbiguous(page);
    await page.getByLabel("가격 시나리오", { exact: true }).fill("5000");
    await expect(page.locator("#liqBox")).toHaveCount(0);
    await expect(page.locator("#liqQty")).toHaveCount(0);
  });

  test("수량은 안 내지만 **근거는 계속 보여준다**", async ({ page }) => {
    await uploadAmbiguous(page);
    await page.getByLabel("가격 시나리오", { exact: true }).fill("5000");
    // 막는 것과 가리는 것은 다르다 — 재검증하러 가려면 어느 문장인지가 더 필요하다.
    await expect(page.locator("#evidencePanel")).toBeVisible();
    await expect(page.locator('#evidencePanel .evRow[data-role="ratio"] .evVal')).toBeVisible();
  });

  test("검수 전 배너가 함께 뜬다 — 업로드 카드는 정의상 draft 다", async ({ page }) => {
    await uploadAmbiguous(page);
    await expect(page.locator("#cardBanner")).toContainText("검수 전(draft)");
  });

  /**
   * ⚠ **이 검사는 «지금 이렇다» 를 고정할 뿐, «이래야 한다» 가 아니다.**
   *
   * `r` 이 미정이면 `breached` 가 안 서므로 `data-state` 가 `safe` 로 남는다. 5,000원
   * 에서도 초록이다. 헤드라인은 *"정하지 못했습니다"* 라고 정직하게 말하지만 **색은
   * 안전을 말한다** — 한 화면이 두 말을 한다.
   *
   * 세 번째 상태(«모름»)를 만들지, 색을 중립으로 뺄지는 화면 규약 결정이라 여기서
   * 정하지 않는다. 다만 **바뀌면 이 검사가 먼저 넘어지게** 해 둔다 — 색이 조용히
   * 바뀌는 것이 제일 나쁘다.
   */
  test("현재 규약 고정 — 미정 카드에서 data-state 는 safe 로 남는다", async ({ page }) => {
    await uploadAmbiguous(page);
    await page.getByLabel("가격 시나리오", { exact: true }).fill("5000");
    await expect(page.locator(".mg")).toHaveAttribute("data-state", "safe");
  });

  test("골든과 대비 — 같은 화면이 좁혀지는 카드에서는 수량을 낸다", async ({ page }) => {
    await open(page);
    await pick(page, GOLDEN.label);
    await dragToBreach(page);
    await expect(page.locator("#liqBox h2")).toHaveText("이대로면 — 약관 산정 방식의 재현값");
    await expect(page.locator("#liqQty")).not.toHaveText("");
  });
});
