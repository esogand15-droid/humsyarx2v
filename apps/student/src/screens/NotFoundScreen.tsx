import { useNavigate } from 'react-router-dom';
import { AppBar } from '../components/AppBar';
import { DsButton, DsEmpty } from '../design/components';
import { Icon } from '../icons/Icon';

/** NF1: real 404. Persian copy, a back action and a way home; no build-phase notes. */
export function NotFoundScreen() {
  const navigate = useNavigate();
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1;
  const goBack = () => (canGoBack ? navigate(-1) : navigate('/', { replace: true }));

  return (
    <>
      <AppBar title="صفحه پیدا نشد" back onBack={goBack} />
      <div className="page not-found">
        <DsEmpty
          icon={<Icon name="i-search" size={28} />}
          title="این صفحه وجود ندارد"
          body="ممکن است نشانی اشتباه وارد شده باشد یا این بخش جابهجا شده باشد."
          action={
            <div className="not-found__actions">
              <DsButton onClick={() => navigate('/', { replace: true })}>
                <Icon name="i-home" size={18} />
                بازگشت به خانه
              </DsButton>
              <DsButton variant="secondary" onClick={goBack}>
                بازگشت به صفحهٔ قبل
              </DsButton>
            </div>
          }
        />
      </div>
    </>
  );
}
