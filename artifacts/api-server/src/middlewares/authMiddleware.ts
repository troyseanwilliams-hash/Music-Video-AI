import { type Request, type Response, type NextFunction } from "express";
import type { AuthUser } from "@workspace/api-zod";
import { clearSession, getSessionId, getSession } from "../lib/auth.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  const session = await getSession(sid);
  if (!session?.user?.id) {
    await clearSession(res, sid);
    next();
    return;
  }

  // Enforce account blocks immediately, even for already-active sessions.
  const [u] = await db
    .select({ isDisabled: usersTable.isDisabled, authVersion: usersTable.authVersion })
    .from(usersTable)
    .where(eq(usersTable.id, session.user.id))
    .limit(1);
  if (!u || u.isDisabled || (session.authVersion ?? 0) !== u.authVersion) {
    await clearSession(res, sid);
    next();
    return;
  }

  req.user = session.user;
  next();
}
