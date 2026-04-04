import React from 'react';
import { Check } from 'lucide-react';

function getShareStatusPresentation(shareState, t) {
  if (shareState === 'copied') {
    return {
      Icon: Check,
      text: t('shareCopiedMessage'),
      className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      iconClassName: 'bg-white text-emerald-700',
    };
  }

  return null;
}

const ShareStatusBubble = ({ shareState, t, className = '' }) => {
  const presentation = getShareStatusPresentation(shareState, t);

  if (!presentation) {
    return null;
  }

  const { Icon, text, className: bubbleClassName, iconClassName } = presentation;

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium shadow-sm ${bubbleClassName} ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${iconClassName}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span>{text}</span>
    </div>
  );
};

export default ShareStatusBubble;
