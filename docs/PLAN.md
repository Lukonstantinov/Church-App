# Church Youth Telegram App: Implementation Plan

A Telegram bot and Mini App for a church's youth groups. Leaders use it for roll-call attendance, the group treasury, donations and pastoral follow-up of inactive members. It is hosted entirely on free tiers and stays available all day, every day.

---

## 0. Decisions

| Topic | Decision | Consequence |
|---|---|---|
| Scope | **One church, several groups** | Every group-owned table has `group_id`. Admins are church-wide; leaders and members are per group. One person can belong to several groups. |
| Attendance | **Leader roll call only** | No self check-in or codes. The leader taps names; members only see their own history. |
| Finance | **Group cash flow + voluntary donations** | No dues and nothing owed, so no "Paid / Due" badges and no `/pay @user`. A treasury ledger per group, with optional donor attribution. |
| Hosting | **Cloudflare only** (Workers, Static Assets, D1, Cron Triggers) | One account, one deploy, same origin for app and API, no sleeping, no keep-alive pinging. |
| Language | **Russian only** | All interface text lives in one `ru` dictionary, so another language can be added later without refactoring. |
| Reminders | **Leader approves each** | The system flags inactive members and a leader decides whether to send a message, message the member personally, snooze or dismiss. |
| Offline members | **Supported** | Leaders can add people without Telegram. They can link Telegram later with a claim code. |
| Exports | **Excel + PDF in the reports phase** | Files are built in the Mini App and sent into the Telegram chat by the bot. |
| Jurisdiction | **EU / Baltics, so GDPR** | Religious data is a special category and children's data needs extra care (see §13). |

Defaults for questions still open are in §20.

---

## 1. Goals and non-goals

**Goals**
- A leader records attendance for 30 people in under a minute on a phone.
- Treasury is transparent: every entry records who entered it and when, and entries are reversed rather than silently deleted.
- Inactive members get noticed and receive a personal check-in from a person rather than a bot.
- Hosting costs €0 a month and the app never sleeps.
- One volunteer can maintain it: one repo, one cloud account, automated deploys.

**Non-goals (for now)**
- Processing real payments. The app only records cash, bank transfers and donations.
- More than one church.
- Features that would break without Telegram, such as SMS or email. Offline members exist only as records kept by leaders.

---

## 2. Architecture

```
            ┌──────────────── Telegram ────────────────┐
            │  Bot API servers        Mini App WebView  │
            └────┬───────────────▲──────────┬──────────┘
     webhook POST│  sendMessage/ │          │ HTTPS (static files + /api)
  (secret header)│  sendDocument │          │ Authorization: tma <initData>
                 ▼               │          ▼
        ┌───────────────── Cloudflare Worker (one deploy) ─────────────────┐
        │  Hono router                                                     │
        │   ├─ POST /bot/webhook   → grammY bot (commands, callbacks)      │
        │   ├─ /api/*              → REST API (zod-validated, role checks) │
        │   ├─ GET /health                                                 │
        │   └─ static assets       → React Mini App (Vite build)           │
        │  scheduled() handler     → Cron Triggers (outbox, hourly tick)   │
        └───────────────────────────────┬──────────────────────────────────┘
                                        │ binding
                                   ┌────▼────┐
                                   │   D1    │  SQLite, EU location hint
                                   └─────────┘
  GitHub Actions: CI (typecheck/lint/test) → deploy staging → manual deploy prod
                  weekly backup: wrangler d1 export → Telegram sendDocument to admins
```

**Why this layout**
- **Same origin:** the Mini App and API are served by the same Worker, so no CORS setup and one URL to register in BotFather.
- **Webhook, not long polling:** there's no process to keep alive. Telegram pushes each update to the Worker.
- **Heavy work runs on the phone:** Excel and PDF files and charts are built in the Mini App. The Worker only relays the file to Telegram, which keeps it within the 10 ms CPU limit.
- **Outbox for bulk messages:** mass sends are queued in D1 and drained in batches by cron. This respects the limit of 50 external requests per run and Telegram's rate limits.

