import { linkTelegramByCode, findWatchersOf } from "./connections.js";

// Sends alerts to individual users' linked Telegram chats — distinct from
// alertDispatch.js, which sends generic signed webhooks to
// teams/integrations. This is the "connect your wallet, get pinged on
// Telegram" consumer-facing feature.
//
// NOT RUNTIME TESTED — no network access in the environment this was
// written in to call the real Telegram Bot API. Reviewed against
// Telegram's documented sendMessage/webhook update shapes, not exercised
// against a live bot.
//
// Setup required before this works:
//   1. Create a bot via @BotFather, get TELEGRAM_BOT_TOKEN
//   2. Register the webhook: POST to
//      https://api.telegram.org/bot<TOKEN>/setWebhook?url=<your-server>/api/telegram/webhook
//   3. Set TELEGRAM_BOT_TOKEN in Railway env vars

const TELEGRAM_API = "https://api.telegram.org";

function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");
  return token;
}

export async function sendTelegramMessage(chatId, text) {
  const token = botToken();
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Formats and sends an alert to every owner watching `address` who has a
 * linked Telegram chat. Fire-and-forget by design, same reasoning as
 * alertDispatch.dispatchAlert — a Telegram delivery failure must never
 * block or affect the detection/decision path that triggered it.
 */
export function notifyTelegramWatchers(address, { severity = "FLAGGED", reason, txHash, contractName } = {}) {
  let watchers;
  try {
    watchers = findWatchersOf(address);
  } catch (err) {
    console.error("[telegramDispatch] findWatchersOf failed:", err.message);
    return;
  }
  if (watchers.length === 0) return;

  const lines = [
    `🛡️ *ShieldGuard Alert* — ${severity}`,
    contractName ? `Contract: \`${contractName}\`` : null,
    `Address: \`${address}\``,
    reason ? `Reason: ${reason}` : null,
    txHash ? `Tx: \`${txHash}\`` : null,
  ].filter(Boolean);
  const text = lines.join("\n");

  for (const { telegramChatId, ownerAddress } of watchers) {
    sendTelegramMessage(telegramChatId, text).catch((err) => {
      console.error(`[telegramDispatch] Failed to notify ${ownerAddress}:`, err.message);
    });
  }
}

/**
 * Handler for POST /api/telegram/webhook — mount this directly as the
 * Express route handler. Expects Telegram's standard Update object shape.
 * Only handles `/start <code>` (the link flow); everything else gets a
 * short help reply.
 */
export async function handleTelegramWebhook(req, res) {
  const update = req.body;
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = message?.text;

  if (!chatId || !text) {
    res.sendStatus(200); // Telegram expects 200 regardless; don't retry-storm on malformed updates
    return;
  }

  const startMatch = text.match(/^\/start\s+([a-f0-9]{8})$/i);
  if (startMatch) {
    const code = startMatch[1];
    const ownerAddress = linkTelegramByCode(code, chatId);
    if (ownerAddress) {
      await sendTelegramMessage(
        chatId,
        `✅ Linked to wallet \`${ownerAddress}\`. You'll get alerts here for anything you connect in the ShieldGuard dashboard.`
      ).catch((err) => console.error("[telegramDispatch] Confirmation send failed:", err.message));
    } else {
      await sendTelegramMessage(
        chatId,
        "That link code wasn't recognized or has expired. Generate a new one from the ShieldGuard dashboard and try again."
      ).catch(() => {});
    }
  } else {
    await sendTelegramMessage(
      chatId,
      "Hi, I'm the ShieldGuard alert bot. To link this chat to your wallet, generate a link code from your ShieldGuard dashboard and send /start <code> here."
    ).catch(() => {});
  }

  res.sendStatus(200);
}
