import { getKisAuthConfig } from "@/lib/kis/config";
import { getKisAccessToken } from "@/lib/kis/token";
import { kisError, kisJson } from "../_response";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  try {
    const config = getKisAuthConfig();
    const token = await getKisAccessToken(config);

    return kisJson({
      ok: true,
      env: config.env,
      token_type: token.tokenType,
      expires_at: new Date(token.expiresAt).toISOString(),
    });
  } catch (error) {
    return kisError(error);
  }
}
