const SKELETON_PARAGRAPHS = [
  ['w-full', 'w-11/12', 'w-4/5'],
  ['w-full', 'w-5/6'],
  ['w-11/12', 'w-full', 'w-2/3']
];

const TextContentSkeleton = ({ label }: { label: string }) => (
  <div className="animate-pulse space-y-6" role="status" aria-label={label}>
    <p className="text-sm font-medium text-stone-500">{label}</p>
    <div className="space-y-6" aria-hidden="true">
      {SKELETON_PARAGRAPHS.map((lines, paragraphIndex) => (
        <div key={paragraphIndex} className="space-y-3">
          {lines.map((width, lineIndex) => (
            <div key={lineIndex} className={`h-3.5 rounded-full bg-slate-200 ${width}`} />
          ))}
        </div>
      ))}
    </div>
  </div>
);

export default TextContentSkeleton;
