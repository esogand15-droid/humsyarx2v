import { useState } from 'react';
import { usePresence } from '../lib/motion';

export interface ToastProps {
  message: string | null;
}

/** توست — کوتاه، پایین صفحه، با انیمیشن ورود و خروج و بدون آیکون ایموجی. */
export function Toast({ message }: ToastProps) {
  const { mounted, state } = usePresence(Boolean(message), 160);
  const [lastMessage, setLastMessage] = useState(message);
  if (message && message !== lastMessage) setLastMessage(message);

  if (!mounted || !lastMessage) return null;
  return (
    <div className="toast mo-toast" data-state={state} role="status" aria-live="polite">
      {message || lastMessage}
    </div>
  );
}