**Stack**

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Worker | Hono, grammY (`webhookCallback(bot, "cloudflare-mod")`), Drizzle ORM (D1 driver), zod |
| Mini App | React 18, Vite, Tailwind, `@telegram-apps/sdk-react`, `@telegram-apps/telegram-ui`, TanStack Query, Chart.js |
| Exports | ExcelJS (styled .xlsx), pdfmake (its bundled Roboto font includes Cyrillic). Both load only when the Reports screen opens. |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` (real D1 in tests), Playwright smoke tests with a mocked Telegram environment |
| Tooling | pnpm workspaces, ESLint, Prettier, Wrangler |

---

## 3. Free-tier budget and capacity

| Resource | Free limit | Expected use (≈150 members, 6 groups, weekly meetings) | Headroom |
|---|---|---|---|
| Worker requests | 100k / day | ~2–5k / day | 20×+ |
| Worker CPU | 10 ms per request / cron run | JSON API and HMAC checks ≈ 1–3 ms | Heavy work runs on the phone |
| External requests per run | 50 | Outbox drains ≤ 25 messages per run | OK |
| Cron triggers | 5 per account | 2 used | 3 spare |
| D1 storage | 5 GB | < 20 MB after 5 years | Effectively unlimited |
| D1 reads / writes | 5M / 100k per day | < 50k / < 2k | Large |
| GitHub Actions (private repo) | 2,000 min / month | CI ~150 + backups ~10 | OK |

Telegram limits matter more than hosting limits:
- The bot can only message people who have pressed **Start**. The join flow guarantees they have.
- Sending is capped at about 30 messages per second overall and 1 per second per chat. The outbox handles this and backs off on HTTP 429.
- Bot files can be up to 50 MB, far above any report.

If the church grows 10×, this still fits. The paid escape hatch is Workers Paid at $5 a month, with no code changes.

---

## 4. Repository layout

```
church-app/
├─ apps/
│  ├─ worker/                 # Cloudflare Worker: API + bot + cron
│  │  ├─ src/
│  │  │  ├─ index.ts          # Hono app, fetch + scheduled exports
│  │  │  ├─ auth/             # initData validation, session context, role guards
│  │  │  ├─ bot/              # grammY: commands, callbacks, keyboards, texts
│  │  │  ├─ api/              # route modules: me, groups, members, meetings, finance, flags, reports
│  │  │  ├─ jobs/             # outbox drain, hourly tick, generators, inactivity scan
│  │  │  ├─ db/               # drizzle schema, queries
│  │  │  └─ lib/              # telegram client, time/tz helpers, audit
│  │  ├─ migrations/          # drizzle-kit generated SQL
│  │  ├─ test/
│  │  └─ wrangler.jsonc       # envs: staging, production
│  └─ webapp/                 # React Mini App
│     └─ src/
│        ├─ app/              # routing, providers, Telegram SDK init
│        ├─ screens/          # member/, leader/, admin/
│        ├─ components/
│        ├─ reports/          # excel.ts, pdf.ts (loaded on demand)
│        └─ api/              # typed fetch client + TanStack Query hooks
├─ packages/
│  └─ shared/                 # zod schemas, DTO types, ru.ts strings, pure domain logic
│                             #   (streak calc, stats, money formatting) shared + unit-tested
├─ scripts/                   # set-webhook.ts, set-commands.ts, seed.ts
├─ docs/                      # PLAN.md, PRIVACY.ru.md, LEADER_GUIDE.ru.md
└─ .github/workflows/         # ci.yml, deploy.yml, backup.yml
```

---

## 5. Data model (D1 / SQLite, via Drizzle)

Timestamps are UTC ISO strings. Money is integer **cents**. Times of day are interpreted in the church time zone.

```sql
church_settings  (id=1, name, timezone 'Europe/Riga', currency 'EUR',
                  privacy_version, admin_backup_chat_id)

users            (id PK,
                  telegram_id INTEGER UNIQUE NULL,      -- NULL = offline member
                  first_name, last_name, username NULL,
                  is_admin BOOL DEFAULT 0,
                  is_reachable BOOL DEFAULT 1,          -- set 0 on 403 "bot blocked"
                  privacy_accepted_at NULL, privacy_version NULL,
                  guardian_consent_at NULL, guardian_consent_by NULL,  -- for children under the consent age
                  claim_code UNIQUE NULL, claim_expires_at NULL,
                  created_at, anonymized_at NULL)

groups           (id PK, name, description,
                  invite_code UNIQUE,                   -- rotatable
                  inactivity_threshold INT DEFAULT 3,
                  checkin_template TEXT,                -- Russian, with {имя}, {дата}
                  archived_at NULL, created_at)

memberships      (id PK, user_id, group_id,
                  role  CHECK IN ('leader','member'),
                  status CHECK IN ('pending','active','left','rejected'),
                  joined_at, left_at NULL,
                  UNIQUE(user_id, group_id))

meeting_schedules(id PK, group_id, weekday 0-6, start_time 'HH:MM',
                  duration_min, title, active, valid_from, valid_to NULL)

