import { useRef } from 'react';
import { READER_TEXT_SIZE_ORDER } from '../config/readerTextSize';
import { updateUserSettings } from '../services/api';
import { setStoredReaderTextSizePreference } from '../utils/readerTextSizePreference';

const ReaderTextSizeControls = ({ currentUser, onChange, t, value }) => {
  const requestIdRef = useRef(0);
  const valueIndex = Math.max(READER_TEXT_SIZE_ORDER.indexOf(value), 0);
  const updateTextSize = async (nextValue) => {
    if (nextValue === value) {
      return;
    }

    const previousValue = value;
    const persistedValue = setStoredReaderTextSizePreference(nextValue);
    onChange(persistedValue);

    if (!currentUser?.settings) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    try {
      await updateUserSettings({ readerTextSize: persistedValue });
    } catch {
      if (requestIdRef.current === requestId) {
        setStoredReaderTextSizePreference(previousValue);
        onChange(previousValue);
      }
    }
  };

  return (
    <div className="flex h-11 items-center gap-1 rounded-[1rem] border border-slate-200 bg-slate-50 px-1.5" role="group" aria-label={t('readerTextSizeSetting')}>
      <button
        type="button"
        onClick={() => updateTextSize(READER_TEXT_SIZE_ORDER[Math.max(valueIndex - 1, 0)])}
        disabled={valueIndex === 0}
        className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-lg font-medium text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={t('decreaseReaderTextSize')}
        title={t('decreaseReaderTextSize')}
      >
        -
      </button>
      <span className="min-w-[2.5rem] text-center text-sm font-semibold tracking-[0.08em] text-slate-500" aria-hidden="true">
        aA
      </span>
      <button
        type="button"
        onClick={() => updateTextSize(READER_TEXT_SIZE_ORDER[Math.min(valueIndex + 1, READER_TEXT_SIZE_ORDER.length - 1)])}
        disabled={valueIndex === READER_TEXT_SIZE_ORDER.length - 1}
        className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-lg font-medium text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={t('increaseReaderTextSize')}
        title={t('increaseReaderTextSize')}
      >
        +
      </button>
    </div>
  );
};

export default ReaderTextSizeControls;
