import crypto from "crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { AuthUser } from "@workspace/api-zod";

export const SESSION_COOKIE = "sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_WINDOW = SESSION_TTL / 2;

export interface SessionData {
  user: AuthUser;
  authVersion?: number;
}

export async function createSession(data: SessionData, executor: Pick<typeof db, "insert"> = db): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  await executor.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });
  return sid;
}

export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  const now = Date.now();
  if (!row || row.expire.getTime() < now) {
    if (row) await deleteSession(sid);
    return null;
  }

  // Keep active users signed in without writing on every request. A session
  // that is used during the final half of its lifetime gets a fresh seven-day
  // window; abandoned sessions still expire normally.
  if (row.expire.getTime() - now < SESSION_REFRESH_WINDOW) {
    await db
      .update(sessionsTable)
      .set({ expire: new Date(now + SESSION_TTL) })
      .where(eq(sessionsTable.sid, sid));
  }

  return row.sess as unknown as SessionData;
}

export async function updateSession(
  sid: string,
  data: SessionData,
): Promise<void> {
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + SESSION_TTL),
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(
  res: Response,
  sid?: string,
): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return req.cookies?.[SESSION_COOKIE];
}
