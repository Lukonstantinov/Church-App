/**
 * All user-facing Russian text. Keep strings here (not inline) so another
 * language can be added later by providing the same shape.
 * Bot strings that contain user names are HTML (parse_mode: HTML) — callers escape names.
 */
export const ru = {
  appName: 'Молодёжь',
  bot: {
    welcome: (name: string) =>
      `Привет, ${name}! 👋\n\nЭто бот молодёжного служения. Здесь отмечается посещаемость, ведётся касса группы и приходят напоминания.\n\nНажми «Открыть приложение», чтобы начать.`,
    openApp: 'Открыть приложение',
    help: 'Команды:\n/app — открыть приложение\n/privacy — политика конфиденциальности\n/help — помощь\n\nЧтобы вступить в группу, попросите у лидера ссылку-приглашение.',
    privacyNotice:
      '<b>Прежде чем продолжить</b>\n\n' +
      'Мы храним только необходимое для работы служения: ваше имя и Telegram-аккаунт, в каких группах вы состоите, посещаемость встреч и (если вы их делаете) записи о пожертвованиях.\n\n' +
      'Данные видят только лидеры ваших групп и администраторы церкви. Мы не передаём их третьим лицам. ' +
      'Вы можете в любой момент запросить копию своих данных или их удаление командой /privacy.\n\n' +
      'Если вам меньше 16 лет, лидер попросит согласия ваших родителей.',
    privacyAccept: 'Принимаю',
    privacyAccepted: 'Спасибо! ✅',
    privacyInfo:
      '<b>Ваши данные</b>\n\nМы храним: имя, Telegram-аккаунт, группы, посещаемость и записи о пожертвованиях. ' +
      'Доступ есть только у лидеров ваших групп и администраторов.\n\n' +
      'Чтобы получить копию данных или удалить их, напишите администратору церкви.',
    inviteNotFound: 'Ссылка-приглашение недействительна или устарела. Попросите у лидера новую.',
    joinRequested: (group: string) =>
      `Заявка в группу «${group}» отправлена ✅\nЛидер скоро её рассмотрит — я напишу, когда вас примут.`,
    joinAlreadyPending: (group: string) => `Ваша заявка в группу «${group}» уже на рассмотрении.`,
    joinAlreadyMember: (group: string) => `Вы уже состоите в группе «${group}».`,
    joinApprovedToMember: (group: string) =>
      `🎉 Вас приняли в группу «${group}»! Добро пожаловать.`,
    joinRejectedToMember: (group: string) =>
      `К сожалению, заявку в группу «${group}» не приняли. Если это ошибка, свяжитесь с лидером.`,
    joinCard: (nameHtml: string, usernameHtml: string | null, group: string) =>
      `🙋 <b>Новая заявка</b> в «${group}»\n${nameHtml}${usernameHtml ? ` (@${usernameHtml})` : ''}`,
    joinCardApproved: (nameHtml: string, group: string, byHtml: string) =>
      `✅ ${nameHtml} принят(а) в «${group}» — ${byHtml}`,
    joinCardRejected: (nameHtml: string, group: string, byHtml: string) =>
      `❌ Заявка ${nameHtml} в «${group}» отклонена — ${byHtml}`,
    approve: '✅ Принять',
    reject: '❌ Отклонить',
    notAllowed: 'Недостаточно прав.',
    alreadyHandled: 'Заявка уже обработана.',
    claimInvalid: 'Код привязки недействителен или истёк. Попросите у лидера новый.',
    claimAccountInUse:
      'Этот Telegram-аккаунт уже зарегистрирован в группах. Обратитесь к администратору, чтобы объединить профили.',
    claimDone: (name: string) => `Готово! Профиль «${name}» теперь привязан к вашему Telegram ✅`,
  },
  commands: {
    start: 'Начать',
    app: 'Открыть приложение',
    me: 'Моя посещаемость и пожертвования',
    privacy: 'Мои данные и конфиденциальность',
    help: 'Помощь',
  },
  app: {
    hello: (name: string) => `Привет, ${name}!`,
    loading: 'Загрузка…',
    openInTelegram: 'Откройте приложение через Telegram-бота.',
    errorGeneric: 'Что-то пошло не так. Попробуйте ещё раз.',
    errorForbidden: 'Недостаточно прав.',
    retry: 'Повторить',
    save: 'Сохранить',
    cancel: 'Отмена',
    noGroupsYet:
      'Вы пока не состоите ни в одной группе. Попросите лидера прислать ссылку-приглашение.',
    adminBadge: 'Администратор',
    roleLeader: 'Лидер',
    roleMember: 'Участник',
    statusPending: 'Заявка на рассмотрении',
    myGroups: 'Мои группы',
    groups: 'Группы',
    profile: 'Профиль',
    churchGroups: 'Группы церкви',
    createGroup: 'Создать группу',
    groupName: 'Название',
    groupDescription: 'Описание (необязательно)',
    archived: 'В архиве',
    archiveGroup: 'Архивировать группу',
    archiveConfirm: 'Архивировать группу? Участники больше не будут её видеть.',
    members: 'Участники',
    pendingRequests: 'Заявки',
    leaders: 'Лидеры',
    noMembers: 'Пока никого нет. Отправьте ссылку-приглашение.',
    inviteLink: 'Ссылка-приглашение',
    inviteHint: 'Отправьте ссылку или покажите QR-код. Каждую заявку подтверждает лидер.',
    share: 'Поделиться',
    copy: 'Копировать',
    copied: 'Скопировано',
    showQr: 'Показать QR-код',
    rotateInvite: 'Новая ссылка (старая перестанет работать)',
    rotateConfirm: 'Создать новую ссылку? Старая перестанет работать.',
    addOffline: 'Добавить без Telegram',
    firstName: 'Имя',
    lastName: 'Фамилия (необязательно)',
    guardianConsent: 'Есть согласие родителей',
    guardianConsentHint: 'Для участников младше возраста цифрового согласия (13–16 лет).',
    approve: 'Принять',
    reject: 'Отклонить',
    offline: 'без Telegram',
    unreachable: 'недоступен',
    makeLeader: 'Сделать лидером',
    makeMember: 'Сделать участником',
    removeFromGroup: 'Удалить из группы',
    removeConfirm: 'Удалить участника из группы? История посещений сохранится.',
    claimCode: 'Код привязки Telegram',
    claimCodeHint:
      'Отправьте эту ссылку участнику. Когда он откроет её в Telegram, профиль привяжется к его аккаунту. Ссылка действует 7 дней.',
    issueClaimCode: 'Выдать код привязки',
    makeAdmin: 'Назначить администратором',
    removeAdmin: 'Снять права администратора',
    edit: 'Изменить',
    back: 'Назад',
  },
} as const;
