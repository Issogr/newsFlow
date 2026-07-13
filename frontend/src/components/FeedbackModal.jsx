import { useEffect, useState } from 'react';
import { Bug, CheckCircle2, ImagePlus, Lightbulb, MessageSquare, Paperclip, Send, Trash2 } from 'lucide-react';
import { submitFeedback } from '../services/api';
import { getApiErrorPayload, hasApiResponse, isApiTimeoutError } from '../utils/apiError';
import InlineAlert from './InlineAlert';
import SlideOverPanelFrame, { SlideOverPanelBody, SlideOverPanelFooter, SlideOverPanelHeader } from './SlideOverPanelFrame';

const DEFAULT_MAX_TITLE_LENGTH = 120;
const DEFAULT_MAX_DESCRIPTION_LENGTH = 2800;
const DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_VIDEO_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const FEEDBACK_FORM_ID = 'feedback-form';
const fieldClassName = 'w-full rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-slate-800 outline-none transition-[border-color,background-color,box-shadow] placeholder:text-slate-400 focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100';
const FEEDBACK_CATEGORIES = [
  { id: 'bug', labelKey: 'feedbackCategoryBug', helpKey: 'feedbackCategoryBugHelp', icon: Bug, badgeClassName: 'bg-rose-100 text-rose-700', ringClassName: 'border-rose-200 bg-rose-50' },
  { id: 'feedback', labelKey: 'feedbackCategoryFeedback', helpKey: 'feedbackCategoryFeedbackHelp', icon: MessageSquare, badgeClassName: 'bg-sky-100 text-sky-700', ringClassName: 'border-sky-200 bg-sky-50' },
  { id: 'idea', labelKey: 'feedbackCategoryIdea', helpKey: 'feedbackCategoryIdeaHelp', icon: Lightbulb, badgeClassName: 'bg-amber-100 text-amber-700', ringClassName: 'border-amber-200 bg-amber-50' },
];

function getFriendlyFeedbackError(error, t) {
  const { message: apiMessage } = getApiErrorPayload(error);

  if (apiMessage) {
    return apiMessage;
  }

  if (isApiTimeoutError(error)) {
    return t('feedbackErrorTimeout');
  }

  if (!hasApiResponse(error)) {
    return t('feedbackErrorNetwork');
  }

  return t('feedbackErrorGeneric');
}

function formatAttachmentSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 KB';
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getAttachmentValidationError(nextAttachment, t, limits) {
  const mimeType = String(nextAttachment?.type || '');

  if (mimeType.startsWith('image/')) {
    if (nextAttachment.size > limits.feedbackImageMaxBytes) {
      return t('feedbackErrorImageTooLarge');
    }

    return '';
  }

  if (mimeType.startsWith('video/')) {
    if (nextAttachment.size > limits.feedbackVideoMaxBytes) {
      return t('feedbackErrorVideoTooLarge');
    }

    return '';
  }

  return t('feedbackErrorAttachmentType');
}

