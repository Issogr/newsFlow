import { READER_TEXT_WIDTH_ORDER } from '../config/readerTextWidth';
import { setStoredReaderTextWidthPreference } from '../utils/readerTextWidthPreference';
import ReaderStepControls from './ReaderStepControls';

const WIDTH_INDICATORS = {
  default: '64ch',
  wide: '72ch',
  widest: '80ch'
};

const ReaderTextWidthControls = ({ currentUser, onChange, t, value }) => (
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