meetings         (id PK, group_id, schedule_id NULL, title,
                  starts_at, ends_at,
                  status CHECK IN ('scheduled','done','cancelled'),
                  guest_count INT DEFAULT 0,
                  roll_taken_by NULL, roll_taken_at NULL, notes NULL,
                  UNIQUE(schedule_id, starts_at))       -- idempotent generation

attendance       (meeting_id, user_id,
                  status CHECK IN ('present','late','excused','absent'),
                  marked_by, marked_at,
                  PRIMARY KEY(meeting_id, user_id))

ledger_categories(id PK, group_id, name, kind CHECK IN ('income','expense'), archived)

ledger_entries   (id PK, group_id,
                  kind CHECK IN ('income','expense','donation'),
                  category_id NULL, amount_cents INT CHECK (amount_cents > 0),
                  donor_user_id NULL, is_anonymous BOOL DEFAULT 0,
                  occurred_on DATE, note,
                  created_by, created_at,
                  voided_at NULL, voided_by NULL, void_reason NULL)  -- never hard-deleted

inactivity_flags (id PK, group_id, user_id, streak INT,
                  first_missed_meeting_id,
                  state CHECK IN ('open','messaged','contacted','snoozed','dismissed','resolved'),
                  snoozed_until NULL, handled_by NULL, handled_at NULL, created_at,
                  UNIQUE(user_id, group_id, first_missed_meeting_id))  -- one flag per streak

flag_cards       (flag_id, leader_user_id, chat_id, message_id)  -- to update every leader's card

outbox           (id PK, chat_id, method, payload JSON,
                  status CHECK IN ('pending','sent','failed','dead'),
                  attempts INT, next_attempt_at, last_error NULL,
                  dedupe_key UNIQUE NULL, created_at)

job_runs         (job, scope, period, ran_at, PRIMARY KEY(job, scope, period))  -- stops cron jobs running twice

audit_log        (id PK, actor_user_id, action, entity, entity_id, group_id NULL,
                  data JSON, created_at)
```

**Indexes:** `meetings(group_id, starts_at)`, `attendance(user_id)`, `ledger_entries(group_id, occurred_on)`, `memberships(group_id, status)`, `outbox(status, next_attempt_at)`.

**Derived values (computed, not stored)**
- **Attendance %** = (present + late) ÷ (meetings with status `done` since `joined_at`, excluding excused). Cancelled meetings and meetings without a roll call don't count.
- **Current streak:** walk the member's `done` meetings from newest to oldest. Each `absent` adds 1, `excused` is skipped, and `present` or `late` stops the count.
- **Treasury balance** = Σ income + Σ donation − Σ expense, over entries that aren't voided.

---

## 6. Authentication and permissions

**Mini App requests**
1. The web app sends `Authorization: tma <initDataRaw>` on every call.
2. The Worker validates it (Web Crypto HMAC-SHA256):
   - `secret = HMAC("WebAppData", BOT_TOKEN)`
   - `hash == HMAC(secret, data_check_string)`, compared in constant time
   - `auth_date` is no older than 24 hours
3. The Worker upserts the user (keeping name and username current) and loads their memberships into the request context.
4. User IDs sent in the request body are never trusted. Identity always comes from `initData`.

**Bot updates**
- The webhook checks the `X-Telegram-Bot-Api-Secret-Token` header, then trusts `ctx.from`.
- Callback buttons carry only IDs (e.g. `flag:send:123`). The handler re-checks that whoever pressed it is a leader of that flag's group.

**Permission matrix**

| Action | Member | Leader (own groups) | Admin |
|---|---|---|---|
| See own attendance, own donations, schedule | ✅ | ✅ | ✅ |
| See other members' data | ❌ | ✅ own groups | ✅ all |
| Approve joins, add offline members, change roles | ❌ | ✅ (not other leaders' roles) | ✅ |
| Roll call, create or cancel meetings | ❌ | ✅ | ✅ |
| Add or void ledger entries, manage categories | ❌ | ✅ | ✅ |
| Handle inactivity flags | ❌ | ✅ | ✅ |
| Export reports | ❌ | ✅ own groups | ✅ church-wide |
| Create or archive groups, assign leaders, church settings, audit log | ❌ | ❌ | ✅ |

**First admin:** `ADMIN_TELEGRAM_IDS` (a Worker secret) is applied on startup. Always keep **at least two admins** so the church can't be locked out.

---

## 7. Key flows

### 7.1 Joining a group
1. A leader shares an invite link or QR code: `https://t.me/<bot>?start=g_<inviteCode>`.
2. The person taps it and presses **Start**. The bot shows a short privacy notice in Russian with a **[Принимаю]** (I accept) button.
3. Accepting creates a `pending` membership. Every leader of the group gets a card:
   > Новая заявка в «Молодёжь 14–17»: **Анна Петрова** (@anna)
   > [✅ Принять] [❌ Отклонить]
