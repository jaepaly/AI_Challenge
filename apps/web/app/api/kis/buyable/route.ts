import { kisGet } from "@/lib/kis/client";
import { getKisAccountConfig } from "@/lib/kis/config";
import { getKisRequestTarget } from "@/lib/kis/guard";
import { assertKisAccountProxyAuthorized } from "@/lib/kis/proxy-auth";
import { sanitizeKisBuyableResponse } from "@/lib/kis/proxy-response";
import { kisError, kisJson } from "../_response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertKisAccountProxyAuthorized(request);
    getKisRequestTarget("buyable", process.env.KIS_ENV);
    const config = getKisAccountConfig();
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol") ?? "005930";
    const price = searchParams.get("price") ?? "0";
    const orderType = searchParams.get("orderType") ?? "01";

    const data = await kisGet({
      purpose: "buyable",
      config,
      path: "/uapi/domestic-stock/v1/trading/inquire-psbl-order",
      params: {
        CANO: config.cano,
        ACNT_PRDT_CD: config.acntPrdtCd,
        PDNO: symbol,
        ORD_UNPR: price,
        ORD_DVSN: orderType,
        CMA_EVLU_AMT_ICLD_YN: "N",
        OVRS_ICLD_YN: "N",
      },
    });

    return kisJson(sanitizeKisBuyableResponse(data));
  } catch (error) {
    return kisError(error);
  }
}
