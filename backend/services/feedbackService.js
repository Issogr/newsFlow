const { createError } = require('../utils/errorHandler');
const { FEEDBACK_CATEGORIES, getFeedbackAttachmentType } = require('../utils/feedback');

const TELEGRAM_API_BASE = String(process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org').trim().replace(/\/+$/, '');
const runtimeFetch = globalThis.fetch;
const RuntimeURLSearchParams = globalThis.URLSearchParams;
const RuntimeFormData = globalThis.FormData;
const RuntimeBlob = globalThis.Blob;
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

  if (typeof runtimeFetch !== 'function' || typeof RuntimeURLSearchParams !== 'function') {
    throw createError(500, 'Server runtime does not support outbound feedback delivery.', 'SERVER_ERROR');
  }

  return {
    botToken,
    chatId,
    messageThreadId: messageThreadId || null,
  };
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

async function sendTextMessage(config, message) {
  const params = new RuntimeURLSearchParams({
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
  });

  return readTelegramResult(response);
}

async function sendAttachment(config, user, attachment) {
  if (typeof RuntimeFormData !== 'function' || typeof RuntimeBlob !== 'function') {
    throw createError(500, 'Server runtime does not support feedback attachments.', 'SERVER_ERROR');
  }

  const attachmentType = getFeedbackAttachmentType(attachment);
  const formData = new RuntimeFormData();
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
    new RuntimeBlob([attachment.buffer], { type: attachmentMimeType }),
    attachmentName
  );

  const response = await runtimeFetch(`${TELEGRAM_API_BASE}/bot${config.botToken}/${attachmentType === 'video' ? 'sendVideo' : 'sendPhoto'}`, {
    method: 'POST',
    body: formData,
  });

  return readTelegramResult(response);
}

async function sendFeedback({ user, category, title, description, attachment = null }) {
  const config = getTelegramConfig();

  if (!FEEDBACK_CATEGORIES.has(category)) {
    throw createError(400, 'Please choose a valid feedback category.', 'INVALID_FEEDBACK_PAYLOAD');
  }

  try {
    const attachmentType = getFeedbackAttachmentType(attachment);

    if (attachment?.buffer?.length) {
      await sendAttachment(config, user, attachment);
    }

    const message = buildFeedbackMessage({
      user,
      category,
      title,
      description,
      attachmentType,
    });
    const result = await sendTextMessage(config, message);

    return {
      messageId: result?.message_id || null,
    };
  } catch (error) {
    throw createError(502, 'Unable to deliver feedback right now. Please try again later.', 'FEEDBACK_DELIVERY_FAILED', error);
  }
}

module.exports = {
  sendFeedback,
};
