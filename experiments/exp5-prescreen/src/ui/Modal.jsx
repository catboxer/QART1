import React from 'react';

export default function Modal({ open, onClose, children, width = 380, title }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? <h3 className="modal-title">{title}</h3> : null}
        {children}
        <div className="modal-actions">
          <button className="primary-btn" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}
