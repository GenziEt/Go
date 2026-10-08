import { InlineKeyboard as Keyboard } from "grammy";
import { env } from "./config.js";
import { logger } from "./logger.js";
// The six official-post platforms allowed as a "link button". This is deliberately a strict
// subset of the moderation allowlist (LINK_ALLOW_HOSTS in moderation.ts) — posts can link
// YouTube/Instagram/etc. only; everything else stays rejected by the normal text moderation.
const PLATFORM_DEFS = [
    { platform: "youtube", hosts: ["youtube.com", "youtu.be"], am: "▶️ በዩቱብ ይመልከቱ", en: "▶️ Watch on YouTube" },
    { platform: "tiktok", hosts: ["tiktok.com"], am: "▶️ በቲክቶክ ይመልከቱ", en: "▶️ Watch on TikTok" },
    { platform: "instagram", hosts: ["instagram.com"], am: "▶️ በንስታግራም ይክፈቱ", en: "▶️ Open on Instagram" },
    { platform: "x", hosts: ["x.com", "twitter.com"], am: "▶️ በኤክስ ይክፈቱ", en: "▶️ Open on X" },
    { platform: "facebook", hosts: ["facebook.com", "fb.com", "fb.me"], am: "▶️ በፌስቡክ ይክፈቱ", en: "▶️ Open on Facebook" },
    { platform: "linkedin", hosts: ["linkedin.com"], am: "▶️ በሊንክድኢን ይከፈቱ", en: "▶️ Open on LinkedIn" },
];
const PLATFORM_EMOJI = {
    youtube: "▶️", tiktok: "🎵", instagram: "📸", x: "✖️", facebook: "📘", linkedin: "💼",
};
const PLATFORM_NAME = {
    youtube: { am: "ዩቱብ", en: "YouTube" }, tiktok: { am: "ቲክቶክ", en: "TikTok" }, instagram: { am: "ንስታግራም", en: "Instagram" },
    x: { am: "ኤክስ", en: "X" }, facebook: { am: "ፌስቡክ", en: "Facebook" }, linkedin: { am: "ሊንክድኢን", en: "LinkedIn" },
};
// Accepts only https links from the six approved platforms. Returns null for anything else so
// callers can show the bilingual error. Bare domains ("youtube.com/…") are normalised to https.
export function parsePlatformLink(rawInput) {
    const value = rawInput.normalize("NFKC").trim();
    if (!value || value.length > 500 || /\s/.test(value))
        return null;
    let url;
    try {
        url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    }
    catch {
        return null;
    }
    if (url.protocol !== "https:")
        return null; // plain http is an impersonation/scam vector
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const def = PLATFORM_DEFS.find((d) => d.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
    if (!def)
        return null;
    return { url: url.toString(), platform: def.platform };
}
export function platformLabel(platform, locale) {
    return locale === "am" ? PLATFORM_NAME[platform].am : PLATFORM_NAME[platform].en;
}
// Friendly bilingual error shown when the user pastes something that isn't one of the six
// official-platform links.
export function invalidLinkMessage(locale) {
    const lines = PLATFORM_DEFS.map((d) => `• ${PLATFORM_EMOJI[d.platform]} ${locale === "am" ? d.am.replace(/^▶️ /, "") : d.en.replace(/^▶️ (Watch|Open) on /, "")}`);
    return locale === "am"
        ? `❌ ይህ አገናኝ መተግበሪያው ላይ የማይከፈት ነው። እባክዎ የእነዚህ መተግበሪያዎች መደበኛ አገናኝ ይላኩ፦\n${lines.join("\n")}\n\n🔗 ምሳሌ፦ https://youtube.com/watch?v=...\n⏭️ ወይም /skip ይላኩ።`
        : `❌ That link can't open a button. Please paste a regular post link from one of these platforms:\n${lines.join("\n")}\n\n🔗 Example: https://youtube.com/watch?v=...\n⏭️ Or send /skip to continue without a link.`;
}
// Bilingual validation hint shown with the step prompt.
export function linkValidationError(locale) {
    return locale === "am"
        ? "❌ ይህ አገናኝ ተቀባይነት የለውም። የዩቱብ፣ ቲክቶክ፣ንስታግራም፣ ኤክስ፣ ፌስቡክ ወይም ሊንክድኢን አገናኝ ብቻ ይቀበላል። ለማለፍ /skip ይላኩ።"
        : "❌ That link isn't accepted. Only YouTube, TikTok, Instagram, X, Facebook or LinkedIn post links work here. Send /skip to move on.";
}
const MONTHS_AM = ["ጃንዩ", "ፌብሩ", "ማርች", "ኤፕሪ", "ሜይ", "ጁን", "ጁላይ", "ኦገስ", "ሴፕቴ", "ኦክቶ", "ኖቬም", "ዲሴም"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "8 Oct 2026" / "8 ኦክቶ 2026" — day month year, matching the spec example.
export function formatPostDate(date, locale) {
    const months = locale === "am" ? MONTHS_AM : MONTHS_EN;
    return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
// --- Caption layout ---------------------------------------------------------------
// Premium spacing rules: blank line between header/body/footer blocks, hashtags grouped
// before the author line, at most one emoji per information anchor (🇪🇹 ✨ 🏷️ 📍 👤 📅 📚).
function brandHeader() {
    return `🇪🇹 <b>GENZI</b> · <i>${env.GENZI_CHANNEL_USERNAME ? `@${env.GENZI_CHANNEL_USERNAME}` : "Ethiopia's Gen Z pulse"}</i>`;
}
// Full formatted caption: header, title, body, tags/location, then the two-line footer
// "👤 Author · 📅 8 Oct 2026" / "📚 N min read". Shared by the private preview AND the
// published channel post so what the author approves is exactly what goes live (WYSIWYG).
export function buildChannelCaption(input) {
    const esc = input.escapeHtml;
    const tagLine = input.tags.length ? `\n\n🏷️ ${input.tags.map((x) => `#${x.replace(/\s+/g, "_")}`).join(" ")}` : "";
    const locationLine = input.location ? `\n📍 ${esc(input.location)}` : "";
    const date = formatPostDate(input.publishedAt, "en");
    const footer = `\n\n────────—— ✨ ——────────\n👤 ${esc(input.author)} · 📅 ${date}\n📚 ${input.readingMinutes} min read`;
    return `${brandHeader()}\n\n<b>${esc(input.title)}</b>\n\n${esc(input.body)}${tagLine}${locationLine}${footer}`;
}
// Plain-text twin used only by the fallback path (when HTML parsing fails outright).
export function buildChannelCaptionPlain(input) {
    const tagLine = input.tags.length ? `\n\n🏷️ ${input.tags.map((x) => `#${x.replace(/\s+/g, "_")}`).join(" ")}` : "";
    const locationLine = input.location ? `\n📍 ${input.location}` : "";
    const date = formatPostDate(input.publishedAt, "en");
    const footer = `\n\n────────—— ✨ ——────────\n👤 ${input.author} · 📅 ${date}\n📚 ${input.readingMinutes} min read`;
    return `🇪🇹 GENZI\n\n${input.title}\n\n${input.body}${tagLine}${locationLine}${footer}`;
}
// All buttons are URL-type — no callback spinning loaders on channel posts.
export function buildChannelButtons(ctx) {
    const locale = ctx.locale ?? "en";
    const kb = new Keyboard();
    let rows = 0;
    // Row 1 (hero, optional): the platform link, alone and full-width.
    if (ctx.linkUrl && ctx.linkPlatform) {
        const platform = ctx.linkPlatform;
        const def = PLATFORM_DEFS.find((d) => d.platform === platform);
        if (def) {
            kb.url(locale === "am" ? def.am : def.en, ctx.linkUrl).row();
            rows++;
        }
    }
    // Row 2 (constant): Read More + Share, paired. Each degrades gracefully.
    const pair = new Keyboard();
    let pairCount = 0;
    if (env.TELEGRAM_BOT_USERNAME) {
        pair.text(locale === "am" ? "📖 ሙሉውን ያንብቡ" : "📖 Read More", `${env.WEBAPP_URL}?startapp=post_${ctx.slug}`);
        pairCount++;
    }
    else {
        logger.warn("TELEGRAM_BOT_USERNAME unset — Read More button skipped on channel posts");
    }
    if (env.GENZI_CHANNEL_USERNAME) {
        // Prefer the real message link (opens Telegram's native share sheet for that exact post);
        // fall back to sharing the Mini App deep link until the message id is known.
        const postUrl = ctx.messageId !== null
            ? `https://t.me/${env.GENZI_CHANNEL_USERNAME}/${ctx.messageId}`
            : `${env.WEBAPP_URL}?startapp=post_${ctx.slug}`;
        pair.text(locale === "am" ? "🔗 ያጋሩ" : "🔗 Share", shareUrl(postUrl));
        pairCount++;
    }
    if (pairCount > 0) {
        kb.row(pair);
        rows++;
    }
    // Row 3 (community, last): Discuss — skipped silently when unconfigured.
    if (env.GENZI_DISCUSSION_URL) {
        kb.url(locale === "am" ? "💬 ውይይት ይኑሩ" : "💬 Discuss", env.GENZI_DISCUSSION_URL).row();
        rows++;
    }
    return rows > 0 ? kb : null;
}
// Telegram's native share sheet, pre-filled with short brand copy.
export function shareUrl(targetUrl) {
    return `https://t.me/share/url?url=${encodeURIComponent(targetUrl)}&text=${encodeURIComponent("🇪🇹 GENZI")}`;
}
// Attach (or replace) the button keyboard on a published channel message. Best-effort:
// failures never break publishing.
export async function attachChannelButtons(bot, chatId, messageId, ctx) {
    const markup = buildChannelButtons(ctx);
    if (!markup)
        return;
    try {
        await bot.api.editMessageReplyMarkup(chatId, messageId, { reply_markup: markup });
    }
    catch (error) {
        logger.warn("channel buttons attach failed (non-fatal)", { chatId, messageId, error: String(error) });
    }
}
// Re-decorate a confession after publishing: reaction callbacks stay, the URL-type
// 💬 Discuss row joins them as the final row.
export function addDiscussRow(markup) {
    if (env.GENZI_DISCUSSION_URL)
        markup.url("💬 Discuss", env.GENZI_DISCUSSION_URL).row();
    return markup;
}
