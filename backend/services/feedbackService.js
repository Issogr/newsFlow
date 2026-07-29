const { createError } = require('../utils/errorHandler');
const { getFeedbackAttachmentType } = require('../utils/feedback');
const { parseIntegerEnv } = require('../utils/env');

const TELEGRAM_API_BASE = String(process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org').trim().replace(/\/+$/, '');
const FEEDBACK_DELIVERY_TIMEOUT_MS = parseIntegerEnv('FEEDBACK_DELIVERY_TIMEOUT_MS', 25000, { min: 1000, max: 120000 });
const runtimeFetch = globalThis.fetch;

function formatCategoryLabel(category) {
  if (category === 'bug') return 'Bug report';
  if (category === 'idea') return 'Improvement idea';
  return 'General feedback';
}

function formatAttachmentLabel(attachmentType) {
  if (attachmentType === 'image') return 'Image attached';
  if (attachmentType === 'video') return 'Video attached';
  return 'No';
}

function getTelegramConfig() {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  const messageThreadId = String(process.env.TELEGRAM_MESSAGE_THREAD_ID || '').trim();

  if (!botToken || !chatId) {
    throw createError(503, 'Feedback delivery is not configured on the server.', 'FEEDBACK_NOT_CONFIGURED');
  }

  if (messageThreadId && !/^\d+$/.test(messageThreadId)) {
    throw createError(503, 'Feedback delivery is misconfigured on the server.', 'FEEDBACK_NOT_CONFIGURED');
  }

  return {
    botToken,
    chatId,
    messageThreadId: messageThreadId || null,
  };
}

function isFeedbackConfigured() {
  try {
    getTelegramConfig();
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function readTelegramResult(response) {
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || `Telegram API request failed with status ${response.status}`);
  }

  return payload.result || null;
}

function buildFeedbackMessage({ user, category, title, description, attachmentType }) {
  const sentAt = new Date().toISOString();

  return [
    `<b>Category:</b> ${escapeHtml(formatCategoryLabel(category))}`,
    `<b>From:</b> ${escapeHtml(user?.username || 'Unknown user')}`,
    `<b>User ID:</b> <code>${escapeHtml(user?.id || '')}</code>`,
    `<b>Sent at:</b> ${escapeHtml(sentAt)}`,
    `<b>Attachment:</b> ${escapeHtml(formatAttachmentLabel(attachmentType))}`,
    '',
    `<b>Title</b>\n${escapeHtml(title)}`,
    '',
    `<b>Description</b>\n${escapeHtml(description)}`,
  ].join('\n');
}

function buildAttachmentCaption(user, attachmentType) {
  const attachmentLabel = attachmentType === 'video' ? 'video' : 'attachment';

  return [
    `<b>News Flow ${attachmentLabel}</b>`,
    `${escapeHtml(user?.username || 'Unknown user')}`,
  ].join('\n');
}

async function sendTextMessage(config, message, signal) {
  const params = new globalThis.URLSearchParams({
    chat_id: config.chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: 'true',
  });

  if (config.messageThreadId) {
    params.append('message_thread_id', config.messageThreadId);
  }

  const response = await runtimeFetch(`${TELEGRAM_API_BASE}/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    body: params,
    signal,
  });

  return readTelegramResult(response);
}

async function sendAttachment(config, user, attachment, signal) {
  const attachmentType = getFeedbackAttachmentType(attachment);
  const formData = new globalThis.FormData();
  const attachmentName = String(attachment?.originalname || 'feedback-attachment').trim() || 'feedback-attachment';
  const attachmentMimeType = String(attachment?.mimetype || 'application/octet-stream').trim() || 'application/octet-stream';

  if (!attachmentType) {
    throw createError(400, 'Please attach an image or a small video.', 'INVALID_FEEDBACK_IMAGE');
  }

  formData.append('chat_id', config.chatId);
  formData.append('parse_mode', 'HTML');
  formData.append('caption', buildAttachmentCaption(user, attachmentType));

  if (config.messageThreadId) {
    formData.append('message_thread_id', config.messageThreadId);
  }

  formData.append(
    attachmentType === 'video' ? 'video' : 'photo',
    new globalThis.Blob([attachment.buffer], { type: attachmentMimeType }),
    attachmentName
  );

  const response = await runtimeFetch(`${TELEGRAM_API_BASE}/bot${config.botToken}/${attachmentType === 'video' ? 'sendVideo' : 'sendPhoto'}`, {
    method: 'POST',
    body: formData,
    signal,
  });

  return readTelegramResult(response);
}

async function sendFeedback({ user, category, title, description, attachment = null }) {
  const config = getTelegramConfig();

  try {
    const attachmentType = getFeedbackAttachmentType(attachment);
    const signal = globalThis.AbortSignal.timeout(FEEDBACK_DELIVERY_TIMEOUT_MS);

    if (attachment?.buffer?.length) {
      await sendAttachment(config, user, attachment, signal);
    }

    const message = buildFeedbackMessage({
      user,
      category,
      title,
      description,
      attachmentType,
    });
    const result = await sendTextMessage(config, message, signal);

    return {
      messageId: result?.message_id || null,
    };
  } catch (error) {
    throw createError(502, 'Unable to deliver feedback right now. Please try again later.', 'FEEDBACK_DELIVERY_FAILED', error);
  }
}

module.exports = {
  isFeedbackConfigured,
  sendFeedback,
};