4. The first leader to act edits all the cards ("Принята — Мария"). The member gets a welcome message with an **[Открыть приложение]** (Open app) button.
5. Leaders can rotate the invite code if a link leaks.

### 7.2 Offline member and claim code
1. A leader adds a member with a name only (no Telegram) and records guardian consent if the child is under the consent age.
2. The member can then be included in roll calls like anyone else.
3. Later, the leader taps **Выдать код привязки** (issue link code) and gets `https://t.me/<bot>?start=c_<code>`, valid for 7 days.
4. When the member opens it, their Telegram account is linked to the existing profile, keeping all history.
5. If that Telegram account already has memberships, the bot asks an admin to merge them. This is a rare case with an admin-only tool.

### 7.3 Meetings and roll call
1. Each group has schedules (e.g. Fridays 19:00, 120 min). The hourly job creates meetings 4 weeks ahead; `UNIQUE(schedule_id, starts_at)` stops duplicates. Leaders can also add one-off events or cancel a meeting.
2. **Roll-call screen:** active members as of the meeting date, sorted by first name, with a search box.
   - Tap a row to mark **present** (green). Long-press for **late** or **excused**.
   - Unmarked rows count as **absent** when saved.
   - A **+ Гость** (guest) counter tracks visitors, with a "create profile" option for newcomers.
   - Telegram's main button reads **Сохранить (18 из 24)**. Saving sets the meeting to `done` and writes all attendance rows in one D1 batch.
3. Leaders can edit a roll call for 14 days afterwards. Every change goes to the audit log.
4. **Reminder:** one hour after a meeting ends with no roll call, leaders get:
   > Отметьте посещаемость: «Пятничная встреча», 12.09 [Открыть]

   The button uses `startapp=roll_<meetingId>` to open the Mini App straight on that roll call.

### 7.4 Finance
1. Leaders record **income**, **expense** or **donation**, each with an amount, category, date and note.
   - A donation can name a donor (member picker) or be marked anonymous.
2. Mistakes are fixed by **voiding** (reason required) and re-entering. Voided entries stay visible, struck through, and are excluded from totals.
3. **Bot shortcuts for leaders:**
   - `/расход 12.50 пицца` (expense) and `/доход 50 ярмарка` (income).
   - Latin aliases: `/expense` and `/income`.
   - If the leader has more than one group, the bot asks which group and category with buttons, then confirms **[Сохранить] [Отмена]**.
4. **Members** see only their own donations and a thank-you total. Whether members see the group treasury balance is a per-group setting (default: hidden).

### 7.5 Inactivity and pastoral care (leader approves)
1. **Daily scan** (10:00 church time): for each active membership, compute the streak (§5). If it reaches the group threshold and no flag exists for that streak, create an `open` flag. A card goes to every leader of the group (via the outbox):
   > 🔔 **Анна Петрова** пропустила 3 встречи подряд (последний раз была 22.08).
   > [💬 Отправить сообщение] [✍️ Написать лично] [⏰ Отложить 2 нед.] [✖️ Закрыть]
2. **Button actions:**
   - **Отправить сообщение** (send message) sends the group's check-in template from the bot, e.g.:
     > «Привет, Анна! Мы скучаем по тебе на встречах 🙂 Всё ли хорошо? Будем рады видеть тебя в пятницу, 26.09!»

     There's an "edit text" option in the Mini App. The flag becomes `messaged`.
   - **Написать лично** (write personally) opens a direct chat with the member: `t.me/<username>` if they have one, otherwise the Mini App shows their name. The leader then marks the flag `contacted`. This is the most personal option and the one the design encourages.
   - **Отложить 2 нед.** (snooze 2 weeks) and **Закрыть** (dismiss) do what they say.
3. The first leader's action updates every leader's card, so nobody sends a duplicate.
4. Offline members get only **[Позвонил(а) / связались]** (called / got in touch) and **[Отложить]** (snooze).
5. When the member attends again, open flags become `resolved` automatically.
6. **Replies:** if a member answers the bot's check-in, the reply is forwarded to the leader who triggered it.
7. **Weekly summary** for leaders (Monday 09:00): attendance trend, open flags, treasury change.

### 7.6 Reports and exports
1. **Reports** screen (leaders and admins): choose a group (admins can choose "all"), a date range and a report type:
   - **Attendance matrix:** members × meetings, cells coloured П/О/У/Н (present/late/excused/absent), % column, totals row, guest counts.
   - **Treasury:** entries list, totals by category, monthly cash flow, donations summary. Anonymous donations show as "Аноним".
   - **Member list:** name, groups, role, joined date, attendance %.
