import { READER_TEXT_WIDTH_ORDER, type ReaderTextWidth } from '../config/readerTextWidth';
import { setStoredReaderTextWidthPreference } from '../utils/readerPreferences';
import ReaderStepControls from './ReaderStepControls';
import type { CurrentUser, Translator } from '../types';

const WIDTH_INDICATORS = {
  default: '64ch',
  wide: '72ch',
  widest: '80ch'
};

const ReaderTextWidthControls = ({ currentUser, onChange, t, value }: { currentUser?: CurrentUser; onChange: (value: ReaderTextWidth) => void; t: Translator; value: ReaderTextWidth }) => (
  <ReaderStepControls
    className="hidden sm:flex"
    currentUser={currentUser}
    decreaseLabel={t('decreaseReaderTextWidth')}
    groupLabel={t('readerTextWidthSetting')}
    increaseLabel={t('increaseReaderTextWidth')}
    indicator={WIDTH_INDICATORS[value] || WIDTH_INDICATORS.default}
    onChange={onChange}
    order={READER_TEXT_WIDTH_ORDER}
    persistValue={setStoredReaderTextWidthPreference}
    settingKey="readerTextWidth"
    value={value}
  />
);

export default ReaderTextWidthControls;
