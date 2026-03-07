import React from 'react';

const BrandMark = ({ className = 'h-11 w-11', compact = false }) => {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="18" fill="#0F172A" />
      <rect x="14" y="15" width="36" height="34" rx="9" fill="#F8FAFC" />
      <rect x="19" y="21" width="10" height="10" rx="3" fill="#38BDF8" />
      <rect x="32" y="22" width="13" height="3" rx="1.5" fill="#0F172A" fillOpacity="0.88" />
      <rect x="32" y="28" width="10" height="3" rx="1.5" fill="#0F172A" fillOpacity="0.35" />
      <path d="M19 38H24.5L27.5 34L30.5 42L33.5 36L36 38H45" stroke="#0F172A" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      {!compact && <circle cx="47.5" cy="18.5" r="4.5" fill="#F59E0B" />}
    </svg>
  );
};

export default BrandMark;
