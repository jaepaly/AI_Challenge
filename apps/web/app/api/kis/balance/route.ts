import { kisGet } from "@/lib/kis/client";
import { getKisAccountConfig } from "@/lib/kis/config";
import { getKisRequestTarget } from "@/lib/kis/guard";
import { assertKisAccountProxyAuthorized } from "@/lib/kis/proxy-auth";
import { sanitizeKisBalanceResponse } from "@/lib/kis/proxy-response";
import { kisError, kisJson } from "../_response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertKisAccountProxyAuthorized(request);
    getKisRequestTarget("balance", process.env.KIS_ENV);
    const config = getKisAccountConfig();

    const data = await kisGet({
      purpose: "balance",
      config,
      path: "/uapi/domestic-stock/v1/trading/inquire-balance",
      params: {
        CANO: config.cano,
        ACNT_PRDT_CD: config.acntPrdtCd,
        AFHR_FLPR_YN: "N",
        OFL_YN: "",
        INQR_DVSN: "01",
        UNPR_DVSN: "01",
        FUND_STTL_ICLD_YN: "N",
        FNCG_AMT_AUTO_RDPT_YN: "N",
        PRCS_DVSN: "00",
        CTX_AREA_FK100: "",
        CTX_AREA_NK100: "",
      },
    });

    return kisJson(sanitizeKisBalanceResponse(data));
  } catch (error) {
    return kisError(error);
  }
}
