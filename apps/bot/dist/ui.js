import { InlineKeyboard } from "grammy";
import { t } from "./i18n.js";
import { categories } from "./categories.js";
export function mainMenu(locale, webappUrl) {
    const kb = new InlineKeyboard()
        .text(t(locale, "createPost"), "create_post")
        .text(t(locale, "confession"), "confession").row()
        .text(t(locale, "trending"), "trending")
        .text(locale === "am" ? "🌐 መተግበሪያ" : "🌐 App", "webapp_open").row()
        .text(t(locale, "opportunities"), "opportunities")
        .text(t(locale, "language"), "language");
    // Audit fix: the menu previously opened Trending/Opportunities as plain external URLs,
    // which load outside Telegram and therefore have no initData (every API call 401s).
    // The Mini App button uses a web_app button, so Telegram injects window.Telegram.WebApp.
    if (webappUrl && webappUrl !== "*")
        kb.row().webApp(locale === "am" ? "🌐 GENZI መተግበሪያ ይክፈቱ" : "🌐 Open GENZI App", webappUrl);
    return kb;
}
export function categoryKeyboard(locale) {
    const kb = new InlineKeyboard();
    for (const category of categories) {
        kb.text(locale === "am" ? category.am : category.en, `cat:${category.key}`).row();
    }
    kb.text(t(locale, "cancel"), "cancel");
    return kb;
}
export function previewKeyboard(locale) {
    return new InlineKeyboard()
        .text(t(locale, "approve"), "publish_preview").row()
        .text(t(locale, "edit"), "edit_preview")
        .text(t(locale, "saveDraft"), "save_draft").row()
        .text(t(locale, "cancel"), "cancel");
}
