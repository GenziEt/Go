import { db } from "./db.js";
import { logger } from "./logger.js";
export function createTelegramNotifier(bot) {
    async function notifyUser(userId, input) {
        try {
            const target = await db.user.findUnique({ where: { id: userId }, select: { telegramId: true, blocked: true } });
            if (!target || target.blocked)
                return;
            await bot.api.sendMessage(target.telegramId, `🇪🇹 GENZI\n\n${input.title}\n${input.body}`, { link_preview_options: { is_disabled: true } });
        }
        catch (error) {
            logger.warn("telegram notification delivery skipped", { userId, error: String(error) });
        }
    }
    // Convenience wrappers matching the event classes named in the feature commit.
    return {
        notifyUser,
        comment: (userId, actorName, postTitle) => notifyUser(userId, { title: "💬 አዲስ አስተያየት", body: `${actorName ?? "GENZI ተጠቃሚ"} በ"${postTitle}" ላይ አስተያየት ሰጠ።` }),
        follow: (userId, actorName) => notifyUser(userId, { title: "👥 አዲስ ተከታይ", body: `${actorName ?? "አንድ ተጠቃሚ"} እርስዎን ተከተለው።` }),
        directMessage: (userId, actorName) => notifyUser(userId, { title: "✉️ አዲስ መልዕክት", body: `${actorName ?? "አንድ ተጠቃሚ"} የግል መልዕክት ላክልዎ።` }),
        referral: (userId) => notifyUser(userId, { title: "🎁 የመጋበዣ ሽልማት", body: "አዲስ ሰው በኮድዎ GENZIን ተቀላቅሏል — ሪንቦዎ ተመዝግቧል!" }),
        eventStartingSoon: (userId, title, startsAt) => notifyUser(userId, { title: "⏰ ዝግጅት ይጀምራል", body: `"${title}" በ ${startsAt.toLocaleString("am-ET")} ይጀምራል።` })
    };
}
