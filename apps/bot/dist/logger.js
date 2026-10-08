import { env } from "./config.js";
// Audit fix: LOG_LEVEL was defined in config but never read — the logger always emitted
// everything. Now it honors env.LOG_LEVEL so debugging noise can be turned down/up.
const ORDER = { info: 0, warn: 1, error: 2 };
const threshold = ORDER[env.LOG_LEVEL] ?? 0;
function write(level, message, fields = {}) {
    if (ORDER[level] < threshold)
        return;
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        service: "genzi-bot",
        message,
        ...fields
    };
    const output = JSON.stringify(entry);
    if (level === "error")
        console.error(output);
    else if (level === "warn")
        console.warn(output);
    else
        console.log(output);
}
export const logger = {
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields)
};