2. The Mini App fetches JSON, then builds the file itself:
   - **.xlsx** with ExcelJS (styled headers, frozen first column).
   - **PDF** with pdfmake (A4 landscape for the matrix, Cyrillic-safe Roboto, Chart.js charts embedded as PNG).
3. It uploads the file to `POST /api/reports/deliver`. The Worker streams it to Telegram `sendDocument` in the requester's private chat, so the file lands in the chat and can be forwarded or saved on any device.
   - On Telegram Desktop there's also a direct-download option (`downloadFile`).
4. The Excel and PDF libraries (~1.5 MB) load only when Reports is opened, so the main app stays small.

### 7.7 Backups
- **D1 Time Travel:** restore to any point in the last 7 days on the free plan.
- **Weekly GitHub Actions job:**
  1. `wrangler d1 export` produces a gzipped SQL file.
  2. It's sent by `sendDocument` to the admin backup chat.
  3. It is **never** stored as a GitHub artifact, because it contains personal data.
- A restore runbook is in `docs/`, tested once before launch.

---

## 8. Bot design

**Menu button:** opens the Mini App. The main Mini App is configured in BotFather so `startapp` links work.

**Commands** are shown per role with `setMyCommands`. Leaders and admins get a chat-scoped list, refreshed when their role changes.

| Command | Who | Description (RU menu text) |
|---|---|---|
| `/start` | all | Приветствие; handles `g_…` (join) and `c_…` (claim) payloads |
| `/app` | all | Открыть приложение |
| `/me` | all | Моя посещаемость и пожертвования |
| `/privacy` | all | Политика конфиденциальности, мои данные |
| `/help` | all | Помощь |
| `/roll` | leader | Отметить посещаемость сегодняшней встречи |
| `/доход`, `/income` | leader | Записать доход |
| `/расход`, `/expense` | leader | Записать расход |
| `/flags` | leader | Кто давно не был |
| `/groups` | admin | Группы церкви |

**Tone:** warm and short, in Russian, with at most one emoji per message.

---

## 9. REST API (all under `/api`, JSON, zod-validated)

```
GET    /me                                  profile, memberships, roles
GET    /me/stats                            own attendance % per group, streak, history
GET    /me/donations
GET    /me/export                           GDPR: sends own data as JSON via bot
POST   /me/delete-request                   GDPR: notifies admins

GET    /groups                              (scoped by role)
POST   /groups                              admin
PATCH  /groups/:id                          admin/leader: name, threshold, template, settings
POST   /groups/:id/invite/rotate            leader

GET    /groups/:id/members?status=
POST   /groups/:id/members                  leader: add offline member
PATCH  /memberships/:id                     leader: approve/reject/role/leave
POST   /users/:id/claim-code                leader
PATCH  /users/:id                           leader: names, guardian consent

GET    /groups/:id/schedules | POST | PATCH /schedules/:id | DELETE
GET    /groups/:id/meetings?from&to
POST   /groups/:id/meetings                 leader: ad-hoc
PATCH  /meetings/:id                        leader: cancel, notes, guests
GET    /meetings/:id/roll                   leader
PUT    /meetings/:id/roll                   leader: batch save [{userId,status}]

GET    /groups/:id/stats?from&to            dashboard numbers + series
GET    /groups/:id/ledger?from&to&kind
POST   /groups/:id/ledger                   leader
POST   /ledger/:id/void                     leader, reason required
GET|POST|PATCH /groups/:id/categories

GET    /groups/:id/flags?state=
POST   /flags/:id/{send,contacted,snooze,dismiss}

GET    /reports/{attendance,finance,members}?groupId&from&to   JSON for client export
POST   /reports/deliver                     multipart file → sendDocument to caller

GET    /admin/audit?entity&from&to          admin
PATCH  /admin/settings                      admin
```

Errors use one shape: `{ error: { code, message } }`. Every endpoint gets a role guard and a test.

---

## 10. Mini App screens

The app follows Telegram theme variables (light and dark), uses the Telegram back and main buttons and haptic feedback, and is built for a 360 px wide screen.

**Member** (no tabs, one scrolling screen)
- **Главная** (home):
  - next meeting (date, time, place)
  - my attendance % (ring chart) and last 8 meetings as dots
  - my groups
- **Мои пожертвования** (my donations): list and yearly total.
- **Профиль** (profile): name, privacy notice, "download my data" and "delete my account" request.

**Leader** (bottom tabs, with a group switcher at the top if they lead more than one group)
- **Обзор** (overview):
  - tiles: average attendance over 4 weeks, active members, treasury balance, open flags
  - attendance trend chart
  - banners for "roll call missing" and "N new join requests"
  - shortcut to **Отчёты** (reports)
