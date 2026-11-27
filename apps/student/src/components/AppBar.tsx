import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconButton } from './IconButton';
import { useHeader } from '../layout/HeaderContext';

export interface AppBarProps {
  title: string;
  sub?: string;
  back?: boolean;
  actions?: ReactNode;
  onBack?: () => void;
}

/** نوار بالای صفحه — ثبت متادیتا در هدر دسکتاپ و نمایش در موبایل */
export function AppBar({ title, sub, back = false, actions, onBack }: AppBarProps) {
  const navigate = useNavigate();
  const { setHeader, resetHeader } = useHeader();

  // همگام‌سازی متادیتا با هدر شناور دسکتاپ
  useEffect(() => {
    setHeader({ title, sub, back, onBack, actions });
  }, [title, sub, back, onBack, actions, setHeader]);

  // پاک‌سازی در زمان خروج از صفحه
  useEffect(() => {
    return () => {
      resetHeader();
    };
  }, [resetHeader]);

  return (
    <header className="appbar">
      {back && (
        <IconButton
          icon="i-chevron-r"
          label="بازگشت"
          onClick={onBack ?? (() => navigate(-1))}
        />
      )}
      <div className="grow">
        <h1 className="appbar__title">{title}</h1>
        {sub && <div className="appbar__sub">{sub}</div>}
      </div>
      {actions}
    </header>
  );
}

