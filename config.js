// BTC Photo Uploader — survey configuration
// Single source of truth. To add a new survey, append an entry to SURVEYS.
// To update the team list, edit TEAM_MEMBERS. Then redeploy.

// --- Google OAuth client ID ---
// Create at https://console.cloud.google.com/apis/credentials
// (OAuth 2.0 Client ID → Web application). Authorized JS origins must include
// the GitHub Pages origin (e.g. https://setmay31.github.io). Paste below.
const OAUTH_CLIENT_ID = "547270539651-9ockq941ks3kpd2gbiu3gj7vt8871dh5.apps.googleusercontent.com";

const TEAM_MEMBERS = [
  "Cass Chaytor",
  "Maisie Miles",
  "Seth Mayhew",
  "Sandra Rubio",
  "C.J. Durham",
  "Kelly Stokes",
  "Irene Gomez",
];

// Common field definitions used across surveys.
const FIELD_UPLOADED_BY = {
  name: "uploadedBy",
  label: "Uploaded By",
  type: "team-or-other",
  required: true,
};
const FIELD_SUBMITTED_BY = {
  name: "submittedBy",
  label: "Submitted By",
  type: "team-or-other",
  required: true,
};

// Side options for Sea Turtle.
const TURTLE_SIDE_OPTIONS = ["Right", "Left", "Above"];

// Upload methods for Citizen Science.
const CITIZEN_SCIENCE_METHODS = ["Facebook", "WhatsApp"];

