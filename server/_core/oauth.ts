import type { Express, Request, Response } from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { decodeLoginState } from "@shared/loginState";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function resolveRedirectTarget(req: Request, state: string) {
  const decoded = decodeLoginState(state);
  const currentOrigin = `${req.protocol}://${req.get("host")}`;

  if (decoded && typeof decoded === "object") {
    const candidate = decoded;
    const safeReturnPath = candidate.returnPath?.startsWith("/")
      ? candidate.returnPath
      : "/";

    if (candidate.origin === currentOrigin) {
      return `${candidate.origin}${safeReturnPath}`;
    }
  }

  if (typeof decoded === "string") {
    try {
      const candidateUrl = new URL(decoded);
      if (candidateUrl.origin === currentOrigin) {
        return `${candidateUrl.origin}${candidateUrl.pathname}${candidateUrl.search}${candidateUrl.hash}`;
      }
    } catch {
      return "/";
    }
  }

  return "/";
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, resolveRedirectTarget(req, state));
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
