import { decodeLoginState, encodeLoginState, getOAuthRedirectUriFromState } from "@shared/loginState";
import { describe, expect, it, vi } from "vitest";
import { SDKServer } from "./sdk";

describe("OAuth login state round trip", () => {
  it("preserves the canonical origin, return path, and callback redirect URI in the encoded state", () => {
    const state = encodeLoginState({
      origin: "https://nexinus.net",
      returnPath: "/mirror/registry",
      redirectUri: "https://nexinus.net/api/oauth/callback",
    });

    expect(decodeLoginState(state)).toEqual({
      origin: "https://nexinus.net",
      returnPath: "/mirror/registry",
      redirectUri: "https://nexinus.net/api/oauth/callback",
    });
    expect(getOAuthRedirectUriFromState(state)).toBe(
      "https://nexinus.net/api/oauth/callback",
    );
  });

  it("keeps supporting legacy state values that only contain a raw redirect URI", () => {
    const legacyState = btoa("https://nexinus.net/api/oauth/callback");

    expect(decodeLoginState(legacyState)).toBe(
      "https://nexinus.net/api/oauth/callback",
    );
    expect(getOAuthRedirectUriFromState(legacyState)).toBe(
      "https://nexinus.net/api/oauth/callback",
    );
  });

  it("uses the canonical callback redirect URI during token exchange", async () => {
    const post = vi.fn().mockResolvedValue({
      data: {
        accessToken: "token",
      },
    });
    const sdk = new SDKServer({ post } as any);
    const state = encodeLoginState({
      origin: "https://nexinus.net",
      returnPath: "/",
      redirectUri: "https://nexinus.net/api/oauth/callback",
    });

    await sdk.exchangeCodeForToken("code-123", state);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      code: "code-123",
      grantType: "authorization_code",
      redirectUri: "https://nexinus.net/api/oauth/callback",
    });
  });
});
