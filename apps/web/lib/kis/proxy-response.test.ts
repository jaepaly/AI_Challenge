import { describe, expect, it } from "vitest";

import {
  sanitizeKisBalanceResponse,
  sanitizeKisBuyableResponse,
} from "./proxy-response";

describe("KIS proxy response sanitizer", () => {
  it("allowlists balance response fields and drops account identifiers", () => {
    const sanitized = sanitizeKisBalanceResponse({
      rt_cd: "0",
      msg_cd: "MCA00000",
      msg1: "ok",
      cano: "12345678",
      output1: [
        {
          pdno: "005930",
          prdt_name: "Samsung Electronics",
          hldg_qty: "10",
          evlu_amt: "81000",
          cano: "12345678",
          acnt_prdt_cd: "01",
          unexpected: "leak",
        },
      ],
      output2: [
        {
          dnca_tot_amt: "1000000",
          tot_evlu_amt: "1081000",
          account_no: "12345678-01",
          appsecret: "leak",
        },
      ],
      unexpected: "leak",
    });

    expect(sanitized).toEqual({
      ok: true,
      rt_cd: "0",
      msg_cd: "MCA00000",
      msg1: "ok",
      output1: [
        {
          pdno: "005930",
          prdt_name: "Samsung Electronics",
          hldg_qty: "10",
          evlu_amt: "81000",
        },
      ],
      output2: [
        {
          dnca_tot_amt: "1000000",
          tot_evlu_amt: "1081000",
        },
      ],
    });
  });

  it("allowlists buyable response fields and drops request/account echoes", () => {
    const sanitized = sanitizeKisBuyableResponse({
      rt_cd: "0",
      msg_cd: "MCA00000",
      msg1: "ok",
      output: {
        ord_psbl_cash: "1000000",
        max_buy_qty: "123",
        pdno: "005930",
        cano: "12345678",
        appkey: "leak",
      },
    });

    expect(sanitized).toEqual({
      ok: true,
      rt_cd: "0",
      msg_cd: "MCA00000",
      msg1: "ok",
      output: {
        ord_psbl_cash: "1000000",
        max_buy_qty: "123",
      },
    });
  });
});
