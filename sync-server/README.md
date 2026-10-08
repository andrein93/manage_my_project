# mmp sync server

A small self-hosted relay that lets a team share mmp data (clients, categories, projects, tasks,
agreements, payments, expenses and time). One server is one team. The server stores records as
opaque JSON and hands out changes in order; each mmp keeps working offline and syncs when it can.

## Requirements

- PHP 8.3+ with the `pdo_sqlite` extension (or the driver of the database you choose)
- Composer

SQLite is the default. Any database supported by Laravel (MySQL, MariaDB, PostgreSQL) works: set
the `DB_*` variables in `.env`.

## Install

```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
```

In `.env`, set `APP_NAME` (shown to members as the server name) and `APP_URL` (the public URL of
the server; it is used in the login hint printed for new members). Use `APP_ENV=production` and
`APP_DEBUG=false` in production.

## Members

Create a member; the command prints an API token and the command to connect:

```bash
php artisan mmp:user "Ada Lovelace" ada@example.com
```

Issue another token for an existing member (for example for a second computer):

```bash
php artisan mmp:token ada@example.com
```

Tokens are shown only once. Send them to the member over a private channel.

Revoke all tokens of a member (a lost laptop, a leaked token, someone leaving the team):

```bash
php artisan mmp:revoke ada@example.com
```

The member is kept, so the records they wrote still show them as author; issue a fresh token with
`mmp:token` if they should come back. To also delete the member:

```bash
php artisan mmp:revoke ada@example.com --remove
```

Their shared records stay on the server and keep syncing, but without an author.

## Permissions

Every member can read and edit every shared record: there are no per-record or per-role
permissions. Only give tokens to people you trust with all of the team's data, and revoke them as
soon as someone leaves.

## Run

For a quick start or a LAN:

```bash
php artisan serve --host=0.0.0.0 --port=8000
```

In production, serve the `public/` folder with any PHP host (nginx or Apache with PHP-FPM, Laravel
Forge, shared hosting, ...) and always put it behind HTTPS: tokens travel in request headers. The
mmp client refuses plain `http://` URLs except for `localhost`, `127.0.0.1`, `*.test` and
`*.local`, so a server reachable only over HTTP works for local development but not for a team.

With SQLite, the connection waits up to 5 seconds for the write lock (`DB_BUSY_TIMEOUT`, in ms),
uses WAL journaling (`DB_JOURNAL_MODE`) and starts transactions as `IMMEDIATE`
(`DB_TRANSACTION_MODE`), so concurrent pushes queue up instead of failing with `SQLITE_BUSY`.
Keep the database file on a local disk (WAL does not work on network file systems).

The API allows 240 requests per minute per member; clients syncing every couple of minutes stay
far below it. Responses carry `X-RateLimit-Limit` and `X-RateLimit-Remaining`, and a client over
the limit gets `429` with `Retry-After`.

## Connect mmp

Each member runs, on each computer:

```bash
mmp sync login https://sync.example.com "1|the-token"
mmp sync
```

Keep the quotes around the token: it contains a `|`.

## API

All endpoints are under `/api/v1` and need `Authorization: Bearer <token>`:
`GET /me`, `GET /members`, `POST /sync/push`, `GET /sync/pull?since=<seq>&limit=<n>`.
Conflicts are resolved by last write wins on the client `updated_at`, so keep member clocks in
sync (automatic time).

## Tests

```bash
php artisan test
```
