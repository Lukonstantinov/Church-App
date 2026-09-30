import { ru } from '@church/shared';
import { Button, CenterMessage } from './components/ui';
import { useMe } from './lib/queries';
import { isInsideTelegram } from './lib/telegram';
import { Home } from './screens/Home';

export function App() {
  const inside = isInsideTelegram();
  const me = useMe();

  if (!inside) return <CenterMessage>{ru.app.openInTelegram}</CenterMessage>;
  if (me.isPending) return <CenterMessage>{ru.app.loading}</CenterMessage>;
  if (me.isError) {
    return (
      <CenterMessage>
        <p>{ru.app.errorGeneric}</p>
        <div className="w-48">
          <Button onClick={() => void me.refetch()}>{ru.app.retry}</Button>
        </div>
      </CenterMessage>
    );
  }
  return <Home me={me.data} />;
}
