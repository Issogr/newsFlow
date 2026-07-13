import { ExternalLink } from 'lucide-react';

const DEFAULT_EXTERNAL_PILL_LINK_CLASS_NAME = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100';

const ExternalPillLink = ({
  href,
  children,
  className = DEFAULT_EXTERNAL_PILL_LINK_CLASS_NAME,
  target,
  rel,
}) => (
  <a
    href={href}
    target={target}
    rel={target === '_blank' ? (rel || 'noopener noreferrer') : rel}
    className={`inline-flex w-fit items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${className}`}
  >
    <span>{children}</span>
    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
  </a>
);

export default ExternalPillLink;
