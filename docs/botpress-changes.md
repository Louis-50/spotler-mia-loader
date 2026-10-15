# Botpress (Mia) change log

The bot lives in Botpress Studio, not in this repo. This file records what was changed there and why, so the changes can be found and checked later. Edits were made through Claude in Chrome, reviewed by Louis, and published by Louis.

## 15 Oct 2026: AI disclosure and privacy (Russell Flawn's request)

### Round 1: greetings and hand-off wording (published 11:21)

| Where | Before | After |
|---|---|---|
| flow-en-gb › en_gb1, flow-int › int (greeting cards) | "Hi {{firstName}}, I'm the Spotler Agent👋 What brings you to Spotler today? …" | "Hi, I'm Mia, Spotler's AI assistant. I can answer questions about our products and help you book a demo, or point you to a colleague." |
| flow-nl › NL (greeting card) | "Hoi {{firstName}}, ik ben de Spotler Agent 👋 …" | "Hoi, ik ben Mia, de AI-assistent van Spotler. Ik beantwoord vragen over onze producten, help je met een demo-afspraak of verwijs je door naar een collega." |
| flow-en-gb-FeedbackPro › Standard1 (route C) | "Hey, I'm Mia. I know FeedbackPro inside out." | "Hi, I'm Mia, Spotler's AI assistant. I know FeedbackPro inside out." (+ the matching quote in FeedbackPro_LLM) |
| flow-en-gb-campaign › Standard1 (route B, Mail+) | "You clicked to see how it all comes together…" + video | Video removed; "Hi, I'm Mia, Spotler's AI assistant 👋 I know Mail+ inside out." |
| General nodes and Help Center (UK/INT/NL) | "the team will be in touch", "someone from the team can pick this up", "offer a … human follow-up" | "a colleague can follow up by email" (NL "een collega kan je per e-mail opvolgen"); the unfulfilled "list of companies" promise removed |
| FeedbackPro_LLM, campaign General_Knowlage1 | "Never volunteer that you are AI" | "You are Spotler's AI assistant. If asked, always say clearly that you are an AI, not a person. Never promise that a human will take over the chat." |
| Help Center (9 product nodes × UK/INT/NL) | "My colleague, Nova … her …" | "Our AI help assistant Nova …" |

### Round 2: AI-written wording, email capture, return-path bug (published 15 Oct)

The tests showed that the hand-off sentences came from the AI, not from fixed cards, so the fixes are prompt rules.

| Where | Change |
|---|---|
| flow-en-gb General2, flow-nl General1 | Replaced "If asked whether you are AI, say: 'Yes, an AI assistant…'" with: answer directly, e.g. "No, I'm not a person. I'm Mia, Spotler's AI assistant." (NL "Nee, ik ben geen persoon…"); only start with "Yes" if asked "Are you an AI/bot?" |
| flow-int General1, leaner_model1 | Same instruction added (there was none) |
| All reply-writing AI nodes (General, Pricing nodes, company-fit, Help Center Autonomous1 UK/INT/NL) | Rules: never say you will connect, transfer or put the visitor through to a person, or that someone will contact them; no greeting or self-introduction mid-conversation; say clearly you are an AI when asked. Later reworded so helping the visitor book a demo is allowed |
| flow-int Pricing / flow-nl Pricing1 | "happy to book you a quick call" → "you can book a short demo call with our team" (NL "…kun je een korte demo-afspraak met ons team inplannen") |
| General nodes (EN/INT) | "…or someone to discuss your setup with?" → "…or would you like to contact our sales team about your setup?" (NL "…contact opnemen met sales…") |
| Support question (EN/INT/NL) | "This needs hands-on product support. Want me to send you over?" → "Our Help Center can help with this. Want me to send you there?" (NL "Ons Helpcentrum helpt je hier verder mee. Zal ik je ernaartoe sturen?") |
| General nodes (all four) | Nova line: "Nova is Spotler's AI help assistant in the Help Center…" |
| 12 demo email capture cards (en-gb Demo1; INT Marley_Caston, SendPro_Nick_van_Dijk1, Mailplus_Manuela_Crielard1, Com_Cloud_Boris_Mileusnic1, Activate_Sjoerd_de_Jong1, FeedbackPro_Ivo_Klein1; NL the same five owner nodes) | Retry message "That doesn't look like an email address… or type 'cancel'…" (NL "Dat lijkt geen e-mailadres…"); 1 retry; Handle failure on, with On Failure → that flow's General node |
| 8 code cards (FeedbackPro, campaign and 3 Videos Back_to_INT; Help Center UK Standard2, NL Standard1, INT Standard2) | `user.skipgreeting = true` → `user.skipgreeting = 'true'`. The Entry nodes compare against the text `'true'`, so the main greeting used to reappear mid-conversation |
| flow-en-gb Standard1, flow-int Standard2 | Grammar: "Please type your company website below and I'll see what would work best for your setup." |
| flow-en-gb Standard1 | On Failure path re-pointed to General2 (it pointed to a missing INT node) |
| Help Center NL CRM card | Link given `https://` |
| **Help Center UK Autonomous1** | **Deleted by accident and rebuilt by hand**: same instructions (plus the new rules) and the same 11 exits; knowledge base set to *INT Knowledge Base* (same as INT and NL). The Entry "always" path now points to the new node |

