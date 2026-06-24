const express = require('express');
const { rateLimit } = require('express-rate-limit');
const multer = require('multer');
const feedbackService = require('../../services/feedbackService');
const { requireAuthenticatedUser } = require('../../utils/auth');
const { buildRateLimitMessage, createError } = require('../../utils/errorHandler');
const {
  FEEDBACK_CATEGORIES,
  MAX_FEEDBACK_ATTACHMENT_BYTES,
  MAX_FEEDBACK_DESCRIPTION_LENGTH,
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_TITLE_LENGTH,
  MAX_FEEDBACK_VIDEO_BYTES,
  getFeedbackAttachmentType,
} = require('../../utils/feedback');

const router = express.Router();

const feedbackRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: buildRateLimitMessage('Too many feedback submissions. Please try again later.'),
});

const feedbackUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: MAX_FEEDBACK_ATTACHMENT_BYTES,
  },
  fileFilter: (req, file, callback) => {
    const mimeType = String(file?.mimetype || '');

    if (mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
      callback(null, true);
      return;
    }

    callback(createError(400, 'Please attach an image or a small video.', 'INVALID_FEEDBACK_IMAGE'));
  },
});

function validateFeedbackAttachment(file) {
  if (!file) {
    return;
  }

  const attachmentType = getFeedbackAttachmentType(file);

  if (!attachmentType) {
    throw createError(400, 'Please attach an image or a small video.', 'INVALID_FEEDBACK_IMAGE');
  }

  if (attachmentType === 'image' && file.size > MAX_FEEDBACK_IMAGE_BYTES) {
    throw createError(413, 'Images must be 5 MB or smaller.', 'INVALID_FEEDBACK_IMAGE');
  }

  if (attachmentType === 'video' && file.size > MAX_FEEDBACK_VIDEO_BYTES) {
    throw createError(413, 'Videos must be 12 MB or smaller.', 'INVALID_FEEDBACK_IMAGE');
  }
}

function handleFeedbackUpload(req, res, next) {
  feedbackUpload.single('attachment')(req, res, (error) => {
    if (!error) {
      try {
        validateFeedbackAttachment(req.file || null);
        next();
        return;
      } catch (validationError) {
        next(validationError);
        return;
      }
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(createError(413, 'Attachments must be 12 MB or smaller.', 'INVALID_FEEDBACK_IMAGE'));
        return;
      }

      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        next(createError(400, 'Attach only one image or video.', 'INVALID_FEEDBACK_IMAGE'));
        return;
      }
    }

    if (error.status && error.code) {
      next(error);
      return;
    }

    next(createError(400, 'Unable to process the uploaded attachment.', 'INVALID_FEEDBACK_IMAGE', error));
  });
}

router.post('/me/feedback', [requireAuthenticatedUser, feedbackRateLimit, handleFeedbackUpload], async (req, res) => {
  const category = String(req.body?.category || '').trim().toLowerCase();
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();

  if (!FEEDBACK_CATEGORIES.has(category)) {
    throw createError(400, 'Please choose a valid feedback category.', 'INVALID_FEEDBACK_PAYLOAD');
  }

  if (title.length < 3) {
    throw createError(400, 'Title must contain at least 3 characters.', 'INVALID_FEEDBACK_PAYLOAD');
  }

  if (title.length > MAX_FEEDBACK_TITLE_LENGTH) {
    throw createError(400, `Title must be ${MAX_FEEDBACK_TITLE_LENGTH} characters or fewer.`, 'INVALID_FEEDBACK_PAYLOAD');
  }

  if (!description) {
    throw createError(400, 'Description is required.', 'INVALID_FEEDBACK_PAYLOAD');
  }

  if (description.length > MAX_FEEDBACK_DESCRIPTION_LENGTH) {
    throw createError(400, `Description must be ${MAX_FEEDBACK_DESCRIPTION_LENGTH} characters or fewer.`, 'INVALID_FEEDBACK_PAYLOAD');
  }

  await feedbackService.sendFeedback({
    user: req.user,
    category,
    title,
    description,
    attachment: req.file || null,
  });

  res.status(201).json({ success: true });
});

module.exports = router;
