import { Router } from "express";
import { db } from "@workspace/db";
import { supportTicketsTable, usersTable } from "@workspace/db";
import { eq, desc, or, ilike } from "drizzle-orm";
import { randomUUID } from "crypto";

function isAdmin(email: string | null | undefined): boolean {
  return !!(process.env.ADMIN_EMAIL && email && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase());
}

const router = Router();

router.post("/support", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { subject, message, category, jobId } = req.body as {
    subject?: string;
    message?: string;
    category?: string;
    jobId?: string;
  };

  if (!subject?.trim() || !message?.trim()) {
    res.status(400).json({ error: "Subject and message are required" });
    return;
  }

  const validCategories = ["billing", "technical", "content", "other"];
  const cat = validCategories.includes(category ?? "") ? (category as "billing" | "technical" | "content" | "other") : "other";

  const [ticket] = await db
    .insert(supportTicketsTable)
    .values({
      id: randomUUID(),
      userId: req.user.id,
      subject: subject.trim().slice(0, 200),
      message: message.trim().slice(0, 5000),
      category: cat,
      jobId: jobId?.trim() || null,
    })
    .returning();

  res.status(201).json({ ok: true, ticketId: ticket?.id });
});

router.get("/support/my", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tickets = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.userId, req.user.id))
    .orderBy(desc(supportTicketsTable.createdAt))
    .limit(50);

  res.json({ tickets });
});

router.get("/admin/support", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { search, status } = req.query as { search?: string; status?: string };

  const allTickets = await db
    .select({
      id: supportTicketsTable.id,
      userId: supportTicketsTable.userId,
      subject: supportTicketsTable.subject,
      message: supportTicketsTable.message,
      category: supportTicketsTable.category,
      status: supportTicketsTable.status,
      jobId: supportTicketsTable.jobId,
      adminNotes: supportTicketsTable.adminNotes,
      createdAt: supportTicketsTable.createdAt,
      updatedAt: supportTicketsTable.updatedAt,
      userEmail: usersTable.email,
      userFirstName: usersTable.firstName,
      userLastName: usersTable.lastName,
    })
    .from(supportTicketsTable)
    .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(
      search
        ? or(
            ilike(supportTicketsTable.subject, `%${search}%`),
            ilike(supportTicketsTable.message, `%${search}%`),
            ilike(usersTable.email, `%${search}%`),
          )
        : undefined,
    )
    .orderBy(desc(supportTicketsTable.createdAt))
    .limit(200);

  const filtered = status && status !== "all"
    ? allTickets.filter((t) => t.status === status)
    : allTickets;

  res.json({ tickets: filtered });
});

router.patch("/admin/support/:id", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { id } = req.params;
  const { status, adminNotes } = req.body as { status?: string; adminNotes?: string };

  const validStatuses = ["open", "in_progress", "resolved", "closed"];
  const updates: Partial<typeof supportTicketsTable.$inferInsert> = {};

  if (status && validStatuses.includes(status)) {
    updates.status = status as "open" | "in_progress" | "resolved" | "closed";
  }
  if (typeof adminNotes === "string") {
    updates.adminNotes = adminNotes.slice(0, 2000) || null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  await db
    .update(supportTicketsTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(supportTicketsTable.id, id));

  res.json({ ok: true });
});

export default router;
