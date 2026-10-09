/* ==================================================================
   00 · Settings
   Everything a person might need to change in code lives here.
   Page openers, buttons, teasers and display modes do NOT live here:
   they come from config.json (the n8n page table). DEFAULT_ROWS below
   are only the fallback used when config.json can't be loaded.
   ================================================================== */
var SETTINGS = {
  VERSION: "1.3.5",

  // ---- Page table (published by n8n) ----
  // Tried in order. GitHub's own copy is live within ~5 minutes of a commit;
  // jsDelivr's @main alias can stay on an old commit for hours even after a
  // purge, so it is only the backup.
  CONFIG_URLS: [
    "https://raw.githubusercontent.com/Louis-50/spotler-mia-loader/main/config/config.json",
    "https://cdn.jsdelivr.net/gh/Louis-50/spotler-mia-loader@main/config/config.json"
  ],
  CONFIG_WAIT_MS: 1500,           // first visit: show the built-in default after this

  // ---- Botpress ----
  INJECT_URL: "https://cdn.botpress.cloud/webchat/v3.7/inject.js",
  BOT_CONFIG_URL: "https://files.bpcontent.cloud/2026/05/27/14/20260527141930-9RFHOWXE.js",
  CDN_ORIGINS: ["https://cdn.botpress.cloud", "https://files.bpcontent.cloud", "https://raw.githubusercontent.com"],

  // ---- Conversation lifecycle ----
  TIMEOUT_MS: 15 * 60 * 1000,     // must equal the Botpress inactivity timeout
  TIMEOUT_CHECK_MS: 30 * 1000,
  FORCE_SEND_MS: 4000,            // send the first message even if no conversation event came
  SAFETY_REVEAL_MS: 30000,        // reveal live Botpress even if no reply came (slow LLM)

  // ---- Rollout switch: regions the tag is allowed to run in.
  // config.json can override this with "enabledRegions" (emergency off-switch:
  // e.g. ["en-GB"] turns NL and INT off again without a GTM publish).
  ENABLED_REGIONS: ["en-GB", "nl", "int"],

  // ---- Slide-out panel ----
  DESKTOP_MIN_WIDTH: 1200,
  PANEL_WIDTH_WIDE: 400,          // at 1600px viewport and wider
  PANEL_WIDTH: 360,
  DEFAULT_BANNER_PX: 40,
  TEASER_DELAY_MS: 4000,
  TEASER_HIDE_MS: 25000,

  HALF_MIN_WIDTH: 1024,           // half-page card: laptops and up, never phones/tablets

  // Paths the new tag must leave alone (e.g. a page still on an old tag).
  // Pause the old campaign/slide-out tags when this tag goes live.
  LEGACY_EXCLUDE: [],

  // ---- Regions: first match wins, last entry is the fallback ----
  REGIONS: [
    { id: "nl",    test: /^\/nl-nl(\/|$)/i, language: "nl" },
    { id: "en-GB", test: /^\/en-gb(\/|$)/i, language: "en-GB" },
    // Other locales (/de-de, /en-de, /es-es, /sv-se, /en-au …) have no chat.
    { id: "none",  test: /^\/[a-z]{2}-[a-z]{2}(\/|$)/i },
    { id: "int",   test: /.*/,               language: "int" }
  ],

  // ---- Labels (naming is still undecided: change here) ----
  LABELS: {
    "en-GB": { title: "Spotler Assistant", pill: "Ask Mia", placeholder: "Ask Mia a question...",
               restart: "Restart conversation", close: "Close chat", dismiss: "Dismiss", today: "Today", delivered: "Delivered",
               botName: "Mia", botTagline: "Your Marketing Intelligence Assistant.",
               powered: "Powered by Spotler AI", calCancel: "Cancel", calTitle: "Book a meeting", calIntro: "Pick a time that works for you." },
    "int":   { title: "Spotler Assistant", pill: "Ask Mia", placeholder: "Ask Mia a question...",
               restart: "Restart conversation", close: "Close chat", dismiss: "Dismiss", today: "Today", delivered: "Delivered",
               botName: "Mia", botTagline: "Your Marketing Intelligence Assistant.",
               powered: "Powered by Spotler AI", calCancel: "Cancel", calTitle: "Book a meeting", calIntro: "Pick a time that works for you." },
    "nl":    { title: "Spotler Assistent", pill: "Vraag het Mia", placeholder: "Stel Mia een vraag...",
               restart: "Gesprek opnieuw starten", close: "Chat sluiten", dismiss: "Sluiten", today: "Today", delivered: "Delivered",
               botName: "Mia", botTagline: "Your Marketing Intelligence Assistant.",
               powered: "Powered by Spotler AI", calCancel: "Annuleren", calTitle: "Plan een afspraak", calIntro: "Kies een moment dat jou uitkomt." }
  },

  AVATAR_URL: "https://files.bpcontent.cloud/2026/08/20/13/20260820133357-6Q65P1JX.webp",

  // ---- Built-in fallback rows (used only if config.json is unavailable) ----
  // Blank line in an opener = a new bubble. Buttons attach to the last bubble.
  DEFAULT_ROWS: [
    { url_match: "*", region: "en-GB", mode: "slideout", page: "default",
      opener: "Hi , I'm the Spotler Agent👋 What brings you to Spotler today?\nAsk me anything related to marketing and/or communication.\n\nType your question or just make a choice from the list below",
      buttons: [
        { label: "What can Spotler do for me?", send: "What can Spotler do for me?" },
        { label: "Book a demo", send: "Book a demo" },
        { label: "See pricing", send: "See pricing" },
        { label: "Product support", send: "Product support" }
      ],
      teaser_text: "Questions about Spotler? Ask me anything!",
      teaser_send: "I have a question about Spotler" },
    { url_match: "*", region: "int", mode: "slideout", page: "default",
      opener: "Hi, I'm the Spotler Agent👋 What brings you to Spotler today?\nAsk me anything related to marketing and/or communication.\n\nType your question or just make a choice from the list below",
      buttons: [
        { label: "What can Spotler do for me?", send: "What can Spotler do for me?" },
        { label: "Book a demo", send: "Book a demo" },
        { label: "Product support", send: "Product support" },
        { label: "Pricing", send: "Pricing" }
      ],
      teaser_text: "Questions about Spotler? Ask me anything!",
      teaser_send: "I have a question about Spotler" },
    { url_match: "*", region: "nl", mode: "slideout", page: "default",
      opener: "Hoi, ik ben de Spotler Agent 👋 Wat brengt je vandaag naar Spotler?\nStel me gerust een vraag over marketing en/of communicatie.\n\nTyp je vraag of maak een keuze uit de onderstaande lijst",
      buttons: [
        { label: "Wat kan Spotler voor mij betekenen?", send: "Wat kan Spotler voor mij betekenen?" },
        { label: "Een demo boeken", send: "Een demo boeken" },
        { label: "Bekijk prijzen", send: "Bekijk prijzen" },
        { label: "Productondersteuning", send: "Productondersteuning" }
      ],
      teaser_text: "Vragen over Spotler? Vraag maar raak!",
      teaser_send: "Ik heb een vraag over Spotler" }
  ]
};
