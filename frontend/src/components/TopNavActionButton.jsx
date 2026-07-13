const TopNavActionButton = ({
  icon: Icon,
  label,
  active = false,
  activeClassName = 'text-slate-900',
  sizeClassName = 'h-12 min-w-14 rounded-2xl px-2',
  badge = null,
  badgeClassName = 'bg-slate-800 text-white',
  badgeSizeClassName = 'h-3.5 min-w-3.5 px-1',
  iconClassName = '',
  iconNode = null,
  className = '',
  buttonRef,
  disabled = false,
  type = 'button',
  ...buttonProps
}) => {
  const hasLabel = label !== null && label !== undefined && label !== '';
  const stateClassName = disabled
    ? 'cursor-not-allowed text-slate-300'
    : active
      ? activeClassName
      : 'text-slate-500 hover:text-slate-700';

  return (
    <button
      ref={buttonRef}
      type={type}
      disabled={disabled}
      className={`relative flex ${sizeClassName} ${hasLabel ? 'flex-col gap-0.5' : ''} items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 ${stateClassName} ${className}`}
      {...buttonProps}
    >
      <span className={`relative flex items-center justify-center ${iconNode ? '' : 'h-5 w-5'}`}>
        {iconNode || <Icon className={`h-5 w-5 ${iconClassName}`} aria-hidden="true" />}
        {badge !== null && badge !== undefined && (
          <span className={`absolute -right-1.5 -top-1 flex ${badgeSizeClassName} items-center justify-center ${badge === '' ? 'rounded-full' : 'rounded-md'} text-[8px] font-bold ${badgeClassName}`}>
            {badge}
          </span>
        )}
      </span>
      {hasLabel ? (
        <span className="h-3.5 text-center text-[10px] font-medium leading-none">{label}</span>
      ) : null}
    </button>
  );
};

export default TopNavActionButton;
