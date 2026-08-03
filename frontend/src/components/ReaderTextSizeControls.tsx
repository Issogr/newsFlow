import { READER_TEXT_SIZE_ORDER, type ReaderTextSize } from '../config/readerTextSize';
import { setStoredReaderTextSizePreference } from '../utils/readerPreferences';
import ReaderStepControls from './ReaderStepControls';
import type { CurrentUser, Translator } from '../types';

const ReaderTextSizeControls = ({ currentUser, onChange, t, value }: { currentUser?: CurrentUser; onChange: (value: ReaderTextSize) => void; t: Translator; value: ReaderTextSize }) => (
  <ReaderStepControls
    currentUser={currentUser}
    decreaseLabel={t('decreaseReaderTextSize')}
    groupLabel={t('readerTextSizeSetting')}
    increaseLabel={t('increaseReaderTextSize')}
    indicator="aA"
    onChange={onChange}
    order={READER_TEXT_SIZE_ORDER}
    persistValue={setStoredReaderTextSizePreference}
    settingKey="readerTextSize"
    value={value}
  />
);

export default ReaderTextSizeControls;
