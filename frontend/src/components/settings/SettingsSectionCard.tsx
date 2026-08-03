import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const SettingsSectionCard = ({
  icon: Icon,
  title,
  badge,
  children,
  iconToneClassName
}: { icon: LucideIcon; title: string; badge?: ReactNode; children: ReactNode; iconToneClassName: string }) => {
  return (
    <section className="border-b border-slate-200 py-8 first:pt-1 last:border-b-0 last:pb-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconToneClassName}`} aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h3>
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
