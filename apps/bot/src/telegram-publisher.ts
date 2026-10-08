import type { Bot, InlineKeyboard } from "grammy";
import { env } from "./config.js";
import { logger } from "./logger.js";

type PublishInput = { title: string; body: string; tags: string[]; author: string; mediaType?: string; mediaFileId?: string; location?: string };

// Telegram hard limits: 4096 chars per text message, 1024 per media caption. The post wizard
// accepts up to 6000 chars, so long posts are split instead of failing at publish time.
const TEXT_CHUNK = 3400;
const CAPTION_LIMIT = 1000;

function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function splitText(text: string, max: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.length ? parts : [""];
}

export async function publishToChannel(bot: Bot, input: PublishInput): Promise<{ chatId: string; messageId: number }> {
  if (!env.GENZI_CHANNEL_ID) throw new Error("GENZI_CHANNEL_ID is not configured");
  const channel = env.GENZI_CHANNEL_ID;
  const tagsRaw = input.tags.length ? `\n\n🏷️ ${input.tags.map((x) => `#${x.replace(/\s+/g, "_")}`).join(" ")}` : "";
  const locationRaw = input.location ? `\n📍 ${input.location}` : "";
  const footerRaw = `${tagsRaw}${locationRaw}\n\n👤 ${input.author}`;
  const headerHtml = `🇪🇹 <b>${escapeHtml(input.title)}</b>`;
  const footerHtml = escapeHtml(footerRaw);
  const hasMedia = (input.mediaType === "image" || input.mediaType === "video") && Boolean(input.mediaFileId);
  const fits = (limit: number) => input.title.length + input.body.length + footerRaw.length + 12 <= limit;

  // 1) Everything fits in one message / one caption — the common case.
  if (hasMedia && fits(CAPTION_LIMIT)) {
    const caption = `${headerHtml}\n\n${escapeHtml(input.body)}${footerHtml}`;
    const msg = input.mediaType === "image"
      ? await bot.api.sendPhoto(channel, input.mediaFileId as string, { caption, parse_mode: "HTML" })
      : await bot.api.sendVideo(channel, input.mediaFileId as string, { caption, parse_mode: "HTML" });
    return { chatId: String(channel), messageId: msg.message_id };
  }
  if (!hasMedia && fits(TEXT_CHUNK)) {
    const msg = await bot.api.sendMessage(channel, `${headerHtml}\n\n${escapeHtml(input.body)}${footerHtml}`, { parse_mode: "HTML" });
    return { chatId: String(channel), messageId: msg.message_id };
  }

  // 2) Long post: header (+ media) first, the body follows in as many messages as needed,
  //    and the footer (tags/location/author) closes the last one.
  const chunks = splitText(input.body, TEXT_CHUNK).map(escapeHtml);
  const last = chunks.length - 1;
  chunks[last] = `${chunks[last] ?? ""}${footerHtml}`;
  let firstId: number;
  let replyTo: number | undefined;
  if (hasMedia) {
    const msg = input.mediaType === "image"
      ? await bot.api.sendPhoto(channel, input.mediaFileId as string, { caption: headerHtml, parse_mode: "HTML" })
      : await bot.api.sendVideo(channel, input.mediaFileId as string, { caption: headerHtml, parse_mode: "HTML" });
    firstId = msg.message_id;
    replyTo = msg.message_id;
  } else {
    chunks[0] = `${headerHtml}\n\n${chunks[0] ?? ""}`;
    const msg = await bot.api.sendMessage(channel, chunks[0], { parse_mode: "HTML" });
    firstId = msg.message_id;
    chunks.shift();
  }
  for (const chunk of chunks) {
    await bot.api.sendMessage(channel, chunk, {
      parse_mode: "HTML",
      ...(replyTo !== undefined ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    });
  }
  return { chatId: String(channel), messageId: firstId };
}

export async function publishConfession(bot: Bot, body: string, number: number, keyboard: InlineKeyboard): Promise<{ chatId: string; messageId: number }> {
  if (!env.GENZI_CHANNEL_ID) throw new Error("GENZI_CHANNEL_ID is not configured");
  const caption = `🗣️ <b>GENZI CONFESSION #${String(number).padStart(5, "0")}</b>\n\n${escapeHtml(body)}\n\nምን ማድረግ አለበት? 👇`;
  const msg = await bot.api.sendMessage(env.GENZI_CHANNEL_ID, caption, { parse_mode: "HTML", reply_markup: keyboard });
  return { chatId: String(env.GENZI_CHANNEL_ID), messageId: msg.message_id };
}

// Best-effort removal of a message from the public channel. Moderator removals previously only
// changed the DB row, leaving the content visible in Telegram.
export async function deleteChannelMessage(bot: Bot, chatId: string | null | undefined, messageId: number | null | undefined): Promise<boolean> {
  if (!chatId || messageId === null || messageId === undefined) return false;
  try {
    await bot.api.deleteMessage(chatId, messageId);
    return true;
  } catch (error) {
    logger.warn("channel message delete failed", { chatId, messageId, error: String(error) });
    return false;
  }
}
