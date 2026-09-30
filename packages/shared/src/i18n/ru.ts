/**
 * All user-facing Russian text. Keep strings here (not inline) so another
 * language can be added later by providing the same shape.
 */
export const ru = {
  appName: 'Молодёжь',
  bot: {
    welcome: (name: string) =>
      `Привет, ${name}! 👋\n\nЭто бот молодёжного служения. Здесь отмечается посещаемость, ведётся касса группы и приходят напоминания.\n\nНажми «Открыть приложение», чтобы начать.`,
    openApp: 'Открыть приложение',
    help: 'Команды:\n/app — открыть приложение\n/me — моя посещаемость\n/privacy — мои данные\n/help — помощь',
    appNotConfigured: 'Приложение ещё не настроено. Сообщите администратору.',
  },
  commands: {
    start: 'Начать',
    app: 'Открыть приложение',
    me: 'Моя посещаемость и пожертвования',
    privacy: 'Политика конфиденциальности, мои данные',
    help: 'Помощь',
  },
  app: {
    hello: (name: string) => `Привет, ${name}!`,
    loading: 'Загрузка…',
    openInTelegram: 'Откройте приложение через Telegram-бота.',
    errorGeneric: 'Что-то пошло не так. Попробуйте ещё раз.',
    retry: 'Повторить',
    noGroupsYet:
      'Вы пока не состоите ни в одной группе. Попросите лидера прислать ссылку-приглашение.',
    adminBadge: 'Администратор',
    roleLeader: 'Лидер',
    roleMember: 'Участник',
    statusPending: 'Заявка на рассмотрении',
  },
} as const;
