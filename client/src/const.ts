import { encodeLoginState } from "@shared/loginState";

export const getLoginUrl = (returnPath?: string) => {
  if (typeof window === "undefined") {
    return "/api/oauth/callback";
  }

  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const safeReturnPath = returnPath?.startsWith("/")
    ? returnPath
    : `${window.location.pathname}${window.location.search}${window.location.hash}`;

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set(
    "state",
    encodeLoginState({
      origin: window.location.origin,
      returnPath: safeReturnPath,
      redirectUri,
    }),
  );
  url.searchParams.set("type", "signIn");

  return url.toString();
};
