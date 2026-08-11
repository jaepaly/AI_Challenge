export interface AnthropicHealthResult {
  ok: boolean;
  /** Upstream HTTP status. 0 means the request was not sent or failed before a response. */
  status: number;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 5_000;

export async function checkAnthropicModelsHealth({
  apiKey = process.env.ANTHROPIC_API_KEY,
  fetcher = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  apiKey?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
} = {}): Promise<AnthropicHealthResult> {
  if (!apiKey) return { ok: false, status: 0 };

  try {
    const response = await fetcher(ANTHROPIC_MODELS_URL, {
      method: "GET",
      headers: {
        "anthropic-version": ANTHROPIC_VERSION,
        "x-api-key": apiKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
