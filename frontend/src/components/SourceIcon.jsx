import { useState } from 'react';
import { getSafeExternalUrl } from '../utils/urlSafety';

const getSourceInitial = (name = '') => String(name || '?').trim().charAt(0).toUpperCase() || '?';

const SourceIcon = ({ source, className = 'h-7 w-7' }) => {
  const [failedIconUrl, setFailedIconUrl] = useState('');
  const iconUrl = getSafeExternalUrl(source?.iconUrl);
  const containerClassName = `inline-flex box-border shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-inset ring-slate-200 ${className}`;

  if (!iconUrl || failedIconUrl === iconUrl) {
    return (
      <span aria-hidden="true" className={`${containerClassName} text-[0.68rem] font-semibold text-slate-600`}>
        {getSourceInitial(source?.name)}
      </span>
    );
  }

  return (
    <span aria-hidden="true" className={containerClassName}>
      <img
        src={iconUrl}
        alt=""
        className="h-full w-full object-contain"
        loading="lazy"
        onError={() => setFailedIconUrl(iconUrl)}
      />
    </span>
  );
};

export default SourceIcon;
