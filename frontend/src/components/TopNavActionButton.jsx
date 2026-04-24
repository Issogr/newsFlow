import React from 'react';

const TopNavActionButton = ({
  icon: Icon,
  label,
  active = false,
  activeClassName = 'text-slate-900',
  inactiveClassName = 'text-slate-500 hover:text-slate-700',
  disabledClassName = 'cursor-not-allowed text-slate-300',
  minWidthClassName = 'min-w-14',
  badge = null,
  badgeClassName = 'bg-slate-800 text-white',
  iconClassName = '',
  labelClassName = '',
  className = '',
  disabled = false,
  type = 'button',
  ...buttonProps
}) => {
  const stateClassName = disabled
    ? disabledClassName
    : active
      ? activeClassName
      : inactiveClassName;

  return (
    <button
      type={type}
      disabled={disabled}
      className={`relative flex h-12 ${minWidthClassName} flex-col items-center justify-center gap-0.5 rounded-2xl px-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 ${stateClassName} ${className}`}
      {...buttonProps}
    >
      <span className="relative flex h-5 w-5 items-center justify-center">
        <Icon className={`h-5 w-5 ${iconClassName}`} aria-hidden="true" />
        {badge !== null && badge !== undefined && (
          <span className={`absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[8px] font-bold ${badgeClassName}`}>
            {badge}
          </span>
        )}
      </span>
      <span className={`h-3.5 text-center text-[10px] font-medium leading-none ${labelClassName}`}>{label}</span>
    </button>
  );
};

export default TopNavActionButton;
