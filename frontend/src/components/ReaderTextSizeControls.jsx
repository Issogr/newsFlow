import { READER_TEXT_SIZE_ORDER } from '../config/readerTextSize';
import { setStoredReaderTextSizePreference } from '../utils/readerTextSizePreference';
import ReaderStepControls from './ReaderStepControls';

const ReaderTextSizeControls = ({ currentUser, onChange, t, value }) => (
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
