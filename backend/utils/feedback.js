const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FEEDBACK_VIDEO_BYTES = 12 * 1024 * 1024;
const MAX_FEEDBACK_ATTACHMENT_BYTES = MAX_FEEDBACK_VIDEO_BYTES;
const MAX_FEEDBACK_TITLE_LENGTH = 120;
const MAX_FEEDBACK_DESCRIPTION_LENGTH = 2800;
const FEEDBACK_CATEGORIES = new Set(['bug', 'feedback', 'idea']);

function getFeedbackAttachmentType(file) {
  const mimeType = String(file?.mimetype || '');

  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  return null;
}

module.exports = {
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_VIDEO_BYTES,
  MAX_FEEDBACK_ATTACHMENT_BYTES,
  MAX_FEEDBACK_TITLE_LENGTH,
  MAX_FEEDBACK_DESCRIPTION_LENGTH,
  FEEDBACK_CATEGORIES,
  getFeedbackAttachmentType,
};
