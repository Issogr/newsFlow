import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Bug, CheckCircle2, ImagePlus, Lightbulb, MessageSquare, Paperclip, Send, Trash2 } from 'lucide-react';
import { submitFeedback } from '../services/api';
import { getApiErrorPayload, hasApiResponse, isApiTimeoutError } from '../utils/apiError';
import InlineAlert from './InlineAlert';
import SlideOverPanelFrame, { SlideOverPanelBody, SlideOverPanelFooter, SlideOverPanelHeader } from './SlideOverPanelFrame';
import type { Translator } from '../types';

const DEFAULT_MAX_TITLE_LENGTH = 120;
const DEFAULT_MAX_DESCRIPTION_LENGTH = 2800;
const DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_VIDEO_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const FEEDBACK_FORM_ID = 'feedback-form';
const fieldClassName = 'w-full rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-slate-800 outline-none transition-[border-color,background-color,box-shadow] placeholder:text-slate-400 focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100 aria-invalid:border-red-300 aria-invalid:ring-1 aria-invalid:ring-red-100';
const FEEDBACK_CATEGORIES = [
  { id: 'bug', labelKey: 'feedbackCategoryBug', helpKey: 'feedbackCategoryBugHelp', descriptionHelpKey: 'feedbackDescriptionBugHelp', icon: Bug, badgeClassName: 'bg-rose-100 text-rose-700', ringClassName: 'border-rose-200 bg-rose-50' },
  { id: 'feedback', labelKey: 'feedbackCategoryFeedback', helpKey: 'feedbackCategoryFeedbackHelp', descriptionHelpKey: 'feedbackDescriptionFeedbackHelp', icon: MessageSquare, badgeClassName: 'bg-sky-100 text-sky-700', ringClassName: 'border-sky-200 bg-sky-50' },
  { id: 'idea', labelKey: 'feedbackCategoryIdea', helpKey: 'feedbackCategoryIdeaHelp', descriptionHelpKey: 'feedbackDescriptionIdeaHelp', icon: Lightbulb, badgeClassName: 'bg-amber-100 text-amber-700', ringClassName: 'border-amber-200 bg-amber-50' },
];

