type JsonRecord = Record<string, unknown>;

const KIS_BASE_FIELDS = ["rt_cd", "msg_cd", "msg1"] as const;

const BALANCE_POSITION_FIELDS = [
  "pdno",
  "prdt_name",
  "trad_dvsn_name",
  "hldg_qty",
  "ord_psbl_qty",
  "pchs_avg_pric",
  "pchs_amt",
  "prpr",
  "evlu_amt",
  "evlu_pfls_amt",
  "evlu_pfls_rt",
  "evlu_erng_rt",
] as const;

const BALANCE_SUMMARY_FIELDS = [
  "dnca_tot_amt",
  "nxdy_excc_amt",
  "prvs_rcdl_excc_amt",
  "scts_evlu_amt",
  "tot_evlu_amt",
  "nass_amt",
  "pchs_amt_smtl_amt",
  "evlu_amt_smtl_amt",
  "evlu_pfls_smtl_amt",
  "tot_loan_amt",
  "asst_icdc_amt",
  "asst_icdc_erng_rt",
] as const;

const BUYABLE_OUTPUT_FIELDS = [
  "ord_psbl_cash",
  "ord_psbl_sbst",
  "ruse_psbl_amt",
  "max_buy_qty",
  "max_buy_amt",
  "psbl_qty_calc_unpr",
  "ord_psbl_qty",
  "nrcvb_buy_amt",
  "nrcvb_buy_qty",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

function pickFields(source: JsonRecord, fields: readonly string[]): JsonRecord {
  const picked: JsonRecord = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      picked[field] = source[field];
    }
  }
  return picked;
}

function pickBase(root: JsonRecord) {
  return {
    ok: root.rt_cd === "0",
    ...pickFields(root, KIS_BASE_FIELDS),
  };
}

export function sanitizeKisBalanceResponse(data: unknown) {
  const root = asRecord(data);

  return {
    ...pickBase(root),
    output1: asRecordArray(root.output1).map((row) =>
      pickFields(row, BALANCE_POSITION_FIELDS),
    ),
    output2: Array.isArray(root.output2)
      ? asRecordArray(root.output2).map((row) =>
          pickFields(row, BALANCE_SUMMARY_FIELDS),
        )
      : pickFields(asRecord(root.output2), BALANCE_SUMMARY_FIELDS),
  };
}

export function sanitizeKisBuyableResponse(data: unknown) {
  const root = asRecord(data);

  return {
    ...pickBase(root),
    output: pickFields(asRecord(root.output), BUYABLE_OUTPUT_FIELDS),
  };
}
