import { useT } from '../lib/i18n';
import { useHomeScreen } from '../lib/homeScreen';
import { useMe } from '../lib/queries';
import { haptic } from '../lib/telegram';
import { IconBell, IconCheck } from './icons';
import { useToast } from './Toast';
import { Button, Section } from './ui';

/**
 * A shortcut on the phone's home screen (with the church's main photo as its icon),
 * and how notifications reach the phone: as bot messages, i.e. Telegram's own pushes.
 */
export function HomeScreenCard() {
  const t = useT();
  const me = useMe();
  const toast = useToast();
  const { status, add, os } = useHomeScreen({
    added: () => toast(t.homeScreen.addedToast),
    failed: () => toast(t.homeScreen.failedToast, 'error'),
  });
  const steps = os === 'ios' ? t.homeScreen.ios : os === 'android' ? t.homeScreen.android : null;
  const logo = me.data?.church.logoUrl ?? '/icon.svg';
  return (
    <Section title={t.homeScreen.title}>
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        <img
          src={logo}
          alt=""
          className="h-14 w-14 shrink-0 rounded-[16px] bg-white object-cover shadow-card ring-1 ring-hairline"
        />
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-hint">{t.homeScreen.hint}</p>
      </div>
      <div className="px-4 pb-4">
        {status === 'added' ? (
          <p className="flex items-center justify-center gap-1.5 py-2 text-[15px] font-semibold text-present">
            <IconCheck size={18} /> {t.homeScreen.added}
          </p>
        ) : status === 'unsupported' ? (
          <p className="py-2 text-center text-[13px] text-hint">{t.homeScreen.unsupported}</p>
        ) : (
          <Button
            onClick={() => {
              haptic.tap();
              add();
            }}
          >
            📲 {t.homeScreen.add}
          </Button>
        )}
      </div>
      {status !== 'added' && (
        <div className="border-t border-hairline px-4 py-3">
          <div className="mb-1.5 text-[13px] font-semibold">
            {t.homeScreen.stepsTitle}
            {steps ? '' : ' (Android / iPhone)'}
          </div>
          {(steps ? [steps] : [t.homeScreen.android, t.homeScreen.ios]).map((list, k) => (
            <ol
              key={k}
              className="mb-1 flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-snug text-hint"
            >
              {!steps && (
                <li className="list-none -ml-5 font-semibold">{k === 0 ? 'Android' : 'iPhone'}</li>
              )}
              {list.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
          ))}
        </div>
      )}
      <div className="flex items-start gap-3 border-t border-hairline px-4 py-3.5">
        <span className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white">
          <IconBell size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{t.homeScreen.notifTitle}</span>
          <span className="block text-[13px] leading-snug text-hint">{t.homeScreen.notifHint}</span>
          <span className="mt-1 block text-[12px] leading-snug text-hint">
            {t.homeScreen.notifPhone}
          </span>
        </span>
      </div>
    </Section>
  );
}