// --- Survey definitions ---
// Each survey contains:
//   key           — internal id (kebab-case)
//   label         — display name
//   driveFolderId — Google Drive root folder for this survey
//   theme         — CSS custom-property values for theming
//   folder        — fields + template that compose the subfolder name
//   photo         — fields + template per photo
//   masterSheet   — optional, only Citizen Science uses it
const SURVEYS = [
  {
    key: "sea-turtle",
    label: "Sea Turtle Research",
    driveFolderId: "1JakII_tWB7lDW5Zhu8hX-nPx14HdOroQ",
    theme: {
      accent: "#2d7a72",
      accent2: "#4fa697",
      accentSoft: "#d6ebe5",
      brandVivid: "#3ec0a8",
      shadow: "rgba(45, 122, 114, 0.18)",
    },
    folder: {
      fields: [
        { name: "surveyDate", label: "Survey Date", type: "date", required: true },
        { name: "surveySite", label: "Survey Site", type: "text", required: true },
        FIELD_UPLOADED_BY,
      ],
      template: "{surveyDate}-{surveySite}-{uploadedBy}",
    },
    photo: {
      sequence: { field: "turtleNumber", continueFromFolder: false },
      fields: [
        {
          name: "side",
          label: "Side",
          type: "select-or-other",
          options: TURTLE_SIDE_OPTIONS,
          required: true,
        },
        { name: "note", label: "Note", type: "text", placeholder: "e.g. propellor damage, feeding, remora" },
        { name: "turtleName", label: "Name of Turtle (if known)", type: "text", placeholder: "Leave blank if unnamed" },
      ],
      template: "{turtleNumber}-{side}[-{note}][-{turtleName}]",
    },
  },
  {
    key: "shark-research",
    label: "Shark Research",
    driveFolderId: "1aJzi0DkXDnz1ziQU0M2q9nHdEyv02HIy",
    theme: {
      accent: "#2d8fb0",
      accent2: "#65bcd0",
      accentSoft: "#d6edf3",
      brandVivid: "#44c6d8",
      shadow: "rgba(45, 143, 176, 0.20)",
    },
    folder: {
      fields: [
        { name: "surveyDate", label: "Survey Date", type: "date", required: true },
        { name: "surveySite", label: "Survey Site", type: "text", required: true },
        FIELD_UPLOADED_BY,
      ],
      template: "{surveyDate}-{surveySite}-{uploadedBy}",
    },
    photo: {
      fields: [
        {
          name: "photoSubject",
          label: "Photo Subject",
          type: "text",
          required: true,
          placeholder: "e.g. Shark 1, Shark 2, Eagle Ray",
        },
        {
          name: "note",
          label: "Note",
          type: "text",
          placeholder: "e.g. Scarring on left side, Parasite in eye",
        },
      ],
      template: "{photoSubject}[-{note}]",
    },
  },
  {
    key: "shark-citizen-science",
    label: "Shark Citizen Science",
    driveFolderId: "18iAb0lwRkmYskDRI2gREKc5_LxiwOtDR",
    // Matches Shark Research palette per spec.
    theme: {
      accent: "#2d8fb0",
      accent2: "#65bcd0",
      accentSoft: "#d6edf3",
      brandVivid: "#44c6d8",
      shadow: "rgba(45, 143, 176, 0.20)",
    },
    folder: {
      fields: [
        { name: "date", label: "Date", type: "date", required: true },
        { name: "site", label: "Site", type: "text", required: true },
        {
          name: "uploadMethod",
          label: "Upload Method",
          type: "select-or-other",
          options: CITIZEN_SCIENCE_METHODS,
          required: true,
        },
      ],
      template: "{date}-{site}-{uploadMethod}",
    },
    photo: {
      sequence: { field: "number", continueFromFolder: true },
      fields: [
        { name: "note", label: "Note", type: "text", placeholder: "e.g. scarring, propellor damage, behaviour" },
        FIELD_SUBMITTED_BY,
      ],
      template: "{number}[-{note}]-{submittedBy}",
    },
    masterSheet: {
      // App creates the sheet on first use inside this folder.
      parentFolderId: "18iAb0lwRkmYskDRI2gREKc5_LxiwOtDR",
      title: "Shark Citizen Science Master Log",
      // localStorage key where the created Sheet ID is cached after creation.
      storageKey: "btc-photo-uploader:citizen-science-sheet-id",
      headers: [
        "Date",
        "Site",
        "Submission Method",
        "Submitted By",
        "Depth",
        "Time",
        "Approximate Size",
        "Number of Sharks Seen Total",
        "Number of Photos",
        "Note",
        "Drive Folder",
        "Logged At",
      ],
      fields: [
        { name: "depth", label: "Depth", type: "text", placeholder: "e.g. 12m" },
        { name: "time", label: "Time", type: "time" },
        { name: "approximateSize", label: "Approximate Size", type: "text", placeholder: "e.g. 2m" },
        { name: "sharksSeenTotal", label: "Number of Sharks Seen Total", type: "number", min: 0 },
        { name: "submissionNote", label: "Note (submission summary)", type: "textarea", placeholder: "Scarring, parasite, behaviour, …" },
      ],
    },
  },
  {
    key: "sea-slug",
    label: "Sea Slug Survey",
    driveFolderId: "1r8Rg1qAuSlQ2tzTXFyUdXQ7DBHniontz",
    theme: {
      accent: "#1f5a4a",
      accent2: "#3d8275",
      accentSoft: "#c5dcd4",
      brandVivid: "#2d9c80",
      shadow: "rgba(31, 90, 74, 0.20)",
    },
    folder: {
      fields: [
        { name: "date", label: "Date", type: "date", required: true },
        { name: "site1", label: "Site 1", type: "text", required: true },
        { name: "site2", label: "Site 2", type: "text", required: false, placeholder: "Optional — leave blank if only one site" },
      ],
      template: "{date}-{site1}[-{site2}]",
    },
    photo: {
      fields: [
        { name: "slugNumber", label: "Slug Number", type: "auto-increment-text", required: true, placeholder: "e.g. 1417" },
        { name: "genus", label: "Genus", type: "text", required: true, placeholder: "e.g. Phyllidia (only first letter is used)" },
        { name: "species", label: "Species", type: "text", required: true, placeholder: "e.g. Varicosa" },
      ],
      // {genus|initial} transforms Genus into its first letter only.
      template: "{slugNumber}-{genus|initial}-{species}",
    },
  },
  {
    key: "crown-of-thorns",
    label: "Crown of Thorns Survey",
    driveFolderId: "15OC7c0X0yLo75MbwKu2xokg8veGyMqjM",
    theme: {
      accent: "#6fb3a5",
      accent2: "#9dcfc4",
      accentSoft: "#e7f3ef",
      brandVivid: "#7fd0bc",
      shadow: "rgba(111, 179, 165, 0.24)",
    },
    folder: {
      fields: [
        { name: "date", label: "Date", type: "date", required: true },
        { name: "site1", label: "Site 1", type: "text", required: true },
        { name: "site2", label: "Site 2", type: "text", required: false, placeholder: "Optional — leave blank if only one site" },
        FIELD_UPLOADED_BY,
      ],
      template: "{date}-{site1}[-{site2}]-{uploadedBy}",
    },
    photo: {
      sequence: { field: "number", continueFromFolder: true },
      fields: [
        { name: "note", label: "Note", type: "text", placeholder: "e.g. damaged, recovering, cluster, substrate, predated" },
      ],
      template: "{number}[-{note}]",
    },
  },
];

// Expose to app.js
window.BTC_CONFIG = {
  OAUTH_CLIENT_ID,
  TEAM_MEMBERS,
  SURVEYS,
};
