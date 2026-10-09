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
        title: 'Order of positions and member lists',
        steps: [
          '«Должности»: the ↑ / ↓ arrows next to each position set its place (positions.sort, PUT /api/groups/:id/positions/order). The default position («Участник») and people without one are always listed last.',
          'Both member lists (leaders’ «Люди» and members’ «Участники», /contacts rows carry positionRank) go in that order, then by name; a «По должности / По имени» switch and position chips filter or re-sort them.',
        ],
      },
      {
        title: 'Members’ own attendance',
        steps: [
          'Hidden from plain members (no rights) by default: ministry settings → «Участники видят свою посещаемость» (groups.members_see_attendance). Rows of /me/attendance and the profile carry visible. Leaders always see it.',
        ],
      },
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
        title: 'Change the look of the people cards and chips, and role icons',
        steps: [
          'Meeting → people block → «🎨 Оформление».',
          'Style: dark, see-through (ministry background shows), one colour, or different tints per person. The chips on the main page follow it.',
          'Role icons: tap a role (leader, snacks, any service) → pick an icon.',
          'Background: the ministry’s or a photo, with or without the ministry’s icon pattern («Узор служения»). Can apply to the whole series.',
          'A meeting with its own poster colour wears it everywhere: its screen, the people block and its card on the main page.',
        ],
      },
      {
        title: 'Send “who serves” (every role and person)',
        steps: [
          'Meeting → people block → «📤 Кто служит» → to everyone at the meeting or only those who serve.',
          'The meeting announcement also lists who serves automatically.',
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
        title: 'Meeting reminders and the timer',
        steps: [
          'The bot reminds everyone the meeting is for 2 hours and 1 hour before it (with who serves).',
          'Change: «Ещё» → «Настройки служения» → «Напоминание о встречах» — tap the times you want (15 min … 1 day), or «Не напоминать».',
          'In the last 2 hours a ⏳ timer shows on the meeting and its card pulses slowly; at the start it turns LIVE.',
          'Animation for all meetings: «Настройки служения» → «Анимация встреч» (off / calm / lively). One meeting: «🎨 Постер» → «Анимация встреч».',
          'Animations: off, calm, lively, stars, waves, lights, rays, aurora, silk, colour flow, embers, bubbles, snow, lines, grid, grain. Add one: a name in MEETING_MOTIONS (shared api.ts) + meetings.motions in ru/en/lt, a layer in LivingLayer (components/ui.tsx) and its CSS (.living-… in index.css).',
          'The poster preview stays pinned at the top while you scroll its settings. In the Design tab the three previews (app, tile, poster) are a pinned carousel: swipe or tap their names.',
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
          'Past meeting: Calendar → its day → «Кто был?», or the meeting → «✅ Отметить, кто был». After saving the day shows ✓ and «👥 N + guests».',
          'Statistics: Calendar → «📊 Статистика», or the «Статистика» button on the ministry page (counts meetings with a roll call).',
        ],
      },
      {
        title: 'Past meetings and deleting',
        steps: [
          'Past meetings are never removed by the app: the calendar shows the last 12 months (grey days, ✓ when the roll call is taken).',
          'Delete one for good: the meeting → «🗑 Удалить встречу навсегда» → confirm twice (meetings rights). Its attendance goes; money stays in the treasury (DELETE /api/meetings/:id).',
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
          'That message is pinned at the top of each chat while it is on, and unpinned + deleted when it ends (checked every 5 min; worker: live_pins table, clearEndedLive in lib/outbox.ts). In group chats the bot must be an admin with “Pin messages”.',
          'In the app: on the main page the ministry card gets a LIVE badge and a pulsing red outline (nothing else is added there). In the 2 hours before, the card shows a red burning 🔥 button with a countdown that opens the meeting (GroupSummary.soon, SoonButton in screens/Hub.tsx); on the ministry page the meeting tile is tinted red (a red cell in a day tile).',
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
    key: 'design',
    icon: '🎨',
    title: 'Design (designer)',
    items: [
      {
        title: 'Make someone a designer',
        steps: [
          '«Люди» → «Должности» → a position (e.g. «Дизайнер») with the right «Дизайнер» → give it to the person.',
          'They get the «Дизайн» tab in the bottom bar of that ministry (church admins see it too).',
        ],
      },
      {
        title: 'Only the designer changes looks',
        steps: [
          '«Дизайн» tab → «Только дизайнеры меняют оформление» (church admins switch it).',
          'On: posters, covers, templates, colours, animation and the people block of meetings, events and posts can be changed only by designers (and admins). Others still edit text, times and people; their look controls are hidden or greyed out with 🔒.',
          'Off: organisers may change looks as before; designers may change looks even without other rights.',
          'Designer → approval → publish (lib/publishRequests.ts, table publish_requests, migration 0051): the `announce` right now means «Публиковать» — posts, meeting announcements and event reminders (besides meetings.manage / events.manage), and approving designers’ messages. `mayPublish` / `mayPrepare`; rows carry canPublish / canPrepare / publishRequest. Designers (and publishers) send a test to themselves (POST /api/meetings/:id/announce/test, /api/events/:id/remind/test: only to the caller, marked 🧪, no RSVP buttons, no in-app notification). A designer who can’t publish sends it for approval (…/announce/request, …/remind/request): a newer request replaces the older one; approvers (announce or manage rights, else church admins) get the poster + text with ✅ Send / ✗ Decline (`pq:s|d:<id>`) and an in-app notification; the same card shows on the meeting / event screen (PublishRequestCard, POST /api/publish-requests/:id/send|decline). The request is claimed before sending, so it goes out once; the designer hears the result. Designers without events.manage open the event form in look-only mode (cover, poster, effects, speakers). Position templates: Media (events + publish + design), Designer (design).',
          'Server: churchSettings.designLock, designRights / assertMayDesign / lookDiffers in worker lib/access.ts; checked in the meeting, event and post PATCH routes (only values that actually change count).',
        ],
      },
      {
        title: 'Templates with animation',
        steps: [
          '«Дизайн» → «Новый шаблон»: name, colour, pattern or photo, text colour and the meeting animation (stars, waves, …).',
          'Live previews: the meeting screen, the small home tile and the poster.',
          'Tap a template to change or delete it (its maker or an admin). Meetings and events using it change with it.',
          'A meeting’s animation: its own → its template’s → the ministry’s.',
        ],
      },
      {
        title: 'Screen studio (tap a part to style it)',
        steps: [
          '«Дизайн» → «Студия экранов»: a live copy of the ministry page (or, for church admins, the church main page). Tap any outlined part: header, quick buttons, calendar, meetings, posts, bottom bar (main page: header, ministry cards, profile and menu).',
          'Each part: surface (as in the app, glass, liquid glass, ministry colour, own gradient of 2–5 colours with direction and flowing, colour flow, dark, burning), edge (liquid, metal, gold, neon, rainbow, fire, glass), a picture inside with opacity (ministries), a font, an animation plus up to 2 animation layers, and tuning: speed, size, direction, colour; the icon animations show the logo, an emoji or an uploaded picture.',
          'Pictures inside a part: drag the preview to pick the visible spot, zoom 0.5–3×, fill or whole, opacity, and split (left/right/top/bottom) with a second picture in the other half. Text size per part (70–130 %) so long names fit. Shine: soft, glint, holographic, sparkles. Tap a chosen option again to remove it.',
          'Themes (one tap for the whole page): autumn leaves, winter snowfall, Christmas, Easter, night, summer, clean. Corner shape per part (square … round). Quick buttons: icon size, roundness and fill. Background: «Этот фон — для всего приложения» (admins) puts it on the main page and every ministry. Animations include flames (the «Горящая» surface burns too), falling leaves, snowfall and petals.',
          "Performance: animations pause when off screen and only a few animation layers run at once (6, lite 3); keyframes avoid CSS variables and moving backgrounds so the graphics chip does the work — flowing colours fade between the gradient's two ends, shines slide a strip, outline flickers use steps() (see lib/perf.ts and CLAUDE.md).",
          'Crash guard: every screen is wrapped in CrashGuard (components/CrashGuard.tsx) — a crash shows «Этот экран сломался» with Back / Reload instead of a white screen, and the error (message, stack, screen, phone) goes to POST /api/dev/client-error (table client_errors, latest 200 kept) and shows in Telemetry → «Ошибки в приложении». Errors outside React (window error / unhandledrejection) are reported too.',
          'Never an empty screen: the whole app is wrapped in a second CrashGuard («Приложение не открылось» + Reload, in the phone’s language), and index.html shows a plain note with Reload when the script hasn’t started after 12 s (cut-off download, too old a phone) with the first error. Safe start (lib/perf.ts, church.booting): a start that didn’t settle (shown 8 s, hidden or closed normally) means the app closed itself — the next start runs Still once, with a notice.',
          'Try the app as another role: /testas in the bot (developers only; listed in their own chat menu) or «Открыть как другая роль» on the main page / Ещё. Pick a ministry position, a member without one, a member waiting for approval, a newcomer or a church admin. The developer gets one test person with their own name, username and photo (users.test_of; the developer’s users.test_as points at it while testing, lib/testing.ts): a real member with exactly that place, so every screen and right check is genuine. The API swaps the user in the auth middleware (realUser stays the developer; the test person borrows the developer’s Telegram id, so «send to me» still arrives); the bot always stays the developer. An amber bar on top shows the role with «Сменить» / «Выйти»; leaving takes the test person out of its ministries. The bot’s /privacy command was removed (the notice says to write to a church admin).',
          'Poster templates («Дизайн» → «Постеры», components/PosterStudio.tsx): a background (colour, gradient, own photo with dimming, or the event’s cover) and up to 20 layers (MAX_POSTER_LAYERS), front last — pictures (PNG/WebP keep transparency: prepareCutout in lib/image.ts never fills white), texts filled from the event or meeting (title, date, time, place, topic or own words; font, colour, weight, align, capitals) and effect layers (any animation with its settings) placed anywhere in the stack. Each layer: position x/y (% of the box), size (% of the smaller side), rotation, opacity, blend mode (BLEND_MODES) and layer styles (shadow, outer glow, stroke, bevel). Preview: «Событие» / «Встреча» and the real shapes with made-up details around them (Mockup in PosterStudio.tsx) — poster 4:5, home tile 16:10, screen 4:3 (poster above the hero card) and, for events, the pinned card; one set of relative positions fits them all (container units, `.layered-poster`).',
          'Picture layers: a plain photo is added with fit «cover» (fills the poster like a background, so it lines up in every shape; x/y pick the part in view, size zooms 100–300 %), a cut-out (has see-through pixels, detected by prepareCutout) as a free sticker. `ratio` (width ÷ height) gives the picture box its exact shape. Effects on the picture itself (`effects`, up to 4, tap again to remove): drawn in that box over the picture (photo effects change copies of it), and on a cut-out masked by its own transparency (mask-image, embedded by html-to-image in the bot poster too).',
          'Effect layers: tapping the chosen effect again takes it off (kind «off», the layer stays empty until another is picked).',
          'Poster layers, more: colour layers (`type: fill` — one colour, a gradient or one from the centre, up to 4 colours, own width/height in % of the poster; a gradient can move: flows / turns / breathes with a speed, FillMotion in LayeredPoster.tsx, `.fill-flow/.fill-spin/.fill-pulse` keyframes; the still paint stays under it for the bot picture). Pictures and colour layers have a shape (rectangle / rounded / circle / oval) and soft edges (`shape`, `soft`; edgeLook + SoftY — a soft rectangle is two single masks one inside the other, as mask-composite is lost in poster pictures; `data-edge` / `data-soft` let the recorder draw the same mask itself). Texts can wear effects of their own (`effects`, up to 8): inside the letters (LetterEffects: the lines are broken by our code and the letters drawn once as a PNG mask) or in a soft cloud around the words (`fxIn: around`). Effect layers can fade towards the poster edges (`fade`). A frame on top of everything (`frame` column, migration 0056: thickness, colour, distance from the edge, rounded corners, glow, double line). Every layer’s effects panel has the saved effect sets. Outlines of cut-outs use 8 hard shadows (smooth round curves).',
          'Background removal (lib/cutout.ts): «✂️ Фото без фона» when adding a layer, or «✂️ Вырезать людей в отдельный слой» on a picture layer. Google MediaPipe ImageSegmenter, model selfie_multiclass_256x256 (free, Apache 2.0), runs on the phone (CPU, ~2 s; the photo is not sent anywhere). Engine files (WebAssembly) are copied from @mediapipe/tasks-vision into dist/mediapipe at build (vite.config.ts); the 16 MB model is relayed by GET /media/model/selfie-multiclass (Google’s bucket sends no CORS header; cached a month at the edge and on the phone). Background confidence → alpha with a smoothstep edge; the cut-out has the photo’s size and the original layer’s placement, inserted right above it as its own layer (cutout: true), so the photo stays below as the background. Made for people.',
          'Recording posters (lib/recorder.ts): the still parts are drawn in bands in their real order — below the first effect, between effects, above the last — so a still layer between two moving ones stays there; a band is drawn with everything else hidden and the boxes holding it bare (no background/shadow/::before), not hidden (Chrome drops the mask of a hidden box). Each effect is cut to the masks of the boxes around it (cut-out outline, letters, soft edges: masksOf/drawMask/drawEdge) before going on the frame.',
          'Using a poster: shared/posterTemplates.ts (zod), table poster_templates (migration 0046), API /api/poster-templates (designers; deleting one clears it from events and meetings), `posterTemplateId` on events and meetings (EVENT_LOOK / MEETING_LOOK, so designLock applies). Pick it in the event form («Постер из шаблона») or in Design → restyle (PosterPicker); rows carry `poster` and LayeredPoster draws it on the event cover, event and meeting screens, home tiles, the pinned card and the bot poster picture (capturePoster takes a still frame). Layers render live; baking the still layers into one picture is a possible later optimisation.',
          'Default look of meetings: Design → Шаблоны → «Оформление всех встреч» sets groups.meeting_template_id (PUT /api/groups/:id/studio {meetingTemplateId}). A meeting with no template and no own design wears it (resolved when reading rows in toMeetingRows: its look, animation, tile and poster animation); meetings restyled one by one keep their own. Deleting the template clears the default.',
          'Meeting tile animation: drawn in LookTop `under` (over the look’s photo and pattern). Drawn `behind` (z-index −1) it was hidden under any meeting look with a photo — that is why meetings seemed to have no animation.',
          'Profile photos: users.photo_media_id, set on the person’s screen (📷 on the avatar; PUT /api/users/:id/photo — the person or whoever manages them; the picture must be an upload of a ministry they are in). Shown in People (MemberRow.photoUrl), person pickers, meeting cards and posters.',
          'Speakers from people: SpeakersEditor «Из участников» picks a member (speaker.userId); without an own photo the server signs their profile photo (speakersOf). Generated meeting posters use own speakers → people marked as speakers → the leader (posterSpeakers); speakers without a photo get a warning (PosterPhotoWarning) under the poster previews and in the speaker editor — the poster still goes, with initials.',
          'Speaker photos on posters: design.speakerLook {place inline/top/bottom/right, edge white/none/brand/gold/glow/shadow, shape circle/rounded/square, size s/m/l, opacity 0.2–1}, set under «Фото спикеров на постере» in the meeting poster designer and the event form; drawn by SpeakerStrip (a column on the right shrinks to fit) in MeetingPoster and PosterMedia.',
          'Speaker photos v2 (design.speakerLook, also on design templates as speaker_look; rows carry the resolved `speakerLook`: own → template): style photo (separate photos) / side (one big photo filling a side, fading into the background) / background (behind everything); place «with the text» or one of nine spots (x left/centre/right × y top/centre/bottom — for side/background x is the side, y the part of the photo in view; speakerSpot() also reads the old top/bottom/right); shapes circle/rounded/square/portrait; sizes s–xl; edge; opacity; onCards (default on): CardSpeaker draws the leading speaker’s profile photo on the meeting tile, the «Ближайшая встреча» panel and the meeting screen hero (HeroCard `under`).',
          'Animation settings per meeting: meetings.motion_tunes and design_templates.motion_tunes ({kind: MotionTune}); rows carry `motionTunes` (template’s with the meeting’s own over them) and `ownMotionTunes`. Edited with MotionTargets (components/MotionTargets.tsx: screen / tile / poster + the picked animation’s settings) in the template sheet, the Design restyle sheet and the meeting’s own poster designer («Анимации встречи»). Used by the meeting hero, home tiles, the expanded panel and the poster.',
          'Panel pictures follow the panel’s corner shape: SkinLayer puts the part’s pictures in `.part-clip` (clip-path round var(--clip-r) + border-radius inherit + the iPhone mask trick); shines are clipped the same way.',
          'Bot poster pictures (lib/poster.ts capturePoster): waits for the pictures to decode, draws once to warm up (iPhones miss pictures on the first drawing), leaves the moving effects out (`.capturing .living-clip`, blending effects came out as black patches) and refuses a blank / mostly-black result — then nothing is saved and the bot sends the cover photo instead. An event saved again gets a new picture. Photos are drawn by our own code, not the drawing library (iPhones leave big photos out of it): elements marked `data-shot="under"` (ministry photo with its tint and fade, speaker side/background photo, collage, cover photo cells) are drawn between a pass of everything below them and a see-through pass of everything above; `data-shot="top"` pictures (speaker photos, logo) are drawn last with their rounded corners. Mark any new poster photo the same way.',
          'Design tab weight: list previews (templates, posters, the poster picker) are still frames (`.motion-still` pauses their animations); the studio’s copy of the page is still until «Показать анимации». «↻ Обновить приложение» at the bottom of Design and in More reloads the app.',
          'Where speaker photos are set: Design → «🎤 Фото спикеров на встречах» (groups.speaker_look, PUT /api/groups/:id/studio {speakerLook}) for all the ministry’s meetings; a design template’s own (Шаблоны → template → «Фото спикеров на постере»); a single meeting’s (meeting → «Постер»). Resolved own → template → ministry in toMeetingRows. On the poster the spots follow its lines: top-right lines up with the logo row, bottom with the title’s last line, a side column hugs the 40px margin (SpeakerStrip `side`).',
          'Bot picture of an event (eventPictureId in lib/eventRoster.ts): with a cover photo, the photo itself; the phone-drawn poster only without a photo or with a poster template — a drawn poster could come out black on iPhones.',
          'Running cap (lib/perf.ts rebalance): of the animation layers in view, the biggest run (6, lite 3) — by on-screen size, not by arrival. By arrival, the header, quick buttons and an event’s several cover effects used up the budget and the meeting panel and tiles stood still.',
          'Design precedence (one rule): own → template → ministry default → app default. A meeting leaves the ministry’s default template only with its own look (design.custom); own fonts / sizes / speaker photos don’t. A form sending the default template back stores none (api/meetings.ts), so meetings keep following the default. Speaker looks and animation settings are merged field by field (mergeLooks / mergeTunes in lib/meetings.ts) and forms store only the changed fields (SpeakerLookControls `base`, MotionTargets diff).',
          'One place per meeting: «🎨 Оформление» (components/MeetingDesignSheet.tsx) — opened from the meeting hero, its «Изменить» form and Design’s meeting list. It shows «Откуда оформление» (look / animations / speaker photos / layered poster: as for all meetings, own, or a chosen template) with ↺ «Вернуть» per part, the layered-poster picker, look & poster, speakers, speaker photos, animations with settings, and the people cards (PeopleLookEditor). Rows carry `ownTemplateId` (the meeting’s own choice); «Как для всех встреч («…»)» in CoverLookControls follows the ministry default (`followTemplateId`).',
          'Events follow the same rule: groups.event_template_id («Оформление всех событий» in Design → Шаблоны), resolved in lib/events.ts (own look leaves it; the form’s «Как для всех событий» stores none); event speaker looks merge ministry → template → own. Edit conflicts: meetings.look_version / events.look_version go up with every look change; the 🎨 sheet and the event form send the version they opened with and get 409 «look_changed» (a notice, nothing overwritten) if someone changed the look meanwhile. «Применить к серии» copies only the fields that save really changed. A one-tap Studio theme can be undone («↺ Отменить тему»).',
          'Cover slideshow: events.cover_slides JSON {mediaIds (up to 9), seconds 2–20}; the cover photo first, then these in turn, each fading in and settling from 114% to its size (CoverPicture / useSlide in components/CoverSlideshow.tsx), the cover effects stay on top (the glitch tears whichever photo shows). Set in the event form, «Слайд-шоу обложки».',
          'Colour and processing effects (group «Цвет и обработка»): vignette, duotone (the ministry colours / animation colour), photo filter, cross processing, HDR, halftone, lens flare, grunge, lens blur (tilt-shift), motion blur (SVG sideways blur). With the cover photo they change copies of the photo (CSS filters / blend modes) and are drawn once — they cost nothing per frame.',
          'Pinned events on the church main page are a studio part of their own (`pinned` in CHURCH_MODULES; Design → Главная церкви → «Закреплённые события»): its animations + layers (with settings), edge, shine and corner radius apply to every pinned card (PinnedEventCard in Hub.tsx); with animations set there they replace each event’s own cover effects, without them each event keeps its own.',
          'Photo effects (group «Фотоэффекты», components/PhotoEffects.tsx): smoke and clouds, ice on the screen, cracks, light leaks, 35 mm film, RGB split, oil painting, gloss, inflated foil. Textures are SVG noise / lighting filters drawn once as pictures (data URIs — write # in them, encodeURIComponent turns it into %23) and then only moved or faded; with a cover photo, RGB split and oil painting change the photo itself.',
          'Burning outline styles: Огонь, Свечение, Пульс, Орбита, and new Неон (flickering tube), Искры (sparks flying off the edges), Электричество (lightning arcs flashing along the edges), Блеск (a glint running round). Gradient and rainbow colours and the new styles are drawn as a ring + glow (`.burn-ring`, burnPaint in Burn.tsx, extras in BurnFx); each style moves them its own way, in steps or by transform/opacity.',
          'Burning outline colours: any colour (colour picker), «Радуга» (rainbow, slowly turning) or «Градиент» of two colours — design.burnColor = #hex | rainbow | grad:#a,#b; drawn by burnPaint (Burn.tsx) as a ring plus glow (.burn-multi).',
          'Performance: decorative animations longer than 1.2 s run on a 30-a-second beat (24 on lite) — lib/perf.ts capAnimations sets steps() easing on each animation; the page background moves 4 times a second (glass above it re-blurs only then); glass cards with an animation inside skip the blur; lite glass has no blur; the fire and burn outlines flicker in steps. Pinned events on the main page show their cover effects.',
          'Event cover effects combine: up to 8 (MAX_EFFECTS in shared/motions.ts; the first in `events.motion` + `motion_tune`, the rest in `motion_layers` JSON [{kind, tune}], migration 0043), picked in a fold-away block (CoverEffects: one line with what is on and «Изменить»; opened, tap animations on/off, each picked one’s settings under it, «Готово — скрыть эффекты»). While it is open the cover photo preview sticks to the top. Drawn by CoverEffectLayers on the cover everywhere, the event screen’s big photo included.',
          "Event cover animation: `events.motion` + `events.motion_tune` (migration 0042), picked in the event form (section «Анимация обложки», when there is a cover photo or a designed cover) and in Design → restyle an event; drawn by EventCover everywhere (event screen, home tile, list). New animations in shared/motions.ts (the animation list lives there so events can use it): Retro and digital — glitch (strips of the cover picture tear sideways, red/cyan copies jump, scanlines; without a picture strips of light), crt (scanlines, rolling bar, dark corners), static (TV snow), matrix (digital rain); Stage and party — spotlight (sweeping beams), disco (turning mirror-ball dots), sparkle, hearts. Picker previews aren't held back by the running cap on full quality (`preview`).",
          'Animation settings: tapping an animation in the Design studio opens its own settings under it (MotionTuneControls): speed, size, strength, angle (arrows or any degree), colour, plus per-kind knobs from MOTION_KNOBS — density (amount / distance between lines / square size / flame tongues), weight (thickness / particle size / flame height), sharp (flame edges / glow clarity). Each animation of a part keeps its own settings in `ModuleLook.tunes` (layers too; `tuneFor` falls back to the old shared `tune`). Shines have strength, speed and slant (`shineTune`). Flames are pointed masked tongues in two rows, bent by noise and cut sharp by an SVG blur + alpha threshold.',
          'Separate animations for the meeting screen, the home tile and the poster: templates (`tile_motion`, `poster_motion`) and each meeting (own values; `MeetingRow.tileMotion` / `posterMotion` resolved meeting → template). In the template and restyle sheets the animation picker follows the preview carousel (В приложении / Плитка / Постер); the poster designer has its own picker. The sent poster picture keeps one still frame.',
          'Saved effect sets (components/EffectSets.tsx, table effect_templates, migration 0055, /api/effect-templates): at the top of every effects picker — event cover, post, free poster, poster picture layer — tap a set to put its effects with their settings on, or «💾 Сохранить как набор» to keep the current ones under a name. Shared church-wide; open to designers and those who manage events or meetings; the maker or a church admin deletes one (✕). Same effect twice in a set becomes a copy with its own settings.',
          'Particle animations (embers, bubbles, snow, fireflies, confetti, sparkle, hearts, leaves, snowfall, petals, icon float/rain/orbit) are drawn on a canvas (components/ParticleCanvas.tsx), not as moving elements: all the particle effects of one block share one canvas (`LivingLayers` splits a block’s animations; used by cover effects, Studio parts, pinned events and poster pictures), each particle is drawn once into a small picture and then only moved, one shared clock draws at 24 frames a second (20 on Light), nothing is drawn off screen, and Still / reduce-motion show one still frame. Paths and timings copy the CSS ones (particleData.ts). On the test page: 59 instead of 51 frames a second, style work 113 → 33 ms/s, 228 moving elements → 0.',
          'While a sheet is open (html[data-sheet], set by Sheet) the page behind it stands still and drops its animation layers; long lists of live previews (the animation picker) draw only the tiles near the screen (`useNearScreen` in lib/perf.ts); particle canvases inside a `.motion-still` copy (the studio copy until «Показать анимации») draw one frame. Before this, opening a studio part on an iPhone held ~80 animation layers and Telegram showed a blank page.',
          'Moving posters (lib/recorder.ts, components/MotionExport.tsx): «🎬 Анимированный постер» in the meeting announce sheet and the event’s «Афиша и списки» records a 6-second seamless loop and the bot sends it to the person (POST /api/me/animation: MP4 or GIF, both sent with sendAnimation so they play in the chat, with a caption: the announcement text for a meeting, title / dates / place for an event). The event’s moving poster always says what, when and where (a photo cover gets them over it; a designed cover or poster template gets a band under it). Quality picker (MotionExport `QUALITY`): Стандарт = video 720p / GIF 540 px; Высокое = 1080p / 640 px; Максимум = 1080p with more detail / GIF 720 px (GIFs over 9 MB are recorded again narrower). GIFs use ordered dithering so gradients don’t stripe; the video is sharper. The event’s moving poster uses the event screen’s own cover shape (4:3) and name block (`EventHeroText`), so both line up. Generated textures (smoke, frost, grain, static, grunge…: SVG noise pictures, which the drawing library turns black) are converted once into ordinary pictures at their own size before recording, and the cover photo that some effects draw themselves (glitch, RGB split, duotone, tilt-shift, oil…) into a small embedded JPEG — iPhones leave big photos out of the drawing (`preparePictures`); each layer is drawn once and thrown away before the real frames; every animation kind was checked to record and move. The recorder works in layers: below the effects (background, photos drawn by our own code) and above them (texts, speaker photos, logo) are drawn once; each `.living-clip` effect is paused and stepped through time (CSS animations by `currentTime`, particle canvases by `seekParticles`) and mixed in with its blend mode; the last 0.75 s fades into the start. MP4 = WebCodecs H.264 + mp4-muxer, fed frames the way that comes back right on this phone: `pickFeed` encodes a red/green/blue/white test picture as I420, NV12, RGBA or the canvas, decodes it on the phone and keeps the first with the right colours (none = a GIF instead); the file’s colour label is BT.709 unless the encoder reports a real one (an iPhone video came out blue-grey and blurred while the GIF of the same frames was right) (720 px wide, 20 fps, ~0.5–1.5 MB); a phone without H.264 gets a GIF (gifenc, 400 px, 10 fps). `FullMotion` (lib/perf.ts) draws a recorded copy’s effects in full whatever the phone’s graphics setting; motion «off» is lifted while recording.',
          'Video animation of a part (Design studio → a part → «🎬 Видео-анимация»; header, calendar, posts, bottom bar, church menu — `BAKE_PARTS`, parts with one block a screen): the part’s surface, picture, animations and shine are recorded once (lib/recorder.ts, sample block of `BAKE_SIZE`) as a 6-second MP4 loop, uploaded (POST /api/groups/:id/loops or /api/church/loops, ≤ 1.2 MB, stored like pictures) and saved as `baked` {mediaId, key, w, h} on the part’s look. `bakeKey(look)` fingerprints what the loop shows; `freshLoop` uses it only while it matches, so any change brings the live effects back until it is recorded again. SkinLayer then plays one muted inline <video> (LoopVideo: plays only on screen, pauses under sheets, first frame on Still / motion off) from the public /media/v/:id (videos only, byte ranges for iPhones). Texts, buttons, edges and corners stay live.',
          'Announcements with a moving poster: the switch «🎬 Отправить постер с анимацией» in the meeting announce sheet records the poster’s loop (quality 0.09 to stay under 1.2 MB), stores it like a picture (POST /api/groups/:id/loops) and sends it as the poster; the outbox sends any stored MP4 queued as `photo_media_id` with sendAnimation (lib/outbox.ts `resolvePhoto`, lib/media.ts `mediaUpload`), so tests, approval requests and announcements all play like a GIF. Without effects or without H.264 on the phone the still picture goes.',
          'Video cover of an event (event → «Афиша и списки» → «🎬 Видео-обложка», for those who may design it): a single cover photo with effects (no slideshow, no poster template) is recorded as a loop (POST /api/events/:id/cover-loop, DELETE to remove; `events.cover_loop` {mediaId, key}, migration 0052). The server fingerprints the photo and effects (`coverLoopKey`); rows carry `coverLoop` only while it matches, and CoverPicture then plays the video over the photo instead of the live effects (event cards, the pinned card — unless the studio’s pinned animations replace the effects —, the event screen). Titles stay live text. Event reminders and approval requests send the moving cover (`eventMovingId` in lib/eventRoster.ts) when one is current, else the still picture.',
          'Labels and positions: the fill drifts (gradient, rainbow, metal), the chosen movement runs alongside, and patterns (stripes, dots, checks, waves, grain) slide one tile per loop on an oversized layer (transform only). All of it stops on «Спокойно», «Без анимации» and Still graphics.',
          'Effect colours: the colour setting reaches smoke, frost and cracks (their SVG textures are made in that colour), and stars, waves, bokeh, bubbles, lines, grid, lens flare, vignette, halftone and gloss (CSS `var(--p-color)` through color-mix). Photo filters (HDR, blurs…) have no colour. Event cover effects can repeat: «＋ Дым» under the effects adds a copy with its own settings, turned round 180° (smoke from the other side); copies are stored as further `motionLayers` of the same kind (up to 4 layers in all).',
          'Graphics on this phone (More and the Design tab): Auto / Full / Light / Still, saved per phone (church.quality). Light = half the particles (a third in small blocks), no flowing colours, edges, shine or flicker, pauses while scrolling; Still = designs stay, nothing moves (animation layers not drawn). Auto starts in Light on weak phones and steps down by itself when frames drop below 40 per second, with a one-time notice.',
          'Noise textures (smoke, frost, film grain, oil canvas, foil, grunge) are SVG noise filters drawn once into a PNG (lib/texture.ts, useTexture) and shared: iPhones redo SVG filters on every moving layer and could run out of memory with several on one page.',
          'Moving posters: event cover photos (CoverPicture) are marked data-shot="under", so recordings and poster pictures draw them with our own code — iPhones often left the big photo out of the drawing library’s picture, and a recorded cover came out as effects over black (seen in the uploaded video: aurora + scanlines, no photo). Every canvas a recording makes is freed at once (freeCanvas in lib/poster.ts) — iPhones keep dropped canvases and a second recording got empty ones (no photo). GIF quality: 540 / 640 / 720 px; a GIF over 9 MB is recorded again narrower, because Telegram sends bigger GIFs as a file instead of playing them (MotionExport, GIF_MAX_BYTES). The video (up to 1080p) has no such problem.',
          'Animated poster to others: the text under it is editable, and those who may publish there (canPublish) pick «Кому»: Мне / Выбранным (members of the ministry) / Всему служению / Всей церкви (church admins) / Тем, кто служит (event duties; meeting leader, speakers, snacks, helpers — lib/posterSend.ts). POST /api/me/animation?to=…&kind=event|meeting&id=…&users=…: the bot sends it to the sender first, then the same Telegram file_id to the others through the outbox (no second upload), with an in-app notification and an audit entry.',
          'Poster composer (components/PosterText.tsx, LivePreview in MotionExport.tsx): the poster is shown live, at most about a third of the screen tall and pinned at the top of its section while the settings scroll (as in every design screen: studio parts, posters, meeting design, event/post editors, speaker photos) (moving, as it will be recorded — the recording is made from that very copy, laid out at 400 px / 540 px for meetings and shrunk to fit). Text on it: the design’s own (designed posters), own words (prepared what / when / where, editable; first line big; font from FONTS, size, top / middle / bottom) or none — a clean loop. Meetings draw a bare poster (`MeetingPoster bare`) under own words or none. Used in the event’s «Афиша и списки», the meeting announcement (applies to the still picture too) and event reminders.',
          'Design tab: folding sections (components/Fold.tsx; open state per phone, church.fold.*; closed sections aren’t drawn): 🎬 Animated poster, 🖼 Screen studio, 🪧 Posters, 🎨 Templates, 🎤 Speaker photos, 📅 Upcoming items, ⚙️ Settings (design lock, graphics, reload). Animated poster without an event (components/FreePoster.tsx): ministry colours, a phone photo (kept on the phone, made ≤1600 px) or a poster template; shape 4:3 / 1:1 / 4:5 / 9:16; the cover effects picker (several, copies, settings); own words or none; recorded and sent to one’s own chat to forward. Where a poster has no animation yet, designers get «🎨 Добавить анимацию» (NoMotionPrompt).',
          'Animated posts: a post’s cover can wear moving effects like an event’s (post editor → «Анимация обложки»; stored in design.effects: motion, motionTune, motionLayers; drawn by PosterMedia over photos or colours). Publishing with the bot message: picture «Постер» or «🎬 Анимированный постер» (recorded on the phone, lib/movingPoster.ts, posterMediaId is then a video and the bot sends it as an animation). Rows carry posterMoving (the poster plays from /media/v/:id in the re-send sheet). The editor also has the animated poster (live preview, text on it or none) to send to oneself.',
          'Pictures with reminders and announcements: none / poster / 🎬 animated poster (previewed). The animated one is recorded on the phone (lib/movingPoster.ts: video ≤ LOOP_MAX_BYTES, made narrower if too big), stored via /api/groups/:id/loops (designers, settings, announce, meetings.manage, events.manage) and sent as `posterMediaId` (remindEventSchema / announceMeetingSchema) — test, approval request and send all carry it.',
          'Meetings part: the meetings’ animation (meeting screen and tiles); switch «У плитки своя анимация» to give the tiles a different one.',
          'Above the copy: «Фон экрана» (page background) and «Анимация входа» (how the ministry page appears).',
          'All animation settings live here now; ministry settings and the poster sheet point to Design. Each person can still turn motion down or off for themselves in «Ещё».',
          'Developers: data in groups.screen_look / church_settings.screen_look (ScreenLook in shared/screenLook.ts), saved by PUT /api/groups/:id/studio (designer or settings) and PUT /api/church/studio (admins). Parts read it with useModuleLook + skinClass/skinStyle/SkinLayer (components/ModuleSkin.tsx); CSS .skin-*, .edge-*, .living-*.',
          'New animation: add it to MEETING_MOTIONS and MOTION_GROUPS (shared api.ts), meetings.motions in ru/en/lt, a layer in LivingLayer (components/ui.tsx) and its .living-… CSS.',
        ],
      },
      {
        title: 'Restyle a meeting or event',
        steps: [
          '«Дизайн» → a meeting or event in the list → choose the ministry look or a template → Save.',
          '«Открыть полный редактор» opens it for the full poster designer; posts open the post editor.',
        ],
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
        title: 'Set the current balance (cash count)',
        steps: [
          '«Касса» → on the balance card «✎ Указать текущий баланс» → type what is really there now.',
          'The difference is saved as one entry «Корректировка баланса» (income or expense), so the history still adds up.',
        ],
      },
      {
        title: 'Delete ALL treasury data of a ministry (church admins)',
        steps: [
          '«Касса» → bottom of the screen «🗑 Удалить все данные кассы» → type the ministry’s name → confirm.',
          'Every entry is deleted for good and the balance becomes 0. Download a report first if you need the history.',
        ],
      },
      {
        title: 'Remove (void) a transaction',
        steps: ['«Касса» → tap the transaction → void → confirm.'],
        note: 'Voided entries stay visible as crossed out, for honest accounting.',
      },
      {
        title: 'Reports (PDF / Excel)',
        steps: [
          '«Ещё» → «Отчёты» → period → attendance or treasury. The bot sends the file.',
          'The treasury PDF has a coloured summary, a month-by-month chart and coloured bars for income, expenses and donors.',
          'Charts in the app: «Касса» → «Статистика» — balance over the year and income/expenses per month.',
        ],
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
          'Android: Telegram asks “Add to Home screen?” → «Добавить». No window: in the app ⋯ (top right) → “Add to Home Screen”.',
          'iPhone: Safari opens → Share (square with arrow) → “Add to Home Screen” → «Добавить».',
          'The card shows these steps for the person’s own phone, and a message when it worked or failed.',
          'Needs a recent Telegram.',
          'Icon: «Настройки церкви» → «Фото бота и иконка на экране телефона» → use the church logo or choose a photo. Icons already added may update later.',
        ],
      },
      {
        title: 'Notifications on the phone',
        steps: [
          'Everything (reminders, LIVE, announcements, duties) comes as bot messages = normal Telegram push notifications.',
          'Each person must press Start in the bot once and not mute it.',
          'A shortcut on the home screen can’t show a number badge (Telegram doesn’t allow it); the unread count shows on the Telegram app icon.',
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
