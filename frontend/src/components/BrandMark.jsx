import React from 'react';

const BrandMark = ({ className = 'h-11 w-11' }) => {
  return (
    <img src="/logo.svg" alt="" className={className} aria-hidden="true" draggable="false" />
  );
};

export default BrandMark;