- **Посещаемость** (attendance): upcoming and past meetings, then roll call. Schedule editor, one-off events, cancel.
- **Финансы** (finance): balance, monthly cash flow chart, entries list with filters, add entry (big numeric keypad), categories.
- **Участники** (members):
  - search
  - pending requests
  - add offline member
  - invite link and QR
  - **Внимание** (attention) sub-list of flags
  - member detail: attendance history, %, donations, role, claim code, guardian consent

**Admin** (everything above plus a **Церковь** (church) tab)
- groups: create, archive, assign leaders
- church-wide stats and reports
- settings: name, time zone, currency, backup chat
- audit log viewer
- admins list

---

## 11. Scheduled jobs

Two Cron Triggers are used; three stay spare.

| Cron (UTC) | Job | Details |
|---|---|---|
| `*/5 * * * *` | **Outbox drain** | Sends up to 25 pending rows (`next_attempt_at ≤ now`). On 429 it waits `retry_after`. On 403 it marks the user unreachable and the row dead. Other errors back off exponentially, max 5 attempts. |
| `7 * * * *` | **Hourly tick** | For each group, in church local time: (a) generate meetings 4 weeks ahead; (b) roll-call reminder for meetings that ended over an hour ago with no roll call; (c) at 10:00, inactivity scan and flag cards; (d) Monday 09:00, weekly leader summary; (e) daily 03:00, housekeeping (expire claim codes, purge sent outbox rows older than 30 days, anonymize per the retention rules). Each sub-job is recorded in `job_runs` so it never runs twice. |

Messages a user triggers directly (approve buttons, "send check-in") go out immediately in that request. The outbox is only for bulk or scheduled sends.

---

## 12. Exports: technical notes

- **ExcelJS:** styled cells, and Cyrillic works out of the box. Filenames look like `Посещаемость_Молодёжь_2026-09.xlsx`.
- **pdfmake:** its default Roboto font includes Cyrillic. Use A4 landscape with automatic table page breaks for the matrix. Charts come from `chart.toBase64Image()`.
- **Upload limit:** 20 MB in the Worker (reports are KB-sized).
- **Checks:** the Worker confirms the caller is a leader or admin before relaying, and rate-limits to 10 exports per user per hour.

---

## 13. Security and GDPR

> This is not legal advice. The church's responsible person should review §13 and the privacy notice before launch.

**Security**
- `initData` HMAC check on every API call. Webhook secret token. Role checks on the server for every route and callback.
- zod validation on all input. Parameterized queries only (Drizzle). No raw user HTML is ever rendered.
- Secrets live only in Wrangler secrets and GitHub secrets, never in the repo. The repo should be **private**.
- Audit log for roles, memberships, roll-call edits, ledger entries and voids, deletions and exports.
- Basic rate limiting per Telegram user on write endpoints and exports.

**GDPR**
- **Special category data.** Membership in a church youth group reveals religious belief (Art. 9). The likely basis is **Art. 9(2)(d)**: a not-for-profit religious body processing data about its members and regular contacts, provided the data isn't disclosed outside the church without consent.
  - The design supports this: no third-party analytics, no data sharing, and exports go only to leaders' own chats.
- **Children.** The digital consent age varies by country (13 in Latvia and Estonia, 14 in Lithuania, up to 16 elsewhere).
  - The app records `guardian_consent_at` / `guardian_consent_by` for younger members, entered by the leader after getting consent on paper or verbally.
  - Offline members cover children who don't use Telegram.
- **Collect little.** Stored: names, Telegram ID and username, memberships, attendance, donations. **Not** stored: phone numbers, addresses, birthdays, photos or free-text notes about people's personal lives.
- **Transparency.** A Russian privacy notice (`docs/PRIVACY.ru.md`, also shown in the bot) says who is responsible, what is stored, why, how long, and how to exercise rights. Each user's acceptance is versioned.
- **Rights.** Members can download their data (`/me/export`, sent by the bot). Deletion requests go to admins.
  - On deletion the user is anonymized: name becomes "Удалённый участник", Telegram ID is removed. Attendance and ledger rows stay, so totals still add up.
- **Retention.** Members who left more than 24 months ago are anonymized automatically. Audit log entries are kept 3 years. Backup files are the admins' responsibility (the runbook explains how to delete old ones).
- **Processors.** Cloudflare, under its self-serve Data Processing Addendum. The D1 database is created with an EU location hint. Telegram is the channel the members already use.

---

## 14. Localization, time and money