function getFriendlyFeedbackError(error: unknown, t: Translator) {
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

function formatAttachmentSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 KB';
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface FeedbackLimits {
  feedbackTitleMaxLength: number;
  feedbackDescriptionMaxLength: number;
  feedbackImageMaxBytes: number;
  feedbackVideoMaxBytes: number;
}

function getAttachmentValidationError(nextAttachment: File, t: Translator, limits: FeedbackLimits) {
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

const FeedbackModal = ({ t, onClose, feedbackLimits, restoreFocusRef }: {
  t: Translator;
  onClose: () => void;
  feedbackLimits?: Partial<FeedbackLimits>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) => {
  const limits = {
    feedbackTitleMaxLength: feedbackLimits?.feedbackTitleMaxLength || DEFAULT_MAX_TITLE_LENGTH,
    feedbackDescriptionMaxLength: feedbackLimits?.feedbackDescriptionMaxLength || DEFAULT_MAX_DESCRIPTION_LENGTH,
    feedbackImageMaxBytes: feedbackLimits?.feedbackImageMaxBytes || DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES,
    feedbackVideoMaxBytes: feedbackLimits?.feedbackVideoMaxBytes || DEFAULT_MAX_VIDEO_ATTACHMENT_BYTES,
  };
  const [category, setCategory] = useState('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; description?: string }>({});
  const [attachmentError, setAttachmentError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [sent, setSent] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);
  const selectedCategory = FEEDBACK_CATEGORIES.find(({ id }) => id === category) || FEEDBACK_CATEGORIES[0];
  const attachmentLabel = attachment
    ? `${attachment.name} (${formatAttachmentSize(attachment.size)})`
    : '';
  const attachmentType = String(attachment?.type || '');
  const isVideoAttachment = attachmentType.startsWith('video/');

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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError('');

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const nextFieldErrors: { title?: string; description?: string } = {};

    if (trimmedTitle.length < 3) {
      nextFieldErrors.title = t('feedbackErrorTitleShort');
    }

    if (!trimmedDescription) {
      nextFieldErrors.description = t('feedbackErrorDescriptionRequired');
    }

    setFieldErrors(nextFieldErrors);
    if (nextFieldErrors.title || nextFieldErrors.description) {
      (nextFieldErrors.title ? titleInputRef : descriptionInputRef).current?.focus();
      return;
    }

    if (attachment) {
      const nextAttachmentError = getAttachmentValidationError(attachment, t, limits);
      if (nextAttachmentError) {
        setAttachmentError(nextAttachmentError);
        return;
      }
    }
    setAttachmentError('');

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
      setFieldErrors({});
      setAttachmentError('');
    } catch (requestError) {
      setSubmitError(getFriendlyFeedbackError(requestError, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlideOverPanelFrame ariaLabelledBy="feedback-panel-title" dismissOnEscape={!submitting} onClose={onClose} restoreFocusRef={restoreFocusRef}>
        <SlideOverPanelHeader
          closeDisabled={submitting}
          closeLabel={sent ? t('close') : t('cancel')}
          eyebrow={t('feedbackMenuItem')}
          icon={MessageSquare}
          onClose={onClose}
          subtitle={t('feedbackSubtitle')}
          title={t('feedbackTitle')}
          titleId="feedback-panel-title"
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
            <form id={FEEDBACK_FORM_ID} noValidate onSubmit={handleSubmit}>
              <fieldset disabled={submitting} className="m-0 min-w-0 space-y-6 border-0 p-0">
                <p className="text-xs leading-5 text-slate-500">{t('feedbackSenderHelp')}</p>

              <div className="border-b border-slate-200 pb-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">{t('feedbackFieldCategory')}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {FEEDBACK_CATEGORIES.map(({ id, labelKey, icon: Icon, badgeClassName, ringClassName }) => {
                    const isActive = category === id;

                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setCategory(id);
                          setSubmitError('');
                        }}
                        aria-pressed={isActive}
                        className={`flex min-w-0 flex-col items-center rounded-[1.25rem] border px-2 py-3 text-center transition-colors ${isActive ? ringClassName : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
                      >
                        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${badgeClassName}`}>
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="mt-2 truncate text-xs font-semibold text-slate-900 sm:text-sm">{t(labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-sm leading-5 text-slate-600" aria-live="polite">{t(selectedCategory.helpKey)}</p>
              </div>

              <label className="block">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">
                    {t('feedbackFieldTitle')} <span className="text-xs font-normal text-slate-400">({t('feedbackRequired')})</span>
                  </span>
                  {title.length > 0 && <span className="text-xs text-slate-400">{title.length}/{limits.feedbackTitleMaxLength}</span>}
                </div>
                <input
                  ref={titleInputRef}
                  type="text"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value.slice(0, limits.feedbackTitleMaxLength));
                    setFieldErrors((current) => ({ ...current, title: '' }));
                    setSubmitError('');
                  }}
                  placeholder={t('feedbackTitlePlaceholder')}
                  className={fieldClassName}
                  aria-invalid={Boolean(fieldErrors.title)}
                  aria-describedby={fieldErrors.title ? 'feedback-title-error' : undefined}
                  required
                  minLength={3}
                  maxLength={limits.feedbackTitleMaxLength}
                />
                {fieldErrors.title && <p id="feedback-title-error" className="mt-2 text-sm text-red-600" role="alert">{fieldErrors.title}</p>}
              </label>

              <label className="block">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">
                    {t('feedbackFieldDescription')} <span className="text-xs font-normal text-slate-400">({t('feedbackRequired')})</span>
                  </span>
                  {description.length > 0 && <span className="text-xs text-slate-400">{description.length}/{limits.feedbackDescriptionMaxLength}</span>}
                </div>
                <p id="feedback-description-help" className="mb-2 text-sm leading-5 text-slate-500">{t(selectedCategory.descriptionHelpKey)}</p>
                <textarea
                  ref={descriptionInputRef}
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value.slice(0, limits.feedbackDescriptionMaxLength));
                    setFieldErrors((current) => ({ ...current, description: '' }));
                    setSubmitError('');
                  }}
                  placeholder={t('feedbackDescriptionPlaceholder')}
                  className={`min-h-44 ${fieldClassName}`}
                  aria-invalid={Boolean(fieldErrors.description)}
                  aria-describedby={`feedback-description-help${fieldErrors.description ? ' feedback-description-error' : ''}`}
                  required
                  maxLength={limits.feedbackDescriptionMaxLength}
                />
                {fieldErrors.description && <p id="feedback-description-error" className="mt-2 text-sm text-red-600" role="alert">{fieldErrors.description}</p>}
              </label>

              <div className="border-t border-slate-200 pt-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      {t('feedbackFieldImage')} <span className="text-xs font-normal text-slate-400">({t('feedbackOptional')})</span>
                    </p>
                    {!attachment && <p className="mt-1 text-sm text-slate-500">{t('feedbackImageHelp')}</p>}
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
                        const nextAttachmentError = nextAttachment ? getAttachmentValidationError(nextAttachment, t, limits) : '';

                        if (nextAttachmentError) {
                          setAttachment(null);
                          setAttachmentError(nextAttachmentError);
                        } else {
                          setAttachment(nextAttachment);
                          setAttachmentError('');
                          setSubmitError('');
                        }

                        event.target.value = '';
                      }}
                    />
                  </label>
                </div>

                {attachmentError && <p className="mt-3 text-sm text-red-600" role="alert">{attachmentError}</p>}

                {attachment && (
                  <div className="mt-5">
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
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAttachment(null);
                          setAttachmentError('');
                        }}
                        className="inline-flex items-center justify-center gap-2 rounded-[1.25rem] border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t('feedbackRemoveImage')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              </fieldset>
            </form>
          )}
        </SlideOverPanelBody>

        <SlideOverPanelFooter>
          <div className="w-full">
            {submitError && <InlineAlert className="mb-3">{submitError}</InlineAlert>}
            <div className="flex items-center justify-between gap-4">
              <button type="button" onClick={onClose} disabled={submitting} className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50">
                {sent ? t('close') : t('cancel')}
              </button>
              {!sent && (
                <button type="submit" form={FEEDBACK_FORM_ID} disabled={submitting} className="inline-flex items-center gap-2 rounded-[1.25rem] bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
                  <Send className="h-4 w-4" />
                  {submitting ? t('feedbackSending') : t('feedbackSubmit')}
                </button>
              )}
            </div>
          </div>
        </SlideOverPanelFooter>
    </SlideOverPanelFrame>
  );
};

export default FeedbackModal;
