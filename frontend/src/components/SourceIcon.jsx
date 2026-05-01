import React, { useState } from 'react';

const getSourceInitial = (name = '') => String(name || '?').trim().charAt(0).toUpperCase() || '?';

const SourceIcon = ({ source, className = 'h-7 w-7', imageClassName = 'h-4 w-4' }) => {
  const [failed, setFailed] = useState(false);
  const iconUrl = source?.iconUrl || '';

  if (!iconUrl || failed) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-[0.68rem] font-semibold text-slate-600 ${className}`}>
        {getSourceInitial(source?.name)}
      </span>
    );
  }

  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white ${className}`}>
      <img
        src={iconUrl}
        alt=""
        className={`object-contain ${imageClassName}`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
};

export default SourceIcon;
