import React from 'react';

const SettingsSectionCard = ({
  icon: Icon,
  title,
  description,
  badge,
  children,
  className = '',
  iconToneClassName = 'bg-sky-100 text-sky-700'
}) => {
  return (
    <section className={`rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm ${className}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm ${iconToneClassName}`}>
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {description && <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>}
          </div>
        </div>
        {badge ? (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {badge}
          </span>
        ) : null}
      </div>

      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
};

export default SettingsSectionCard;
