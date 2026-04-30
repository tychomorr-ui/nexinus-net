export type LoginState = {
  origin: string;
  returnPath: string;
  redirectUri?: string;
};

export function encodeLoginState(state: LoginState) {
  return btoa(JSON.stringify(state));
}

export function decodeLoginState(state: string): LoginState | string | null {
  try {
    const decoded = atob(state);

    try {
      const parsed = JSON.parse(decoded) as Partial<LoginState>;
      if (
        typeof parsed.origin === "string" &&
        typeof parsed.returnPath === "string"
      ) {
        return {
          origin: parsed.origin,
          returnPath: parsed.returnPath,
          redirectUri:
            typeof parsed.redirectUri === "string"
              ? parsed.redirectUri
              : undefined,
        };
      }
    } catch {
      return decoded;
    }

    return decoded;
  } catch {
    return null;
  }
}

export function getOAuthRedirectUriFromState(state: string) {
  const decoded = decodeLoginState(state);

  if (decoded && typeof decoded === "object") {
    if (decoded.redirectUri) {
      return decoded.redirectUri;
    }

    return new URL("/api/oauth/callback", decoded.origin).toString();
  }

  if (typeof decoded === "string") {
    return new URL(decoded).toString();
  }

  throw new Error("Invalid OAuth state");
}
