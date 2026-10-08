import { db } from "./db.js";
import { logger } from "./logger.js";
export const REMINDER_SWEEP_MS = 60_000;
export async function setEventReminder(userId, eventId, minutes) {
    const clamped = Math.min(1440, Math.max(5, Math.round(minutes) || 60));
    await db.eventReminder.upsert({
        where: { eventId_userId: { eventId, userId } },
        update: { minutes, sentAt: null },
        create: { eventId, userId, minutes: clamped }
    });
}
export async function cancelEventReminder(userId, eventId) {
    await db.eventReminder.deleteMany({ where: { eventId, userId } });
}
export async function dispatchDueReminders(notifier) {
    const due = await db.eventReminder.findMany({
        where: { sentAt: null, event: { active: true, startsAt: { gte: new Date() } } },
        include: { event: { select: { title: true, startsAt: true } } },
        take: 50
    });
    let sent = 0;
    for (const reminder of due) {
        const fireAt = reminder.event.startsAt.getTime() - reminder.minutes * 60_000;
        if (fireAt > Date.now())
            continue;
        // Mark first so a slow/failing send never causes duplicate fan-out on the next sweep.
        await db.eventReminder.update({ where: { id: reminder.id }, data: { sentAt: new Date() } });
        await notifier.eventStartingSoon(reminder.userId, reminder.event.title, reminder.event.startsAt);
        sent += 1;
    }
    return sent;
}
export function startReminderSweeper(notifier) {
    const timer = setInterval(() => {
        void dispatchDueReminders(notifier)
            .then((count) => { if (count > 0)
            logger.info("event reminders dispatched", { count }); })
            .catch((error) => logger.error("reminder sweep failed", { error: String(error) }));
    }, REMINDER_SWEEP_MS);
    timer.unref();
    return timer;
}
