# FindIt - Smart Campus Lost & Found

A student-project lost-and-found portal built with HTML, CSS, vanilla JavaScript, a C HTTP server, and SQLite. Supabase provides passwordless email OTP login. This is a local demo: report ownership and backend access control are not implemented.

## Run the app

### UI and email login (macOS, Windows, Linux)

Install Node.js 20 or newer. From the project folder run:

```sh
node start-ui.mjs
```

Open **http://127.0.0.1:3000** and click **Log in**. Enter an email,
click **Send login code**, then enter the code and click **Verify and log in**.
The session is restored after reload, automatically refreshed by the Supabase
library, and cleared with **Log out**. Log out on shared computers.
Do not open the HTML directly or use a generic static server: the UI launcher
provides the public configuration endpoint while keeping `.env` private.

Email login works without the C server. Reports need the C/SQLite server running
separately on port 8080; the UI forwards report API requests to it. Without it,
an explicit notice explains that reports are unavailable; OTP login still works.
Set `PORT` or `FINDIT_BACKEND_PORT` environment variables to use different ports.

### C report server (existing Windows setup)

On Windows, install PowerShell and GCC, then run `.\start.ps1` in another terminal. The first build downloads the SQLite, cJSON, and CivetWeb source dependencies into `.build/`. The SQLite database is stored under `data/`. Continue using the UI on port 3000 for login; port 8080 is the report server. The existing PowerShell build is Windows-specific; compiling `c/demo.c` on macOS runs only the standalone example, not the HTTP/database server.

The home, browse, lost-report, found-report, and about views use hash navigation. Demonstration reports are inserted when the database is first created.

## Features, including the challenge additions

- Required-field validation, description length limits, and no future report dates.
- Lost and found reports, search across name/description/location/category, and category/status filters.
- Item details, contact information, confirmation before marking returned, and dynamic statistics.
- Optional found-item photo: JPEG, PNG, or WebP up to 2 MB, resized to at most 900 pixels before saving.
- **Smart match suggestions:** compares Lost and Found reports using category, shared keywords, and location. The score is a transparent browser-side heuristic, not a trained AI model.
- **Personalized dashboard:** filters recent reports by a selected category and Lost/Found activity type. Preferences are saved in this browser.
- **Voice output:** uses the browser's built-in speech synthesis to read report details aloud. Contact information is not spoken.
- **Contact safety prompt:** asks before showing contact details and reminds users about safe handovers. This prompt does not restrict access to the underlying local API.
- **Demo points and badges:** awards 10 points for a report and 20 for confirming a return. Progress is stored in this browser and is not identity-checked.
- **Email OTP login:** Supabase sends and verifies email codes, restores sessions, and supports logout. Incorrect/expired codes and delivery failures are displayed. Code resends have a one-minute UI cooldown; Supabase enforces its own rate limits.
- Responsive navigation, a keyboard-accessible native details dialog, empty states, reduced-motion support, and safe text rendering of submitted content.

Statistics definitions: **reported** is all records, **found** is records originally reported Found (including those later returned), and **returned** is records currently Returned. Found and returned are not mutually exclusive totals.

Photos from Unsplash, Google Fonts (DM Sans and Manrope), and the Lucide icon font require internet access. If an item photo fails, its category placeholder is shown. Demonstration photos are reference imagery, not photographs of actual lost property. Example contacts are not real reporters.

## Prototype limitations and privacy

### Supabase configuration

Copy `.env.example` to `.env` and set `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY`. The local `.env` file is ignored by Git.
Only the browser-safe publishable key is needed for email OTP login; never add a
Supabase secret/service-role key, Gmail app password, or database password to
browser configuration.

`node start-ui.mjs` reads these two values and exposes only them at
`/api/public-config`. No secret key is used. It serves only an explicit list of
website assets and never serves `.env`, source folders, or the database.
Restart the UI launcher after changing configuration.

In Supabase:

1. Enable the Email provider and new user signups.
2. Configure custom SMTP (sender, host, port, username, and app password/API key).
   SMTP credentials go only in Supabase, never this project.
3. In Emails -> Magic link or OTP, include `{{ .Token }}` in the email body.
4. Ensure the email template uses a code, not just a confirmation link. The UI
   accepts 6-10 numeric digits to accommodate the configured OTP length.
5. Test using an inbox you control. Check spam and Supabase Auth logs for delivery
   errors. The default sender has testing restrictions; use custom SMTP for
   arbitrary student email addresses.

The login library loads from jsDelivr and communicates directly with your
Supabase project's HTTPS Auth service. Actual delivery depends on your project's
SMTP settings, provider limits, and valid credentials.

Reports are stored in the local SQLite database and shared with browsers that can reach this server. Dashboard preferences and demo rewards use browser `localStorage`. Supabase verifies login, but the C report API does not yet verify access tokens, associate reports with users, or enforce ownership. The contact prompt and login UI are not backend access controls. Do not enter passwords, full student ID numbers, or sensitive contact information in reports. Verify ownership privately and arrange a public campus handover.

## Files

| File         | Purpose                                          |
| ------------ | ------------------------------------------------ |
| `index.html` | Semantic structure, report form, and page views |
| `style.css`  | Responsive visual design and feature components |
| `script.js`  | API calls, matching, preferences, voice, and UI  |
| `auth.js`    | Supabase OTP, session restoration, and logout   |
| `start-ui.mjs` | Local UI, public config, and C API forwarding |
| `c/`         | C server, SQLite persistence, and validation     |
| `build.ps1`  | Build server and run the database tests          |
| `start.ps1`  | Build (if needed) and start the local server     |

To run the backend/database tests on Windows, use `.\build.ps1 -Test`.

To check the UI launcher, public configuration, private-file isolation, and
disconnected-backend handling, run `node --test tests/start-ui.test.mjs`.
