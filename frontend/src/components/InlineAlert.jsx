const TONE_CLASS_NAMES = {
  error: 'border-red-200 bg-red-50 text-red-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800'
};

const InlineAlert = ({ as: Tag = 'div', children, className = '', tone = 'error', ...props }) => (
  <Tag
    className={`rounded-2xl border px-4 py-3 text-sm ${TONE_CLASS_NAMES[tone] || TONE_CLASS_NAMES.error} ${className}`.trim()}
    {...props}
  >
    {children}
  </Tag>
);

export default InlineAlert;
