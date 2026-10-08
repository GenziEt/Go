import { db } from "./db.js";
// Confirms the post wizard's /skip command (media + link steps) and nothing else — the
// confession flow treats any "/..." as a pass-through command.
export const POST_WIZARD_STEPS = ["title", "body", "media", "link", "category", "preview"];
export function toPrismaLocale(locale) {
    return locale === "en" ? "ENGLISH" : "AMHARIC";
}
export function fromPrismaLocale(locale) {
    return locale === "ENGLISH" ? "en" : "am";
}
export async function setSession(telegramUserId, submissionId, step, locale) {
    const dbLocale = toPrismaLocale(locale);
    return db.conversationSession.upsert({
        where: { telegramUserId: String(telegramUserId) },
        update: { submissionId, confessionId: null, step, locale: dbLocale },
        create: {
            telegramUserId: String(telegramUserId),
            step,
            locale: dbLocale,
            // ✅ All relations use connect — no scalar FKs mixed in
            user: {
                connect: { telegramId: String(telegramUserId) },
            },
            submission: {
                connect: { id: submissionId },
            },
        },
    });
}
export async function setConfessionSession(telegramUserId, confessionId, step, locale) {
    const dbLocale = toPrismaLocale(locale);
    return db.conversationSession.upsert({
        where: { telegramUserId: String(telegramUserId) },
        update: { confessionId, submissionId: null, step, locale: dbLocale },
        create: {
            telegramUserId: String(telegramUserId),
            step,
            locale: dbLocale,
            // ✅ All relations use connect — no scalar FKs mixed in
            user: {
                connect: { telegramId: String(telegramUserId) },
            },
            confession: {
                connect: { id: confessionId },
            },
        },
    });
}
// Sessions expire after 30 minutes of inactivity so an abandoned wizard can't swallow the
// user's later messages indefinitely.
const SESSION_TTL_MS = 30 * 60 * 1000;
export async function getSession(telegramUserId) {
    const session = await db.conversationSession.findUnique({
        where: { telegramUserId: String(telegramUserId) },
    });
    if (!session)
        return null;
    if (Date.now() - session.updatedAt.getTime() > SESSION_TTL_MS) {
        await clearSession(telegramUserId);
        return null;
    }
    return session;
}
// Starting a new flow closes whatever the user left half-finished, so orphan INPUT/PREVIEW
// rows don't accumulate. (Mini App confessions are created with a body in INPUT and are
// published through the API, so only body-less INPUT rows are touched.)
export async function abandonOpenWork(userId) {
    await db.submission.updateMany({ where: { userId, state: "INPUT" }, data: { state: "REJECTED" } });
    await db.confession.updateMany({
        where: { userId, OR: [{ state: "INPUT", body: null }, { state: "PREVIEW" }] },
        data: { state: "REJECTED" },
    });
}
export async function clearSession(telegramUserId) {
    await db.conversationSession.deleteMany({
        where: { telegramUserId: String(telegramUserId) },
    });
}