- **Text:** all strings live in `packages/shared/i18n/ru.ts`, shared by the bot and the app. Plurals use `Intl.PluralRules('ru')` ("1 встреча / 3 встречи / 5 встреч").
- **Dates:** `Intl.DateTimeFormat('ru-RU', { timeZone: church.timezone })`. The database stores UTC and business logic uses the church time zone. Daylight-saving changes are covered by tests.
- **Money:** `Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' })`, so "12,50 €". Input accepts both `12,50` and `12.50`.

---

## 15. Testing strategy

| Level | What | Tool |
|---|---|---|
| Unit | initData validation (valid, tampered, expired), streak calc, attendance %, balance, money parsing, time-zone schedule generation | Vitest (`packages/shared`, `apps/worker`) |
| Integration | Every API route with real D1: happy path, forbidden role, wrong group, validation errors; the roll-call batch; voiding; flag lifecycle; outbox retry and 403 handling | `@cloudflare/vitest-pool-workers` |
| Bot | Command and callback handlers with a fake Telegram API (grammY transformer) | Vitest |
| UI smoke | Member and leader flows with a mocked Telegram environment (`mockTelegramEnv`) | Playwright (pre-installed Chromium) |
| Manual | A real phone on the staging bot before each production deploy: iOS, Android, Desktop | checklist in `docs/` |

CI must pass typecheck, lint and tests before any deploy.

---

## 16. Environments and deployment

| | Staging | Production |
|---|---|---|
| Bot | `@<Church>YouthDevBot` | `@<Church>YouthBot` |
| Worker | `church-app-staging.<acct>.workers.dev` | `church-app.<acct>.workers.dev` |
| D1 | `church-staging` (seeded with fake data) | `church-prod` (EU hint) |
| Deploy | automatic on push to `main` | manual "Deploy production" workflow (approval) |

**Deploy steps** (both environments):
1. `pnpm build` (web app into the Worker assets)
2. `drizzle-kit` migrations: `wrangler d1 migrations apply --remote`
3. `wrangler deploy --env <env>`
4. `scripts/set-webhook.ts` and `set-commands.ts` (idempotent)

A custom domain is optional. `workers.dev` already has HTTPS and works with Telegram.

**No local computer needed.** Development can run in Claude Code on the web, testing on staging from any phone. Locally, `wrangler dev` plus a mocked Telegram environment works for UI work.

---

## 17. What you need to set up (once)

