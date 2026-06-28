import { useRef, useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  /** Показать поле комментария (необязательного). */
  withComment?: boolean;
  commentPlaceholder?: string;
  /** Мин. длина непустого комментария. Пустой комментарий допустим. */
  commentMinLength?: number;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}

/**
 * Модальное окно подтверждения в стилистике приложения.
 * Поле комментария — НЕконтролируемое (значение живёт в DOM, читается через ref):
 * так предиктивные клавиатуры/IME не ломаются (нет навязывания value и setSelectionRange).
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Да',
  cancelLabel = 'Нет',
  danger = false,
  busy = false,
  error,
  withComment = false,
  commentPlaceholder = 'Комментарий (необязательно)',
  commentMinLength = 4,
  onConfirm,
  onCancel,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [tooShort, setTooShort] = useState(false);

  if (!open) return null;

  const onInput = () => {
    const v = (inputRef.current?.value ?? '').trim();
    setTooShort(v.length > 0 && v.length < commentMinLength);
  };

  const handleConfirm = () => {
    if (busy) return;
    const v = (inputRef.current?.value ?? '').trim();
    if (withComment && v.length > 0 && v.length < commentMinLength) {
      setTooShort(true);
      return;
    }
    onConfirm(withComment ? v : '');
  };

  const blocked = busy || tooShort;

  return (
    <div style={d.backdrop} onClick={() => { if (!busy) onCancel(); }}>
      <div style={d.modal} onClick={(e) => e.stopPropagation()}>
        <div style={d.title}>{title}</div>
        {message && <div style={d.text}>{message}</div>}

        {withComment && (
          <>
            <textarea
              ref={inputRef}
              style={d.input}
              placeholder={commentPlaceholder}
              rows={2}
              defaultValue=""
              onInput={onInput}
              enterKeyHint="done"
            />
            {tooShort && <div style={d.hint}>Минимум {commentMinLength} символа</div>}
          </>
        )}

        {error && <div style={d.error}>{error}</div>}

        <div style={d.row}>
          <button style={d.cancel} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            style={{ ...d.confirm, ...(danger ? d.confirmDanger : {}), ...(blocked ? d.confirmBlocked : {}) }}
            onClick={handleConfirm}
            disabled={blocked}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const d: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  modal: {
    width: '100%',
    maxWidth: '320px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '20px',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: '18px',
    color: 'var(--text)',
    lineHeight: 1.3,
  },
  text: {
    fontFamily: 'var(--font-display)',
    fontSize: '13px',
    color: 'var(--text3)',
    marginTop: '8px',
    lineHeight: 1.5,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    marginTop: '14px',
    resize: 'none',
    background: 'var(--bg3)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    fontFamily: 'var(--font-display)',
    fontSize: '14px',
    lineHeight: 1.4,
    outline: 'none',
  },
  hint: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--yellow)',
    marginTop: '6px',
  },
  error: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--red)',
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 10px',
    marginTop: '12px',
    lineHeight: 1.4,
  },
  row: { display: 'flex', gap: '10px', marginTop: '20px' },
  cancel: {
    flex: 1,
    background: 'var(--bg3)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '12px',
    fontFamily: 'var(--font-display)',
    fontWeight: 600,
    fontSize: '14px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  confirm: {
    flex: 1,
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '12px',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '14px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  confirmDanger: { background: 'var(--red)' },
  confirmBlocked: { opacity: 0.5, cursor: 'default' },
};
