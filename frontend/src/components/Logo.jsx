import React from 'react';

export default function Logo({ className = "", style = {} }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={`conseal-logo ${className}`}
      style={{ width: '1em', height: '1em', ...style }}
    >
      <path d="M14 2C9 2 5 6 5 11c0 2 1.5 4.5 4 6 1.5 1 2 2 3 3 1 1 3 1 4 0 1-1 1.5-2 3-3 2.5-1.5 4-4 4-6 0-5-4-9-9-9z" />
      <path d="M12 11h.01" />
      <path d="M16 11h.01" />
      <path d="M9 16c1.5-1 3.5-1 5 0" />
      <path d="M2 13h2" />
      <path d="M2 15h2" />
      <path d="M20 13h2" />
      <path d="M20 15h2" />
    </svg>
  );
}
