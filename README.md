# BTC Photo Uploader

A single browser-based uploader for all Black Turtle Conservation photo surveys (Sea Turtle, Shark Research, Shark Citizen Science, Sea Slug, Crown of Thorns). Select the project at the top, fill in the folder details, drag in photos, and the app names each file according to that survey's convention and uploads them to the correct Google Drive folder.

For Shark Citizen Science it also appends a row to a master Google Sheet summarising the submission.

## How it works

- **Frontend only** — no backend. Talks directly to Google Drive + Sheets via OAuth from the browser.
- **Hosted on GitHub Pages**, same as the other BTC uploaders.
- **Per-project theming** — the topbar, logo backdrop, and accents all retint to match the selected survey.
- **Naming templates** are defined per survey in `config.js`. Editing that file is the only thing required to change naming conventions, add team members, or add new surveys.
- **HEIC → JPG** conversion happens client-side via `heic2any` (loaded lazily the first time a HEIC file is added).
- **Folder dedupe** — if a subfolder with the same name already exists, the user is prompted to add to it (sequence continues from existing count) or create a `…-2` suffix copy.

## One-time setup before first deploy

1. **Create a Google Cloud OAuth client ID**
   - Go to https://console.cloud.google.com/apis/credentials
   - Pick (or create) a project, then "Create credentials → OAuth 2.0 Client ID"
   - Application type: **Web application**
   - Authorized JavaScript origins:
     - `https://setmay31.github.io` (or wherever you host this)
     - `http://localhost:8000` (for local testing)
   - Copy the resulting Client ID (ends in `…apps.googleusercontent.com`).
2. **Paste the Client ID into `config.js`** — replace `REPLACE_WITH_YOUR_CLIENT_ID...` near the top.
3. **Enable APIs** in the same Cloud project:
   - Google Drive API
   - Google Sheets API
4. **OAuth consent screen** — under "OAuth consent screen", set User Type to **External**, add yourself as a test user (and any other BTC team members who will use the app), then publish (or leave in testing if only a handful of users).

## Local testing

```sh
cd ~/btc-photo-uploader
python3 -m http.server 8000
# Visit http://localhost:8000
```

The Service Worker is registered on `/`, so use a real HTTP server (not `file://`).

## Deploying

Same flow as the other uploaders:

```sh
cd ~/btc-photo-uploader
git init
git add .
git commit -m "Initial commit"
gh repo create BTC-Photo-Uploader --public --source=. --remote=origin --push
# Enable Pages: Settings → Pages → Source = "Deploy from a branch" → main / root
```

Once enabled, the app lives at `https://setmay31.github.io/BTC-Photo-Uploader/`.

## Adding a new survey later

Open `config.js` and add a new entry to the `SURVEYS` array with:

- `key` — internal id (kebab-case)
- `label` — what shows on the toggle pill
- `driveFolderId` — the Drive folder this survey's subfolders are created inside
- `theme` — `accent`, `accent2`, `accentSoft`, `brandVivid`, `shadow` (all hex/rgba)
- `folder.fields` + `folder.template` — fields and naming pattern for the subfolder
- `photo.fields` + `photo.template` + optional `photo.sequence` — fields and pattern for each photo

Template syntax:
- `{fieldName}` — required value, dropped if empty
- `[…{fieldName}…]` — optional segment, the *whole bracketed segment* is removed if any inner field is empty
- `{fieldName|initial}` — only the first letter of the value is used (used for Sea Slug genus)

Spaces inside values become underscores; dashes separate fields.

## Naming conventions in use

| Survey | Folder | Photo |
|---|---|---|
| Sea Turtle | `YYYY-MM-DD-SurveySite-UploadedBy` | `Number-Side[-Note][-Name]` |
| Shark Research | `YYYY-MM-DD-SurveySite-UploadedBy` | `PhotoSubject[-Note]` |
| Shark Citizen Science | `YYYY-MM-DD-Site-UploadMethod` | `Number[-Note]-SubmittedBy` |
| Sea Slug | `YYYY-MM-DD-Site1[-Site2]` | `SlugNumber-GenusInitial-Species` |
| Crown of Thorns | `YYYY-MM-DD-Site1[-Site2]-UploadedBy` | `Number[-Note]` |

## Notes

- The Survey Date defaults to today (intentionally — EXIF dates were unreliable across team cameras).
- Sequence numbers (`Number`, `Turtle Number`) auto-increment per session. For Citizen Science and Crown of Thorns, when uploading to an existing folder, numbering continues from the existing photo count.
- Drive uploads require an online connection. Folder/site fields and photo previews work offline (via the service worker cache), but submitting won't.
- The Citizen Science master sheet is created the first time you submit, inside the Shark Citizen Science Drive folder. After that, every submission appends a new row.
