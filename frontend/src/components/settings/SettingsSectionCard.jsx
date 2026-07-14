const SettingsSectionCard = ({
  icon: Icon,
  title,
  description,
  badge,
  children,
  iconToneClassName
}) => {
  return (
    <section className="border-b border-slate-200 py-8 first:pt-1 last:border-b-0 last:pb-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconToneClassName}`} aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h3>
            {description && <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600">{description}</p>}
          </div>
        </div>
        {badge ? (
          <span className="pt-1 text-sm font-semibold tabular-nums text-slate-500">
            {badge}
          </span>
        ) : null}
      </div>

      <div className="mt-6 space-y-6">{children}</div>
    </section>
  );
};

export default SettingsSectionCard;
