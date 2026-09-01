import assert from "node:assert/strict";
import {
  parseOAuthCallback,
  withoutProviderTokens,
} from "../src/supabase/oauth";

const redirect = "https://abcdefghijklmnop.chromiumapp.org/supabase";

assert.deepEqual(
  parseOAuthCallback(`${redirect}?code=auth-code`, redirect, "flow-from-start"),
  { code: "auth-code", flowId: "flow-from-start" },
);
assert.deepEqual(
  parseOAuthCallback(
    `${redirect}?code=auth-code&sb_flow_id=flow-from-callback`,
    redirect,
    "flow-from-start",
  ),
  { code: "auth-code", flowId: "flow-from-callback" },
);
assert.throws(
  () => parseOAuthCallback(`${redirect}/wrong?code=auth-code`, redirect, null),
  /inattendue/,
);
assert.throws(
  () => parseOAuthCallback(`${redirect}?error=access_denied`, redirect, null),
  /access_denied/,
);

const sanitized = JSON.parse(
  withoutProviderTokens(
    JSON.stringify({
      access_token: "supabase-access",
      refresh_token: "supabase-refresh",
      provider_token: "github-provider",
      provider_refresh_token: "github-provider-refresh",
      user: { id: "user-id" },
    }),
  ),
) as Record<string, unknown>;
assert.equal(sanitized.access_token, "supabase-access");
assert.equal(sanitized.refresh_token, "supabase-refresh");
assert.equal("provider_token" in sanitized, false);
assert.equal("provider_refresh_token" in sanitized, false);

console.log("supabase-oauth: ok");
