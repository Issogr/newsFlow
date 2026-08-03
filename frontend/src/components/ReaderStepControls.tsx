import { useRef } from 'react';
import { updateUserSettings } from '../services/api';
import type { CurrentUser } from '../types';

interface ReaderStepControlsProps<T extends string> {
  className?: string;
  currentUser?: CurrentUser;
  decreaseLabel: string;
  groupLabel: string;
  increaseLabel: string;
  indicator: string;
  onChange: (value: T) => void;
  order: readonly T[];
  persistValue: (value: unknown) => T;
  settingKey: string;
  value: T;
}

const ReaderStepControls = <T extends string>({
  className = 'flex',
  currentUser,
  decreaseLabel,
  groupLabel,
  increaseLabel,
  indicator,
  onChange,
  order,
  persistValue,
  settingKey,
  value
}: ReaderStepControlsProps<T>) => {
  const requestIdRef = useRef(0);
  const valueIndex = Math.max(order.indexOf(value), 0);
  const updateValue = async (nextValue: T) => {
    if (nextValue === value) {
      return;
    }

    const previousValue = value;
    const persistedValue = persistValue(nextValue);
    onChange(persistedValue);

    if (!currentUser?.settings) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    try {
      await updateUserSettings({ [settingKey]: persistedValue });
    } catch {
      if (requestIdRef.current === requestId) {
        persistValue(previousValue);
        onChange(previousValue);
      }
    }
  };

  return (
    <div className={`${className} h-11 items-center gap-1 rounded-[1rem] border border-slate-200 bg-slate-50 px-1`} role="group" aria-label={groupLabel}>
      <button
        type="button"
        onClick={() => updateValue(order[Math.max(valueIndex - 1, 0)])}
        disabled={valueIndex === 0}
        className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-lg font-medium text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={decreaseLabel}
        title={decreaseLabel}
      >
        -
      </button>
      <span className="inline-flex min-w-8 items-center justify-center text-center text-xs font-semibold tracking-[0.04em] text-slate-500 sm:min-w-[2.5rem] sm:text-sm sm:tracking-[0.08em]" aria-hidden="true">
        {indicator}
      </span>
      <button
        type="button"
        onClick={() => updateValue(order[Math.min(valueIndex + 1, order.length - 1)])}
        disabled={valueIndex === order.length - 1}
        className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-lg font-medium text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={increaseLabel}
        title={increaseLabel}
      >
        +
      </button>
    </div>
  );
};

export default ReaderStepControls;