### Round 3: privacy line, booking confirmation, link (published 15 Oct)

| Where | Change |
|---|---|
| The 12 demo email capture nodes | New Text card directly before the email question with Russell's line and the region's privacy link: EN/INT "I'll use your email to follow up on this conversation, for example to book your demo. Chats are stored and handled by our chat provider. More: Privacy statement"; NL "Ik gebruik je e-mailadres om op dit gesprek terug te komen… Meer info: Privacyverklaring" |
| All AI nodes that may ask for an email (EN ×8, INT ×8, NL ×8, campaign, FeedbackPro, Help Center ×3) | Rule: whenever you ask for the visitor's email, include the privacy sentence word for word (region text) |
| `booking_event` hook (before_incoming) | Also stores `user.demoBookedDateFormatted` and `user.demoBookedTime` from the `demoBooked` event |
| Booking confirmation (en-gb General2, INT General1 and leaner_model1, NL General1) | "a demo for is booked in with on ." (empty placeholders) → "Your demo is booked with {owner} on {date} at {time}. A confirmation has been sent to {email}." (NL "Je demo is ingepland met … op … om …"), leaving out any missing part |
| Help Center UK CRM card | `activatepro.spotler.help/hc/en-gb` → `https://crm.spotler.help/hc/en-gb` (the ActivatePro card keeps its own link) |

Not changed on purpose: the Entry-node skip-greeting logic, the Language Gate, the Webchat settings (the website tag overrides name, description and footer), the demo email questions themselves, and the Followup1 prompts.

## Facts about the bot (from the 15 Oct inventory)

- **Language Gate:** serves `en-GB`, `nl` and `int` only. INT answers in the visitor's language; the Translator Agent is off.
- **Skip greeting:** the Entry node skips when `user.skipgreeting === 'true'` or `user.proactiveBypassGreeting === true`. Main › Standard10 sets the latter from `proactiveClickAt` (fresh = under 15 s).
- **Inactivity timeout:** 20 min (Timeout workflow). The transcript email goes to two named staff, and only if an email was captured.
- **No live human hand-off:** the HITL agent isn't installed.
- **Models:** Fast = GPT-4.1 Mini, Best = GPT-4.1 (autonomous nodes and knowledge base), fallback Gemini 2.0 Flash. Claude Sonnet runs the General nodes; Claude Opus runs FeedbackPro_LLM and campaign General_Knowlage1. GPT-4o is used for vision.
- **Integrations receiving conversation data:** plus/email-notifier, agi/improvement (every AI turn), browser (company web search), webchat, notion-kb, webhook (installed), Leadinfo (company tag; dashboard name = visitor email). There's no HubSpot integration: the calendar runs through the website tag.
