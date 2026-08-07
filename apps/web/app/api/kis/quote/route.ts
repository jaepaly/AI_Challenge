import { kisGet } from "@/lib/kis/client";
import { kisError, kisJson } from "../_response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol") ?? "005930";
    const market = searchParams.get("market") ?? "J";

    const data = await kisGet({
      purpose: "quote",
      path: "/uapi/domestic-stock/v1/quotations/inquire-price",
      params: {
        FID_COND_MRKT_DIV_CODE: market,
        FID_INPUT_ISCD: symbol,
      },
    });

    return kisJson(data);
  } catch (error) {
    return kisError(error);
  }
}