const FeedbackModal = ({ t, onClose, feedbackLimits }) => {
  const limits = {
    feedbackTitleMaxLength: feedbackLimits?.feedbackTitleMaxLength || DEFAULT_MAX_TITLE_LENGTH,
    feedbackDescriptionMaxLength: feedbackLimits?.feedbackDescriptionMaxLength || DEFAULT_MAX_DESCRIPTION_LENGTH,
    feedbackImageMaxBytes: feedbackLimits?.feedbackImageMaxBytes || DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES,
    feedbackVideoMaxBytes: feedbackLimits?.feedbackVideoMaxBytes || DEFAULT_MAX_VIDEO_ATTACHMENT_BYTES,
  };
  const [category, setCategory] = useState('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const attachmentLabel = attachment
    ? `${attachment.name} (${formatAttachmentSize(attachment.size)})`
    : '';
  const attachmentType = String(attachment?.type || '');
  const isVideoAttachment = attachmentType.startsWith('video/');
  let attachmentStatus = {
    text: t('feedbackImageHelp'),
    className: 'text-slate-500',
  };
  if (attachmentType.startsWith('image/')) {
    attachmentStatus = {
      text: t('feedbackAttachmentStatusImage', {
        size: formatAttachmentSize(attachment.size),
        limit: formatAttachmentSize(limits.feedbackImageMaxBytes),
      }),
      className: 'text-emerald-600',
    };
  } else if (attachmentType.startsWith('video/')) {
    attachmentStatus = {
      text: t('feedbackAttachmentStatusVideo', {
        size: formatAttachmentSize(attachment.size),
        limit: formatAttachmentSize(limits.feedbackVideoMaxBytes),
      }),
      className: 'text-emerald-600',
    };
  }

  useEffect(() => {
    if (!attachment) {
      setAttachmentPreviewUrl('');
      return undefined;
    }

    const nextPreviewUrl = URL.createObjectURL(attachment);
    setAttachmentPreviewUrl(nextPreviewUrl);

    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [attachment]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();

    if (trimmedTitle.length < 3) {
      setError(t('feedbackErrorTitleShort'));
      return;
    }

    if (!trimmedDescription) {
      setError(t('feedbackErrorDescriptionRequired'));
      return;
    }

    if (attachment) {
      const attachmentError = getAttachmentValidationError(attachment, t, limits);
      if (attachmentError) {
        setError(attachmentError);
        return;
      }
    }

    setSubmitting(true);

    try {
      await submitFeedback({
        category,
        title: trimmedTitle,
        description: trimmedDescription,
        attachment,
      });
      setSent(true);
      setCategory('bug');
      setTitle('');
      setDescription('');
      setAttachment(null);
    } catch (requestError) {
      setError(getFriendlyFeedbackError(requestError, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlideOverPanelFrame>
        <SlideOverPanelHeader
          closeLabel={t('cancel')}
          eyebrow={t('feedbackMenuItem')}
          icon={MessageSquare}
          onClose={onClose}
          subtitle={t('feedbackSubtitle')}
          title={t('feedbackTitle')}
        />

        <SlideOverPanelBody>
          {sent ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-emerald-800">
              <div className="flex items-start gap-4">
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" aria-hidden="true" />
                <div>
                  <h3 className="text-lg font-semibold">{t('feedbackSuccessTitle')}</h3>
                  <p className="mt-2 text-sm leading-6 text-emerald-700">{t('feedbackSuccessText')}</p>
                </div>
              </div>
            </div>
          ) : (
            <form id={FEEDBACK_FORM_ID} className="space-y-6" onSubmit={handleSubmit}>
              <div className="border-b border-slate-200 pb-6 text-sm leading-6 text-slate-600">
                {t('feedbackSenderHelp')}
              </div>

              <div className="border-b border-slate-200 pb-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">{t('feedbackFieldCategory')}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {FEEDBACK_CATEGORIES.map(({ id, labelKey, helpKey, icon: Icon, badgeClassName, ringClassName }) => {
                    const isActive = category === id;

                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setCategory(id);
                          setError('');
                        }}
                        aria-pressed={isActive}
                        className={`rounded-[1.25rem] border px-4 py-4 text-left transition-colors ${isActive ? ringClassName : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
                      >
                        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${badgeClassName}`}>
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <p className="mt-3 text-sm font-semibold text-slate-900">{t(labelKey)}</p>
                        <p className="mt-1 text-sm leading-5 text-slate-600">{t(helpKey)}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">{t('feedbackFieldTitle')}</span>
                  <span className="text-xs text-slate-400">{title.trim().length}/{limits.feedbackTitleMaxLength}</span>
                </div>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value.slice(0, limits.feedbackTitleMaxLength));
                    setError('');
                  }}
                  placeholder={t('feedbackTitlePlaceholder')}
                  className={fieldClassName}
                  required
                  minLength={3}
                  maxLength={limits.feedbackTitleMaxLength}
                />
              </label>

              <label className="block">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">{t('feedbackFieldDescription')}</span>
                  <span className="text-xs text-slate-400">{description.trim().length}/{limits.feedbackDescriptionMaxLength}</span>
                </div>
                <textarea
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value.slice(0, limits.feedbackDescriptionMaxLength));
                    setError('');
                  }}
                  placeholder={t('feedbackDescriptionPlaceholder')}
                  className={`min-h-44 ${fieldClassName}`}
                  required
                  maxLength={limits.feedbackDescriptionMaxLength}
                />
              </label>

              <div className="border-t border-slate-200 pt-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{t('feedbackFieldImage')}</p>
                    <p className={`mt-1 text-sm ${attachmentStatus.className}`}>{attachmentStatus.text}</p>
                  </div>

                  <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-within:ring-2 focus-within:ring-sky-100">
                    {attachment ? <Paperclip className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}
                    {attachment ? t('feedbackReplaceImage') : t('feedbackAttachImage')}
                    <input
                      type="file"
                      accept="image/*,video/*"
                      className="sr-only"
                      onChange={(event) => {
                        const nextAttachment = event.target.files?.[0] || null;
                        const attachmentError = nextAttachment ? getAttachmentValidationError(nextAttachment, t, limits) : '';

                        if (attachmentError) {
                          setAttachment(null);
                          setError(attachmentError);
                        } else {
                          setAttachment(nextAttachment);
                          setError('');
                        }

                        event.target.value = '';
                      }}
                    />
                  </label>
                </div>

                {attachment && (
                  <div className="mt-5 border-t border-slate-200 pt-5">
                    {attachmentPreviewUrl && (
                      <div className="overflow-hidden rounded-[1.25rem] border border-slate-200 bg-slate-50">
                        {isVideoAttachment ? (
                          <video src={attachmentPreviewUrl} controls className="max-h-72 w-full bg-slate-950 object-contain" />
                        ) : (
                          <img src={attachmentPreviewUrl} alt={t('feedbackImagePreviewAlt')} className="max-h-72 w-full object-contain" />
                        )}
                      </div>
                    )}

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-700">{attachmentLabel}</p>
                        <p className="mt-1 text-xs text-slate-500">{attachment.type || t('feedbackImageAttached')}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAttachment(null)}
                        className="inline-flex items-center justify-center gap-2 rounded-[1.25rem] border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t('feedbackRemoveImage')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <InlineAlert>
                  {error}
                </InlineAlert>
              )}
            </form>
          )}
        </SlideOverPanelBody>

        <SlideOverPanelFooter>
          <button type="button" onClick={onClose} className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
            {sent ? t('close') : t('cancel')}
          </button>
          {!sent && (
            <button type="submit" form={FEEDBACK_FORM_ID} disabled={submitting} className="inline-flex items-center gap-2 rounded-[1.25rem] bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
              <Send className="h-4 w-4" />
              {submitting ? t('feedbackSending') : t('feedbackSubmit')}
            </button>
          )}
        </SlideOverPanelFooter>
    </SlideOverPanelFrame>
  );
};

export default FeedbackModal;
