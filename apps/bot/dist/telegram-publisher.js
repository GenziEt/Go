import { env } from "./config.js";
import { logger } from "./logger.js";
import { buildChannelCaption, buildChannelCaptionPlain } from "./post-buttons.js";
// Telegram hard limits: 4096 chars per text message, 1024 per media caption. The post wizard
// accepts up to 6000 chars, so long posts are split instead of failing at publish time.
const TEXT_CHUNK = 3400;
const CAPTION_LIMIT = 1000;
function escapeHtml(value) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function splitText(text, max) {
    const parts = [];
    let rest = text.trim();
    while (rest.length > max) {
        let cut = rest.lastIndexOf("\n", max);
        if (cut < max * 0.5)
            cut = rest.lastIndexOf(" ", max);
        if (cut < max * 0.5)
            cut = max;
        parts.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }
    if (rest)
        parts.push(rest);
    return parts.length ? parts : [""];
}
// Full premium caption for a single-message post (header + body + tags/location + dated footer).
function premiumCaption(input) {
    return buildChannelCaption({
        title: input.title,
        body: input.body,
        tags: input.tags,
        author: input.author,
        readingMinutes: input.readingMinutes ?? Math.max(1, Math.ceil(input.body.split(/\s+/).filter(Boolean).length / 180)),
        publishedAt: new Date(),
        ...(input.location ? { location: input.location } : {}),
        escapeHtml,
    });
}
export async function publishToChannel(bot, input) {
    if (!env.GENZI_CHANNEL_ID)
        throw new Error("GENZI_CHANNEL_ID is not configured");
    const channel = env.GENZI_CHANNEL_ID;
    const hasMedia = (input.mediaType === "image" || input.mediaType === "video") && Boolean(input.mediaFileId);
    const caption = premiumCaption(input);
    // 1) Everything fits in one message / one caption — the common case.
    if (hasMedia && caption.length <= CAPTION_LIMIT) {
        try {
            const msg = input.mediaType === "image"
                ? await bot.api.sendPhoto(channel, input.mediaFileId, { caption, parse_mode: "HTML" })
                : await bot.api.sendVideo(channel, input.mediaFileId, { caption, parse_mode: "HTML" });
            return { chatId: String(channel), messageId: msg.message_id };
        }
        catch (error) {
            // HTML parse failure on user content: retry once with the plain-text twin.
            logger.warn("channel caption HTML rejected, falling back to plain text", { error: String(error) });
            const plain = buildChannelCaptionPlain({ ...input, readingMinutes: input.readingMinutes ?? 1, publishedAt: new Date() }).slice(0, CAPTION_LIMIT);
            const msg = input.mediaType === "image"
                ? await bot.api.sendPhoto(channel, input.mediaFileId, { caption: plain })
                : await bot.api.sendVideo(channel, input.mediaFileId, { caption: plain });
            return { chatId: String(channel), messageId: msg.message_id };
        }
    }
    if (!hasMedia && caption.length <= 4000) {
        try {
            const msg = await bot.api.sendMessage(channel, caption, { parse_mode: "HTML" });
            return { chatId: String(channel), messageId: msg.message_id };
        }
        catch (error) {
            logger.warn("channel message HTML rejected, falling back to plain text", { error: String(error) });
            const plain = buildChannelCaptionPlain({ ...input, readingMinutes: input.readingMinutes ?? 1, publishedAt: new Date() }).slice(0, 4000);
            const msg = await bot.api.sendMessage(channel, plain);
            return { chatId: String(channel), messageId: msg.message_id };
        }
    }
    // 2) Long post: header (+ media + footer block) first, the overflowing body follows in as
    //    many messages as needed. The keyboard (attached by the caller) lands on THIS first
    //    message, so the reader sees buttons without scrolling through the thread.
    const footerMatch = caption.match(/\n\n────────—— ✨ ——────────\n[\s\S]*$/);
    const footerHtml = footerMatch ? footerMatch[0] : "";
    const headCaption = footerMatch ? caption.slice(0, caption.length - footerHtml.length) : caption;
    const budget = hasMedia ? CAPTION_LIMIT : TEXT_CHUNK;
    let overflow = "";
    let firstChunk = headCaption;
    if (firstChunk.length + footerHtml.length > budget) {
        // Body doesn't fit alongside the footer: keep header + as much body as fits, push the rest out.
        const keep = Math.max(0, budget - footerHtml.length - 40);
        if (firstChunk.length > keep) {
            overflow = firstChunk.slice(keep).trim();
            firstChunk = firstChunk.slice(0, keep).trimEnd();
        }
    }
    firstChunk = `${firstChunk}${footerHtml}`;
    let firstId;
    if (hasMedia) {
        const msg = input.mediaType === "image"
            ? await bot.api.sendPhoto(channel, input.mediaFileId, { caption: firstChunk.slice(0, CAPTION_LIMIT), parse_mode: "HTML" })
            : await bot.api.sendVideo(channel, input.mediaFileId, { caption: firstChunk.slice(0, CAPTION_LIMIT), parse_mode: "HTML" });
        firstId = msg.message_id;
    }
    else {
        const msg = await bot.api.sendMessage(channel, firstChunk, { parse_mode: "HTML" });
        firstId = msg.message_id;
    }
    const continuation = [overflow, input.body].filter(Boolean).join("\n\n");
    const chunks = splitText(continuation, TEXT_CHUNK);
    if (hasMedia)
        chunks.unshift(`🇪🇹 GENZI · <i>${escapeHtml(input.title)}</i>`);
    for (const chunk of chunks) {
        if (!chunk)
            continue;
        await bot.api.sendMessage(channel, chunk, {
            parse_mode: "HTML",
            reply_parameters: { message_id: firstId, allow_sending_without_reply: true },
        });
    }
    return { chatId: String(channel), messageId: firstId };
}
export async function publishConfession(bot, body, number, keyboard) {
    if (!env.GENZI_CHANNEL_ID)
        throw new Error("GENZI_CHANNEL_ID is not configured");
    const caption = `🗣️ <b>GENZI CONFESSION #${String(number).padStart(5, "0")}</b>\n\n${escapeHtml(body)}\n\nምን ማድረግ አለበት? 👇`;
    const msg = await bot.api.sendMessage(env.GENZI_CHANNEL_ID, caption, { parse_mode: "HTML", reply_markup: keyboard });
    return { chatId: String(env.GENZI_CHANNEL_ID), messageId: msg.message_id };
}
// Best-effort removal of a message from the public channel. Moderator removals previously only
// changed the DB row, leaving the content visible in Telegram.
export async function deleteChannelMessage(bot, chatId, messageId) {
    if (!chatId || messageId === null || messageId === undefined)
        return false;
    try {
        await bot.api.deleteMessage(chatId, messageId);
        return true;
    }
    catch (error) {
        logger.warn("channel message delete failed", { chatId, messageId, error: String(error) });
        return false;
    }
}
