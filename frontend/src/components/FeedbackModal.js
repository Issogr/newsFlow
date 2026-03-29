import React, { useEffect, useMemo, useState } from 'react';
import { Bug, CheckCircle2, ImagePlus, Lightbulb, MessageSquare, Paperclip, Send, Trash2, X } from 'lucide-react';
import { submitFeedback } from '../services/api';

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2800;
const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const FEEDBACK_FORM_ID = 'feedback-form';
const FEEDBACK_CATEGORIES = [
  { id: 'bug', icon: Bug, badgeClassName: 'bg-rose-100 text-rose-700', ringClassName: 'border-rose-200 bg-rose-50' },
  { id: 'feedback', icon: MessageSquare, badgeClassName: 'bg-sky-100 text-sky-700', ringClassName: 'border-sky-200 bg-sky-50' },
  { id: 'idea', icon: Lightbulb, badgeClassName: 'bg-amber-100 text-amber-700', ringClassName: 'border-amber-200 bg-amber-50' },
];

function getFriendlyFeedbackError(error, t) {
  const apiMessage = error?.response?.data?.error?.message;

  if (apiMessage) {
    return apiMessage;
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

function getAttachmentValidationError(nextAttachment, t) {
  const mimeType = String(nextAttachment?.type || '');

  if (mimeType.startsWith('image/')) {
    if (nextAttachment.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      return t('feedbackErrorImageTooLarge');
    }

    return '';
  }

  if (mimeType.startsWith('video/')) {
    if (nextAttachment.size > MAX_VIDEO_ATTACHMENT_BYTES) {
      return t('feedbackErrorVideoTooLarge');
    }

    return '';
  }

  return t('feedbackErrorAttachmentType');
}

const FeedbackModal = ({ currentUser, t, onClose }) => {
  const [category, setCategory] = useState('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const attachmentLabel = useMemo(() => {
    if (!attachment) {
      return '';
    }

    const attachmentSizeKb = Math.max(1, Math.round(attachment.size / 1024));
    return `${attachment.name} (${attachmentSizeKb} KB)`;
  }, [attachment]);
  const attachmentType = String(attachment?.type || '');
  const isVideoAttachment = attachmentType.startsWith('video/');
  const attachmentStatus = useMemo(() => {
    if (!attachment) {
      return {
        text: t('feedbackImageHelp'),
        className: 'text-slate-500',
      };
    }

    if (attachmentType.startsWith('image/')) {
      return {
        text: t('feedbackAttachmentStatusImage', {
          size: formatAttachmentSize(attachment.size),
          limit: formatAttachmentSize(MAX_IMAGE_ATTACHMENT_BYTES),
        }),
        className: 'text-emerald-600',
      };
    }

    if (attachmentType.startsWith('video/')) {
      return {
        text: t('feedbackAttachmentStatusVideo', {
          size: formatAttachmentSize(attachment.size),
          limit: formatAttachmentSize(MAX_VIDEO_ATTACHMENT_BYTES),
        }),
        className: 'text-emerald-600',
      };
    }

    return {
      text: t('feedbackImageHelp'),
      className: 'text-slate-500',
    };
  }, [attachment, attachmentType, t]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

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
      const attachmentError = getAttachmentValidationError(attachment, t);
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
    <div className="fixed inset-0 z-50 flex bg-slate-950/40 backdrop-blur-sm sm:px-4 sm:py-6">
      <div className="ml-auto flex h-full w-full flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-w-2xl sm:rounded-[2rem] sm:border sm:border-slate-200">
        <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                <MessageSquare className="h-4 w-4" />
                {t('feedbackMenuItem')}
              </p>
              <h2 className="mt-2 text-xl font-semibold text-slate-900">{t('feedbackTitle')}</h2>
              <p className="mt-2 max-w-xl text-sm text-slate-500">{t('feedbackSubtitle')}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label={t('cancel')}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          {sent ? (
            <div className="rounded-[1.75rem] border border-emerald-200 bg-emerald-50 px-5 py-6 text-emerald-800 shadow-sm">
              <div className="flex items-start gap-4">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-sm">
                  <CheckCircle2 className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="text-lg font-semibold">{t('feedbackSuccessTitle')}</h3>
                  <p className="mt-2 text-sm leading-6 text-emerald-700">{t('feedbackSuccessText')}</p>
                </div>
              </div>
            </div>
          ) : (
            <form id={FEEDBACK_FORM_ID} className="space-y-5" onSubmit={handleSubmit}>
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 shadow-sm">
                {t('feedbackSenderHelp')}
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">{t('feedbackFieldCategory')}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {FEEDBACK_CATEGORIES.map(({ id, icon: Icon, badgeClassName, ringClassName }) => {
                    const isActive = category === id;

                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setCategory(id);
                          setError('');
                        }}
                        className={`rounded-[1.4rem] border px-4 py-4 text-left transition-colors ${isActive ? `${ringClassName} shadow-sm` : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                      >
                        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ${isActive ? 'bg-white text-slate-800' : badgeClassName}`}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <p className="mt-3 text-sm font-semibold text-slate-900">{t(`feedbackCategory${id.charAt(0).toUpperCase()}${id.slice(1)}`)}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{t(`feedbackCategory${id.charAt(0).toUpperCase()}${id.slice(1)}Help`)}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">{t('feedbackFieldTitle')}</span>
                  <span className="text-xs text-slate-400">{title.trim().length}/{MAX_TITLE_LENGTH}</span>
                </div>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value.slice(0, MAX_TITLE_LENGTH));
                    setError('');
                  }}
                  placeholder={t('feedbackTitlePlaceholder')}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition-colors focus:border-slate-400"
                  required
                  minLength={3}
                  maxLength={MAX_TITLE_LENGTH}
                />
              </label>

              <label className="block">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">{t('feedbackFieldDescription')}</span>
                  <span className="text-xs text-slate-400">{description.trim().length}/{MAX_DESCRIPTION_LENGTH}</span>
                </div>
                <textarea
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value.slice(0, MAX_DESCRIPTION_LENGTH));
                    setError('');
                  }}
                  placeholder={t('feedbackDescriptionPlaceholder')}
                  className="min-h-44 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition-colors focus:border-slate-400"
                  required
                  maxLength={MAX_DESCRIPTION_LENGTH}
                />
              </label>

              <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{t('feedbackFieldImage')}</p>
                    <p className={`mt-1 text-sm ${attachmentStatus.className}`}>{attachmentStatus.text}</p>
                  </div>

                  <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100">
                    {attachment ? <Paperclip className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}
                    {attachment ? t('feedbackReplaceImage') : t('feedbackAttachImage')}
                    <input
                      type="file"
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={(event) => {
                        const nextAttachment = event.target.files?.[0] || null;
                        const attachmentError = nextAttachment ? getAttachmentValidationError(nextAttachment, t) : '';

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
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    {attachmentPreviewUrl && (
                      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
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
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t('feedbackRemoveImage')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </form>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-slate-200 px-5 py-5 sm:px-6">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100">
            {sent ? t('closeReader') : t('cancel')}
          </button>
          {!sent && (
            <button type="submit" form={FEEDBACK_FORM_ID} disabled={submitting} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
              <Send className="h-4 w-4" />
              {submitting ? t('feedbackSending') : t('feedbackSubmit')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;
