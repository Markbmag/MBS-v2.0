# M8 security review: subscriptions, alerts, public links, embedding

Scope: everything that sends data to people or systems outside Ncode's normal sign-in -
`backend/app/automation/`, `backend/app/sharing/`, `backend/app/usage.py`, and the public/embed pages
in the frontend. A separate review pass read the code end to end looking for ways around access
control, leaks to anonymous visitors, token flaws, injection and denial of service.
Every finding below was fixed and has a regression test.

## Design rules

| Rule | Where it is enforced |
|---|---|
| A subscription runs with its **owner's** permissions, checked at every send; a disabled or deleted owner stops it | `automation/engine.py` (`Engine.run`), `content/store.py` (`forget_user`) |
| Only admins create public links, allow embedding, set up chats/webhooks (so only admins choose outgoing URLs: no SSRF by users) | `require_admin` on every route in `sharing/routes.py` and `/api/admin/*` |
| Public links and embedding are **off by default** and switching them off stops every link at once | `resolve_public` / `resolve_embed` check `app_settings` on every request |
| Visitors get results only: no SQL, no source details, no database errors, no table/column/parameter names | `clean()` and `start()` in `sharing/routes.py`; `definition()` strips mappings, ids, connections |
| A link sees only its own query tasks | task id → link id map + pseudo-owner `public#<id>:<owner>` (`#` and `:` cannot occur in real usernames) |
| Embedding tokens: HS256 only, signature checked in constant time before the payload is read, `exp` required, finite and ≤ 30 days | `sharing/tokens.py` |
| Locked embed parameters cannot be overridden by the viewer | `Shared.given()` applies locked values last and accepts only editable names |
| Secrets (SMTP password, webhook URLs, bot tokens, the embedding key, link tokens) are Fernet-encrypted; the API shows only "is set" or the last characters; delivery errors never repeat a URL | `automation/settings.py`, `channels.py` |
| Everything in emails is HTML-escaped; the preview iframe is `sandbox=""`; headers are single-line | `render.py`, `channels.one_line` |
| CSV attachments and downloads cannot contain spreadsheet formulas (values and headers) | `render._safe_cell` |
| Public endpoints never answer 401 (a 401 would sign a viewer out of their own Ncode session) | `sharing/routes.py` |

## Findings and fixes

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Medium | *Send now* could be repeated without limit: a user could use the company SMTP server as a relay for their own text, and fill the scheduler's pool | 409 while a send is running, at most one manual send per 20 s per subscription |
| 2 | Medium | The admin's *allowed domains* were checked only for typed addresses when saving, not for users' own account addresses or for subscriptions made before the rule | checked at **send time** for every address of a non-admin owner |
| 3 | Low/Med | Refusals passed through to visitors could name a parameter, column or connection (`Unknown connection 'prod_dw'`) | every refusal to a visitor is a generic message; details go to the server log |
| 4 | Low | A recipient reading a subscription could see other recipients' addresses in its send history | recipients get no send history and no last error |
| 5 | Low | Changing a link's password did not lock out visitors who had unlocked it (12 h) | the password's hash is part of the signed access value |
| 6 | Low | Visitors could hold a server thread up to 15 s per request | visitor waits capped at 2 s (the page polls) |
| 7 | Low | A token with `"exp": NaN` never expired (needs the key, so hardening); a non-ASCII token caused a 500 | `math.isfinite`, encoding errors are a 400 |
| 8 | Low | CSV column names were not protected against formulas | headers go through the same check as values |

Checked and found sound: JWT handling; locked parameters; cross-link and cross-user task access;
password, expiry and revocation on every run, poll and export; downloads only on links that allow them;
SQL in `usage.py` (only constants and integer ids are interpolated); escaping in emails and the
preview; header injection; destination URL validation; subscription ownership (create, edit, send,
delete: owner or admin; the target cannot be swapped); memory of the in-process maps (pruned, bounded
by the rate limit).

## What remains the operator's job

- Serve Ncode over **HTTPS** before using public links or embeds outside a trusted network (M9 brings
  Caddy). Links, passwords and embedding tokens travel in URLs and headers.
- The rate limit is per client address; behind a reverse proxy that does not pass client addresses,
  all visitors share one limit.
- Recipients see what the owner sees. Use allowed domains, and give the admin role only to people
  who may decide what leaves the company.
- Back up `backend/data/secret.key` (or `NCODE_SECRET_KEY`): without it, saved secrets and links
  cannot be read.
