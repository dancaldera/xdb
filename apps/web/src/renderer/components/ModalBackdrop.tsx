import type { ReactElement, ReactNode } from "react";

export function ModalBackdrop({ onClose, children }: { onClose: () => void; children: ReactNode }): ReactElement {
  return (
    <div className="modal-backdrop">
      <button
        aria-label="Close modal"
        className="modal-backdrop-dismiss"
        tabIndex={-1}
        type="button"
        onClick={onClose}
      />
      {children}
    </div>
  );
}