1. **Telegram:** in @BotFather, create **two bots** (staging and prod) with `/newbot` and save both tokens. The deploy scripts set the menu button, commands and Mini App URL. Get your numeric Telegram ID from @userinfobot, plus the ID of a second admin.
2. **Cloudflare:** a free account. Create an API token (template "Edit Cloudflare Workers" plus **D1 Edit**) and copy your **Account ID**.
3. **GitHub:** make `church-app` **private**. Add repository secrets:
   - `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - `BOT_TOKEN_STAGING`, `BOT_TOKEN_PROD`
   - `WEBHOOK_SECRET_STAGING`, `WEBHOOK_SECRET_PROD` (random 32+ characters)
   - `ADMIN_TELEGRAM_IDS` (comma-separated)
4. **Church decisions:** group names and leaders, meeting schedules, expense categories, check-in message wording, who is the data controller contact, and the inactivity threshold (default 3).

---

## 18. Phases

Each phase ends with a deploy to staging and a short check on a real phone.

### Phase 0 · Foundation (S)
- pnpm monorepo, TypeScript, ESLint and Prettier, Vitest; CI workflow.
- Wrangler config with staging and production environments, D1 databases, first migration.
- Hono app: `/health`, `/bot/webhook` (grammY, secret check), static assets.
- initData validation plus `/api/me`. A Mini App shell with the Telegram SDK, theme, and a "Привет, {имя}" screen.
- Deploy workflow, and the set-webhook and set-commands scripts.
- **Done when:** on the staging bot, `/start` replies in Russian, and the menu button opens the Mini App showing your name loaded from `/api/me` after the server checks it.

### Phase 1 · Church, groups, members (M)
- Schema: users, groups, memberships, church_settings, audit_log. Bootstrap admins from env.
- Admin: create and archive groups, assign leaders.
- Invite links and QR codes, privacy acceptance, join requests with leader cards (multi-leader sync), approve and reject.
- Offline members, guardian consent field, claim codes (`c_` deep link).
- Member list, member detail, role changes, leave group. Per-role command menus.
- **Done when:** an admin creates two groups, a leader invites three phones and approves them, adds one offline member, and that member later claims the profile. Members can't see each other's data (tested).

### Phase 2 · Meetings and attendance (M)
- Schedules, the hourly generator (time-zone tested), one-off events and cancelling.
- Roll-call screen (tap, long-press, guests, main-button save), 14-day edit window, audit.
- Member home: next meeting, attendance %, last-8 dots. Leader overview tiles and trend chart.
- Outbox and cron drain (brought forward so it's ready for reminders), plus the roll-call-missing reminder with a `startapp` deep link.
- **Done when:** a real meeting's roll call for 20 people is saved in under 60 seconds, the numbers match a hand count, and the missing-roll-call reminder arrives once, not twice.

### Phase 3 · Treasury and donations (M)
- Ledger categories (seeded defaults in Russian), income, expense and donation entries, donor picker and anonymous option.
- Voiding with a reason, and an entries list with filters.
- Balance, monthly cash flow chart, member "Мои пожертвования", setting for members seeing the treasury.
- Bot shortcuts `/доход`, `/расход` with confirm buttons.
- **Done when:** a month of real transactions matches the paper or bank record, a voided entry drops out of totals but stays visible, and members see only their own donations.

### Phase 4 · Inactivity and pastoral care (M)
- Streak computation (shared, unit-tested), daily scan, flags with one flag per streak.
- Leader cards with send, write personally, snooze and dismiss; card sync across leaders; offline-member variant.
- Editable Russian check-in template per group, reply forwarding, auto-resolve on return.
- Weekly leader summary.
- **Done when:** with seeded history, exactly the expected members are flagged, each once. Acting on one leader's card updates the other leaders' cards. A member who attends again is resolved automatically.

### Phase 5 · Reports and exports (M)
- Report JSON endpoints.
- Excel (attendance matrix, treasury, members) and PDF (the same three, with charts). Both load on demand.
- `/reports/deliver` sending files to the chat, with rate limiting. Admin church-wide reports.
- **Done when:** a leader gets `Посещаемость_…xlsx` and `…pdf` in the bot chat within 5 seconds, the Cyrillic text is correct, and the files open on iOS, Android and a PC.

### Phase 6 · Hardening and launch (S–M)
- GDPR pieces: `PRIVACY.ru.md`, `/privacy`, data export, deletion by anonymization, retention housekeeping.
- Weekly backup workflow, plus a tested restore runbook.
- Rate limits, error logging (Workers Observability), a production deploy with approval.
- `LEADER_GUIDE.ru.md`: one page with screenshots.
- **Pilot:** one group for 3–4 weeks, fix feedback, then roll out to all groups.
- **Done when:** the pilot group has run 3 real meetings on production, a backup has been restored into staging successfully, and the privacy notice is approved by the church.

**MVP = Phases 0–3.** That is usable for weekly work. Phases 4–6 complete the original vision.

---

## 19. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Free-tier terms change | Portable code: Drizzle can move to Postgres (Neon), and the static assets can be hosted anywhere. Workers Paid is $5 a month with no code change. |
| A cron run exceeds 10 ms CPU as data grows | Work is SQL-heavy (DB time isn't CPU), batched per group; monitor in Workers logs. |
| Teens block or delete the bot | `is_reachable` flag; leaders see "недоступен" (unreachable) and use "Написать лично" instead. |
| Admin loses access | At least two admins, set by env var and editable in the app. |
| A mistake or dispute in the treasury | Void-only corrections, audit log, monthly PDF archived in the leaders' chat. |
| A leaked invite link | Leader approval is always required, and codes can be rotated. |
| Data loss | D1 Time Travel (7 days) plus weekly exports to the admin chat, with a tested restore. |
| GDPR complaint | Special-category basis written down, minimal data, privacy notice, rights tooling, retention job. |
| A single maintainer | Plain stack, one repo, tests and CI, docs for setup, deploy and restore. |

---

## 20. Open questions (defaults used if unanswered)

| Question | Default |
|---|---|
| Number of groups, members and leaders | ≤ 10 groups, ≤ 300 members |
| Time zone and currency | `Europe/Riga`, EUR |
| Inactivity threshold | 3 consecutive missed meetings (per group setting) |
| Can members see the group treasury balance? | Hidden (per-group toggle) |
| Roll-call edit window | 14 days |
| Retention after leaving | Anonymize after 24 months |
| Consent age used for guardian consent | Set per church (13 / 14 / 16) |
| Who is the data controller contact? | Church name + admin contact in the privacy notice |

---

## 21. Future ideas (out of scope)
- Bot posts meeting announcements and reminders in the youth group chat.
- RSVP for events and camps, with capacity limits.
- Birthday greetings (would need birth dates, which is more personal data, so only as opt-in).
- Prayer requests (sensitive, so a separate privacy review first).
- Supporting several churches (the schema is almost ready: add `church_id`).
