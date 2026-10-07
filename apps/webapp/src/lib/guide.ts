/**
 * The developer's how-to guide (Instructions screen): how to add, change and remove
 * everything in the app, and how to run the project. Written in English for the
 * developer; screen names are given as they appear in the Russian interface.
 * Keep it in step with CLAUDE.md when features change.
 */

export interface GuideItem {
  title: string;
  steps: string[];
  /** A warning or tip shown under the steps. */
  note?: string;
}

export interface GuideSection {
  key: string;
  icon: string;
  title: string;
  items: GuideItem[];
}

export const GUIDE: GuideSection[] = [
  {
    key: 'church',
    icon: '⛪',
    title: 'Church & ministries',
    items: [
      {
        title: 'Change the church name, colour, logo (main photo), language, time zone',
        steps: [
          'Main screen «Служения» → «Настройки церкви» (church admins only).',
          'Edit the name, colour, logo, default language, time zone or the label printed on posters/PDFs.',
          'The logo is also the icon of the phone shortcut and the app in a browser.',
        ],
      },
      {
        title: 'Change the main window background',
        steps: [
          '«Настройки церкви» → «Фон приложения» (at the top).',
          'Pick own look or colours, strength, pattern and movement. Saved with one button.',
        ],
      },
      {
        title: 'Add a ministry',
        steps: [
          'Main screen «Служения» → «+» (create) → name it → it opens.',
          'Then «Ещё» → «Настройки служения» to set its colour, logo, pattern, photo and chat.',
        ],
      },
      {
        title: "Change a ministry's look, default place, chat or background",
        steps: [
          'Open the ministry → «Ещё» → «Настройки служения».',
          'Sections: look/theme, logo, background, default meeting place, Telegram chat, description.',
        ],
      },
      {
        title: 'Archive (remove) a ministry',
        steps: [
          '«Ещё» → «Настройки служения» → the delete/archive button at the bottom → confirm.',
          'Archived ministries are listed in «Настройки церкви» → «Удалённые служения», where they can be restored.',
        ],
        note: 'History (meetings, money, attendance) is kept.',
      },
    ],
  },
  {
    key: 'people',
    icon: '👥',
    title: 'People, positions & labels',
    items: [
      {
        title: 'Invite a person',
        steps: [
          'Open the ministry → «Люди» → add person → share the invite link (or QR).',
          'The person taps the link, presses Start in the bot and is added (or waits for approval).',
          '«Ссылка-приглашение» can be renewed; the old link stops working.',
        ],
      },
      {
        title: 'Add a person without Telegram (offline)',
        steps: [
          '«Люди» → add person → «без Telegram».',
          'They appear on roll calls and in money; later they can claim the profile with a code.',
        ],
      },
      {
        title: 'Remove a person from a ministry',
        steps: ['«Люди» → tap the person → remove from the ministry → confirm.'],
        note: 'Their past attendance and payments stay in the history.',
      },
      {
        title: 'Add / change / remove a position (rights)',
        steps: [
          '«Ещё» → «Должности и права».',
          'Add: name, rights (people, attendance, meetings, money, events, posts, settings), optional look of the chip.',
          'Give it to someone: open the person → choose the position.',
          'Delete: open the position → delete. Its people become plain members.',
        ],
      },
      {
        title: 'Add / remove labels on people',
        steps: [
          '«Ещё» → «Метки» (or «Люди» → labels): create a label with a colour/look.',
          'Open a person → tick labels. Delete a label in «Метки» → delete.',
        ],
      },
      {
        title: "Add a person's photo",
        steps: [
          'Open any meeting → in the people cards tap the photo square on the left.',
          'Leaders can set anyone’s photo; members can set their own.',
        ],
      },
    ],
  },
  {
    key: 'meetings',
    icon: '📅',
    title: 'Meetings',
    items: [
      {
        title: 'Add a one-off meeting',
        steps: [
          '«Встречи» → «Встреча» (or the calendar: tap a day → add meeting).',
          'Date, time, duration, title. Optional: who it is for (chosen people), poster, speakers.',
        ],
      },
      {
        title: 'Make a meeting repeat (weekly / every 2 weeks / monthly)',
        steps: [
          'New meeting → switch on «Повторяющаяся встреча».',
          'Pick how often and how many meetings in all (2–52). All of them appear in the calendar at once.',
          'Later, editing one of them: switch on «Применить к этой и всем следующим» to change the title, topic, place, poster or speakers of the rest too.',
        ],
        note: 'To remove a series, cancel the meetings one by one (cancelled ones disappear from the calendar).',
      },
      {
        title: 'A regular schedule (every Friday at 19:00)',
        steps: [
          '«Встречи» → «Расписание» → add a schedule: day of the week, time, duration, title.',
          'Meetings are created automatically about 3 months ahead.',
          'Delete the schedule to remove its future empty meetings (history stays).',
        ],
      },
      {
        title: 'Meeting for chosen people only (e.g. leaders)',
        steps: [
          'New meeting (or «Изменить» on a meeting) → «Для кого» → pick people.',
          'Only they see it, get its messages and are on its roll call.',
        ],
      },
      {
        title: "Design a meeting's poster and add speakers",
        steps: [
          'Meeting → «🎨 Постер» on the top card (or when creating: switch on «Постер»).',
          'Layout: «Обычный» or «Коллаж из фото спикеров» (needs speakers with photos).',
          'Without its own speakers list, the poster shows the speakers from the people block.',
          'Look: ministry / own / template, colour, headline font, size, position.',
          'Speakers: up to 4, each with an optional photo, name and role.',
        ],
      },
      {
        title: 'Assign the leader, speakers, snacks and other services',
        steps: [
          'Open the meeting → the people block under the poster.',
          'Leader: «Изменить» to choose, «Спросить» to send the bot message with Agree / Can’t.',
          '«Добавить человека» → pick the service: 🎤 Спикер, 🍕 Снеки, a saved service, or «Новое служение» (name + icon, “speaker” switch) → pick the person.',
          'Speakers are listed right under the leader, one under another, then snacks, then the other services.',
          'New services are saved for the ministry; remove one with ✕ in that list.',
          'Marks: green ✓ confirmed, red ✗ can’t, yellow clock waiting. Bin button removes a person.',
        ],
      },
      {
        title: 'Change the colour and background of the people block',
        steps: [
          'Meeting → people block → «🎨 Вид блока людей».',
          'Card colour (or the ministry colour), background: the ministry’s or a photo. Can apply to the whole series.',
        ],
      },
      {
        title: 'Tell everyone about a meeting / its new time / cancellation',
        steps: [
          'Meeting → «Сообщить о встрече»: edit the text, poster on/off, who gets it, ask “Will you come?”.',
          'Moving the time offers a “time changed” message; cancelling offers a “cancelled” one.',
        ],
      },
      {
        title: 'Cancel a meeting',
        steps: ['Meeting → «Изменить» → «Отменить встречу» → confirm.'],
        note: 'A meeting with a saved roll call can’t be cancelled.',
      },
      {
        title: 'Take the roll call',
        steps: [
          'Opens an hour before the start: Overview → «Начать перекличку», or the meeting.',
          'Mark people, add guests, save. Editable for a few days afterwards.',
        ],
      },
      {
        title: 'Calendar notes',
        steps: [
          'Calendar → tap a day → add a note with a colour (leaders only). Tap it to edit or delete.',
        ],
      },
    ],
  },
  {
    key: 'events',
    icon: '🎉',
    title: 'Events',
    items: [
      {
        title: 'Add an event',
        steps: [
          '«Встречи» → events → «Новое событие» (or calendar day → create event).',
          'Title, date/time (end optional, can be days later), place, cover photo or designed cover.',
          'Optional: speakers (up to 4), countdown, burning outline, RSVP, duties, cost, gallery, chat.',
        ],
      },
      {
        title: 'Change or cancel / remove an event',
        steps: ['Open the event → edit (change anything) or cancel → confirm.'],
      },
      {
        title: 'Reminders and “LIVE now”',
        steps: [
          'Automatic reminder: «Ещё» → «Настройки служения» → «Автонапоминание о событиях»: off, 1 h, 3 h, 1–3 days before.',
          'Manual reminder: «Ещё» → «Напоминания о событиях», or the event → remind.',
          '“🔴 LIVE now” goes to everyone automatically when an event or meeting starts.',
        ],
        note: 'Reminders are OFF for a new ministry until you choose a time.',
      },
      {
        title: 'Duties (who serves where)',
        steps: [
          'Event → duties: add a duty, its description, leader and people; they get a bot message.',
        ],
      },
      {
        title: 'Pin an event on the main page',
        steps: ['Event → pin. It shows at the top of the main page for the whole church.'],
      },
    ],
  },
  {
    key: 'posts',
    icon: '📢',
    title: 'Posts & home page',
    items: [
      {
        title: 'Write / edit / delete a post',
        steps: [
          'Ministry home → «Пост». Photos, headline, blocks, type, look, who gets the notification.',
          'Post menu (⋯) → edit, pin, resend, delete.',
        ],
      },
      {
        title: 'Arrange the home tiles',
        steps: [
          'Hold a tile, then drag it to another place. Tap a tile to expand it, again to fold.',
          'Several meetings on one day share one tile; tap it to see them all.',
          'The calendar tile can be hidden (expand it → hide) and shown again from the calendar.',
        ],
      },
    ],
  },
  {
    key: 'money',
    icon: '💶',
    title: 'Money',
    items: [
      {
        title: 'Add income, expense or donation',
        steps: [
          '«Касса» → income / expense / donation → amount, category, person, receipt photo.',
          'Meeting expenses: meeting → «Добавить расход» (counts against its budget).',
        ],
      },
      {
        title: 'Remove (void) a transaction',
        steps: ['«Касса» → tap the transaction → void → confirm.'],
        note: 'Voided entries stay visible as crossed out, for honest accounting.',
      },
      {
        title: 'Reports (PDF / Excel)',
        steps: ['«Ещё» → «Отчёты» → period → attendance or treasury. The bot sends the file.'],
      },
    ],
  },
  {
    key: 'phone',
    icon: '📱',
    title: 'Phone & notifications',
    items: [
      {
        title: 'Add the app to the phone home screen',
        steps: [
          '«Ещё» → «Иконка на экране телефона» → «Добавить на экран».',
          'Needs a recent Telegram. The icon Telegram uses is the bot’s Mini App icon — set it in @BotFather → /mybots → bot → Bot Settings → Configure Mini App (upload the church photo).',
        ],
      },
      {
        title: 'Notifications on the phone',
        steps: [
          'Everything (reminders, LIVE, announcements, duties) comes as bot messages = normal Telegram push notifications.',
          'Each person must press Start in the bot once and not mute it.',
        ],
      },
      {
        title: 'Animation level',
        steps: ['«Ещё» → motion: off / calm / lively.'],
      },
    ],
  },
  {
    key: 'dev',
    icon: '🛠',
    title: 'Developer: project & deploy',
    items: [
      {
        title: 'Deploy',
        steps: [
          'Staging: every push to master deploys (migrations, Worker, secrets, webhook).',
          'Production: GitHub → Actions → Deploy → Run workflow → production.',
        ],
      },
      {
        title: 'Change the database',
        steps: [
          'Edit apps/worker/src/db/schema.ts.',
          'cd apps/worker && npx drizzle-kit generate --name <what_changed> (never hand-write migrations/meta).',
          'Data fixes may be appended to the generated .sql after a “--> statement-breakpoint”.',
        ],
      },
      {
        title: 'Add a text to the interface',
        steps: [
          'packages/shared/src/i18n/ru.ts is the reference; add the same key to en.ts and lt.ts (typecheck enforces it).',
          'Use it in the app as t.section.key.',
        ],
      },
      {
        title: 'Before pushing',
        steps: ['pnpm typecheck · pnpm lint · pnpm format:check · pnpm test · pnpm build'],
      },
      {
        title: 'Developer access',
        steps: [
          'Developers are church admins whose Telegram ID is in the ADMIN_TELEGRAM_IDS secret.',
          'They see «Телеметрия» and these «Инструкции» on the main screen.',
        ],
      },
    ],
  },
];
