import BrandMark from './BrandMark';

export const StaticInfoSection = ({ children, className = 'border-slate-200 bg-slate-50' }) => (
  <section className={`rounded-[1.5rem] border p-5 ${className}`}>
    {children}
  </section>
);

const StaticInfoPageFrame = ({ children, content, introClassName = 'mt-2 max-w-3xl text-sm text-slate-600' }) => (
  <div className="min-h-screen bg-white text-slate-900 sm:bg-slate-100 sm:px-4 sm:pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:pt-[max(2.5rem,env(safe-area-inset-top))]">
    <div className="min-h-screen w-full bg-white px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] sm:mx-auto sm:min-h-0 sm:max-w-4xl sm:rounded-[2rem] sm:border sm:border-slate-200 sm:p-8 sm:shadow-xl">
      <div className="mb-8 flex items-center gap-4">
        <BrandMark className="h-12 w-12" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">{content.eyebrow}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{content.title}</h1>
          <p className={introClassName}>{content.intro}</p>
        </div>
      </div>

      <div className="space-y-6">
        {children}
      </div>
    </div>
  </div>
);

export default StaticInfoPageFrame;
