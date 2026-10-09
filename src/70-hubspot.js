/* ==================================================================
   70 · HubSpot calendar + booking report
   Ported VERBATIM from the live INT slide-out tag (2 Oct 2026), so the
   booking flow behaves exactly as today. Called once, after the Botpress
   SDK event API exists and BEFORE the bot config loads, so its
   customEvent / message listeners are attached in time.
   Markup lives in 70-hubspot.html.
   ================================================================== */
function initHubSpot() {
  if (initHubSpot.done) return;
  initHubSpot.done = true;
    // ================================================================
    // HubSpot calendar — prefills the booking form from the visitor's
    // email, guessing first/last name and company where HubSpot hasn't
    // supplied them.
    // ================================================================
    var hsCurrentKey = null;
    var hsLastEmail = null;
    var hsLastOwnerSlug = null;
    var bookingReported = false;

    var OWNER_EMAILS = { "isabelle-chadwick": "isabelle.chadwick@spotler.com" };
    var OWNER_NAMES  = { "isabelle-chadwick": "Isabelle Chadwick" };

    var FREE_MAIL_DOMAINS = [
      "gmail", "googlemail", "hotmail", "outlook", "live", "yahoo",
      "icloud", "me", "aol", "protonmail", "proton", "gmx", "mail",
      "msn", "ymail", "hey", "zoho"
    ];

    function titleCase(s) {
      return s.replace(/(^|[\s'-])([a-z])/g, function (m, sep, ch) {
        return sep + ch.toUpperCase();
      });
    }

    function guessFromEmail(email) {
      var guess = { firstName: "", lastName: "", company: "" };
      if (!email || email.indexOf("@") === -1) return guess;

      var parts = email.toLowerCase().split("@");
      var local = parts[0].replace(/\d+/g, "");
      var domain = parts[1] || "";

      var nameParts = local.split(/[._-]+/).filter(Boolean);
      if (nameParts.length >= 2) {
        guess.firstName = titleCase(nameParts[0]);
        guess.lastName = titleCase(nameParts[nameParts.length - 1]);
      } else if (nameParts.length === 1 && nameParts[0].length > 1) {
        guess.firstName = titleCase(nameParts[0]);
      }

      var domainBase = domain.replace(/^www\./, "").split(".")[0];
      if (domainBase && FREE_MAIL_DOMAINS.indexOf(domainBase) === -1) {
        guess.company = titleCase(domainBase.replace(/[-_]+/g, " "));
      }
      return guess;
    }

    var CALENDAR_CONTACT_KEY = "spotler_calendar_contact";

    function asCleanString(value) {
      if (value === null || value === undefined) return "";
      if (typeof value !== "string" && typeof value !== "number") return "";
      return String(value).trim();
    }

    function maybeJson(value) {
      if (typeof value !== "string") return value;
      var text = value.trim();
      if (!text || ((text.charAt(0) !== "{" || text.charAt(text.length - 1) !== "}") &&
                    (text.charAt(0) !== "[" || text.charAt(text.length - 1) !== "]"))) {
        return value;
      }
      try { return JSON.parse(text); } catch (err) { return value; }
    }

    function mergeCalendarContact(target, source) {
      target = target || { email: "", firstName: "", lastName: "", company: "" };
      source = source || {};
      if (!target.email && source.email) target.email = asCleanString(source.email);
      if (!target.firstName && source.firstName) target.firstName = asCleanString(source.firstName);
      if (!target.lastName && source.lastName) target.lastName = asCleanString(source.lastName);
      if (!target.company && source.company) target.company = asCleanString(source.company);
      return target;
    }

    function contactFromAnything(raw) {
      var result = { email: "", firstName: "", lastName: "", company: "" };
      var fullName = "";
      var seen = [];

      function firstValue(obj, keys) {
        for (var i = 0; i < keys.length; i++) {
          var v = asCleanString(obj[keys[i]]);
          if (v) return v;
        }
        return "";
      }

      function visit(value, depth) {
        if (depth > 4 || value === null || value === undefined) return;
        value = maybeJson(value);

        if (typeof value === "string") {
          var exactEmail = value.trim().match(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i);
          if (exactEmail && !result.email) result.email = exactEmail[0];
          return;
        }
        if (typeof value !== "object") return;
        if (seen.indexOf(value) !== -1) return;
        seen.push(value);

        if (!result.email) {
          result.email = firstValue(value, [
            "email", "userEmail", "contactEmail", "emailAddress", "user_email", "contact_email"
          ]);
        }
        if (!result.firstName) {
          result.firstName = firstValue(value, [
            "firstName", "firstname", "first_name", "userFirstName", "givenName", "given_name"
          ]);
        }
        if (!result.lastName) {
          result.lastName = firstValue(value, [
            "lastName", "lastname", "last_name", "userLastName", "surname", "familyName", "family_name"
          ]);
        }
        if (!result.company) {
          result.company = firstValue(value, [
            "company", "userCompany", "companyName", "company_name", "organisation", "organization"
          ]);
        }
        if (!fullName) {
          fullName = firstValue(value, ["name", "userName", "fullName", "full_name"]);
        }

        var nestedKeys = [
          "contact", "data", "payload", "user", "userData", "profile",
          "properties", "details", "visitor", "event"
        ];
        for (var j = 0; j < nestedKeys.length; j++) {
          if (value[nestedKeys[j]] !== undefined) visit(value[nestedKeys[j]], depth + 1);
        }
      }

      visit(raw, 0);

      if (fullName && (!result.firstName || !result.lastName)) {
        var bits = fullName.split(/\s+/).filter(Boolean);
        if (!result.firstName && bits.length) result.firstName = bits[0];
        if (!result.lastName && bits.length > 1) result.lastName = bits.slice(1).join(" ");
      }

      if (result.email) {
        var guessed = guessFromEmail(result.email);
        if (!result.firstName) result.firstName = guessed.firstName;
        if (!result.lastName) result.lastName = guessed.lastName;
        if (!result.company) result.company = guessed.company;
      }

      return result;
    }

    function loadCachedCalendarContact() {
      try {
        var raw = sessionStorage.getItem(CALENDAR_CONTACT_KEY);
        return raw ? contactFromAnything(JSON.parse(raw)) : { email: "", firstName: "", lastName: "", company: "" };
      } catch (err) {
        return { email: "", firstName: "", lastName: "", company: "" };
      }
    }

    function saveCachedCalendarContact(contact) {
      if (!contact) return;
      try {
        sessionStorage.setItem(CALENDAR_CONTACT_KEY, JSON.stringify({
          email: contact.email || "",
          firstName: contact.firstName || "",
          lastName: contact.lastName || "",
          company: contact.company || ""
        }));
      } catch (err) {}
    }

    // The visitor normally types their email as a standalone chat message just
    // before the calendar opens. Cache that value as a regional-flow fallback.
    // We deliberately only accept a string that is exactly an email address so
    // an email mentioned by Mia cannot accidentally become the visitor email.
    function findStandaloneEmail(value, depth, seen) {
      if (depth > 7 || value === null || value === undefined) return "";

      // Some Webchat versions serialize nested payloads. Parse JSON-looking
      // strings before testing them as plain message text.
      value = maybeJson(value);

      if (typeof value === "string") {
        var match = value.trim().match(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i);
        return match ? match[0] : "";
      }
      if (typeof value !== "object") return "";

      seen = seen || [];
      if (seen.indexOf(value) !== -1) return "";
      seen.push(value);

      if (Array.isArray(value)) {
        for (var a = value.length - 1; a >= 0; a--) {
          var arrayFound = findStandaloneEmail(value[a], depth + 1, seen);
          if (arrayFound) return arrayFound;
        }
        return "";
      }

      var priorityKeys = [
        "text", "value", "message", "content", "payload", "data",
        "block", "blocks", "items", "event", "input", "raw"
      ];
      for (var i = 0; i < priorityKeys.length; i++) {
        if (value[priorityKeys[i]] !== undefined) {
          var found = findStandaloneEmail(value[priorityKeys[i]], depth + 1, seen);
          if (found) return found;
        }
      }

      // Final compatibility pass for message shapes we do not know about yet.
      // Only exact email strings are accepted, so walking the remaining fields
      // cannot accidentally cache ordinary bot copy.
      for (var key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (priorityKeys.indexOf(key) !== -1) continue;
        var genericFound = findStandaloneEmail(value[key], depth + 1, seen);
        if (genericFound) return genericFound;
      }
      return "";
    }

    function findLatestEmailInWebchat() {
      var host = document.getElementById("bp-embedded-webchat");
      if (!host) return "";

      var emails = [];
      var seenRoots = [];

      function addText(text) {
        if (!text) return;
        var matches = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
        for (var i = 0; i < matches.length; i++) emails.push(matches[i]);
      }

      function scanRoot(root) {
        if (!root || !root.querySelectorAll || seenRoots.indexOf(root) !== -1) return;
        seenRoots.push(root);

        // Prefer visitor/outgoing message bubbles when Botpress exposes the
        // direction attribute. This is the same rendered message the visitor
        // can see in the chat, so it is a reliable fallback when the event
        // payload itself does not include the typed text.
        var outgoing = root.querySelectorAll(
          '[data-direction="outgoing"], [data-direction="user"], ' +
          '.bpMessageContainer[data-direction="outgoing"], ' +
          '.bpMessageContainer[data-direction="user"]'
        );
        for (var o = 0; o < outgoing.length; o++) addText(outgoing[o].textContent);

        var all = root.querySelectorAll("*");
        for (var j = 0; j < all.length; j++) {
          if (all[j].shadowRoot) scanRoot(all[j].shadowRoot);
        }
      }

      scanRoot(host);

      // If the current Webchat build does not expose direction attributes,
      // fall back to the host text. We choose the final email because the
      // booking flow asks for the visitor email immediately before opening the
      // calendar.
      if (!emails.length) addText(host.textContent);

      return emails.length ? emails[emails.length - 1] : "";
    }

    function cacheCalendarEmail(email) {
      if (!email) return loadCachedCalendarContact();
      var cached = loadCachedCalendarContact();
      cached.email = email;
      cached = contactFromAnything(cached);
      saveCachedCalendarContact(cached);
      return cached;
    }

    try {
      window.botpress.on("message", function (message) {
        var email = findStandaloneEmail(message, 0, []);
        if (!email) email = findLatestEmailInWebchat();
        if (!email) return;
        cacheCalendarEmail(email);
        console.log("[HS] cached visitor email for calendar prefill");
      });
    } catch (e) {}

    function buildCalendarUrl(url, contact) {
      var parsed;
      try {
        parsed = new URL(url, window.location.href);
      } catch (err) {
        console.warn("[HS] Invalid meeting URL:", url, err);
        return url;
      }

      parsed.searchParams.set("embed", "true");

      if (contact && contact.email) {
        var guessed = guessFromEmail(contact.email);
        var firstName = contact.firstName || contact.firstname || guessed.firstName;
        var lastName  = contact.lastName  || contact.lastname  || guessed.lastName;
        var company   = contact.company   || guessed.company;

        // HubSpot meeting links use CRM property internal names in the query
        // string: email, firstname, lastname and company.
        parsed.searchParams.set("email", contact.email);
        parsed.searchParams.delete("firstName");
        parsed.searchParams.delete("lastName");
        if (firstName) parsed.searchParams.set("firstname", firstName);
        if (lastName)  parsed.searchParams.set("lastname", lastName);
        if (company)   parsed.searchParams.set("company", company);
      }

      return parsed.toString();
    }

    function unwrapCustomEvent(raw) {
      var data = maybeJson(raw);
      if (!data || typeof data !== "object") return {};

      // Botpress can expose a custom event directly, or wrapped/serialized in
      // an `event` field depending on how the Studio card was configured.
      if (data.event !== undefined) {
        var inner = maybeJson(data.event);
        if (inner && typeof inner === "object") {
          var merged = {};
          for (var k in data) {
            if (Object.prototype.hasOwnProperty.call(data, k) && k !== "event") merged[k] = data[k];
          }
          for (var k2 in inner) {
            if (Object.prototype.hasOwnProperty.call(inner, k2)) merged[k2] = inner[k2];
          }
          data = merged;
        }
      }
      return data;
    }

    function contactFromCalendarEvent(event) {
      return contactFromAnything(event);
    }

    function resolveCalendarContact(event) {
      var contact = mergeCalendarContact(contactFromCalendarEvent(event), loadCachedCalendarContact());

      // Regional Studio flows do not always copy the visitor's typed email into
      // the show-calendar custom event. Read the latest rendered visitor email
      // directly from Webchat as a browser-side fallback before opening HubSpot.
      if (!contact.email) {
        var renderedEmail = findLatestEmailInWebchat();
        if (renderedEmail) contact = mergeCalendarContact(contact, cacheCalendarEmail(renderedEmail));
      }

      contact = contactFromAnything(contact);

      // If the custom event omitted contact fields, use Botpress' current user
      // profile as another fallback. getUser() is a documented Webchat method.
      if (contact.email && contact.firstName && contact.lastName && contact.company) {
        saveCachedCalendarContact(contact);
        return Promise.resolve(contact);
      }

      if (!window.botpress || typeof window.botpress.getUser !== "function") {
        saveCachedCalendarContact(contact);
        return Promise.resolve(contact);
      }

      var userPromise;
      try {
        userPromise = Promise.resolve(window.botpress.getUser())
          .then(function (user) {
            contact = mergeCalendarContact(contact, contactFromAnything(user));
            if (!contact.email) {
              var renderedEmail = findLatestEmailInWebchat();
              if (renderedEmail) contact = mergeCalendarContact(contact, cacheCalendarEmail(renderedEmail));
            }
            contact = contactFromAnything(contact);
            saveCachedCalendarContact(contact);
            return contact;
          })
          .catch(function () { return contact; });
      } catch (err) {
        return Promise.resolve(contact);
      }

      // Never hold the calendar open for a slow profile request.
      return Promise.race([
        userPromise,
        new Promise(function (resolve) {
          setTimeout(function () { resolve(contact); }, 650);
        })
      ]);
    }

    // ---- In-chat calendar ----
    // The scheduler opens inside the chat itself: the slide-out body (the
    // panel widens to fit) or the half/full card. The page modal is only
    // the fallback when there is no chat on the page.
    addStyle(CSS.hubspot);
    var cal = null;
    function chatHost() {
      return document.getElementById("spotler-agent-body") || document.getElementById("spotler-inline-body");
    }
    function inChatCalendar() {
      var host = chatHost();
      if (!host) return null;
      if (cal && cal.layer.parentNode === host) return cal;
      if (cal && cal.layer.parentNode) cal.layer.parentNode.removeChild(cal.layer);
      var l = (BP.ctx && BP.ctx.labels) || SETTINGS.LABELS["en-GB"];
      var layer = el("div", { id: "spotler-cal", role: "dialog", "aria-label": l.calTitle || "Book a meeting" });
      var root = layer.attachShadow ? layer.attachShadow({ mode: "open" }) : layer;
      addStyle(CSS.calendar, root);
      var back = el("button", { class: "back", type: "button", text: l.calCancel || "Cancel" });
      back.addEventListener("click", function () { closeCalendar(); });
      var stage = el("div", { class: "stage" });
      var loading = el("div", { class: "loading", "aria-hidden": "true" }, [el("i"), el("span", { text: l.calLoading || "Loading calendar..." })]);
      var card = el("div", { class: "card" }, [stage, loading]);
      var bar = el("div", { class: "bar" }, [back]);
      var ft = el("div", { class: "ft", text: l.powered || "" });
      var sheet = el("div", { class: "sheet" }, [card, bar, ft]);
      var view = el("div", { class: "c" }, [sheet]);
      root.appendChild(view);
      host.appendChild(layer);
      cal = { layer: layer, view: view, sheet: sheet, card: card, bar: bar, ft: ft, stage: stage, loading: loading, contentH: 0, iframe: null };
      return cal;
    }
    // Card height: HubSpot's own content height (it posts it), up to the
    // room the chat has; a compact loading card until then.
    function fitCalendar() {
      if (!cal || !cal.layer.classList.contains("on")) return;
      var room = cal.layer.offsetHeight;
      cal.view.classList.toggle("tight", room < 720);
      var chrome = cal.bar.offsetHeight + (cal.ft.offsetHeight ? cal.ft.offsetHeight + 10 : 8) + 20;
      var max = Math.max(160, room - chrome);
      var h = 132;
      if (cal.view.classList.contains("ready")) {
        var want = cal.contentH ? cal.contentH - 32 : (cal.card.offsetWidth < 600 ? 960 : 720);
        h = Math.min(Math.max(want, 240), max);
      }
      cal.card.style.height = Math.min(h, max) + "px";
    }
    window.addEventListener("resize", fitCalendar);
    window.addEventListener("message", function (e) {
      if (!cal || !cal.iframe || e.source !== cal.iframe.contentWindow) return;
      var d = e.data;
      if (typeof d === "string") { try { d = JSON.parse(d); } catch (err) { return; } }
      var h = d && (d.height || (d.meetingsHeight)) ;
      if (typeof h === "number" && h > 100) { cal.contentH = h; fitCalendar(); }
    });
    function openInChat(c) {
      c.layer.classList.add("on");
      c.view.classList.remove("shown");
      fitCalendar();
      void c.view.offsetWidth;             // start below, then slide up like a new message
      c.view.classList.add("shown");
      try { State.touch(); } catch (e) {}
    }
    function closeCalendar() {
      closeHubSpotModal();
      if (cal && cal.layer.classList.contains("on")) {
        var c = cal;
        c.view.classList.remove("shown");
        setTimeout(function () { if (!c.view.classList.contains("shown")) c.layer.classList.remove("on"); }, 320);
      }
    }
    // Closing the slide-out also closes the calendar.
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("#spotler-agent-close")) closeCalendar();
    }, true);

    var hsPreviousBodyOverflow = null;
    var hsPreviousHtmlOverflow = null;

    function openHubSpotModal() {
      var modal = document.getElementById("hubspot-modal");
      if (!modal) return;

      if (modal.style.display !== "flex") {
        hsPreviousBodyOverflow = document.body.style.overflow;
        hsPreviousHtmlOverflow = document.documentElement.style.overflow;
      }

      // Lock the website behind the modal. The modal itself never scrolls.
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      modal.style.display = "flex";

    }

    function closeHubSpotModal() {
      var modal = document.getElementById("hubspot-modal");
      if (modal) modal.style.display = "none";

      // Restore whatever the site had before the calendar opened.
      document.body.style.overflow = hsPreviousBodyOverflow === null ? "" : hsPreviousBodyOverflow;
      document.documentElement.style.overflow = hsPreviousHtmlOverflow === null ? "" : hsPreviousHtmlOverflow;
      hsPreviousBodyOverflow = null;
      hsPreviousHtmlOverflow = null;
    }

    window.spotlerCloseHubSpotModal = closeCalendar;

    function showCalendar(url, contact) {
      if (!url) return;

      bookingReported = false;
      hsLastEmail = (contact && contact.email) || hsLastEmail;
      try {
        var slug = new URL(url).pathname.split("/").filter(Boolean)[0] || null;
        if (slug) hsLastOwnerSlug = slug;
      } catch (err) { /* keep previous value */ }

      var c = inChatCalendar();
      var stage = c ? c.stage : document.getElementById("hubspot-iframe-stage");
      var loading = c ? c.loading : document.getElementById("hubspot-loading");
      var open = function () { if (c) openInChat(c); else openHubSpotModal(); };
      var fullUrl = buildCalendarUrl(url, contact);

      if (hsCurrentKey === fullUrl && stage && stage.querySelector("iframe")) {
        open();
        return;
      }

      hsCurrentKey = fullUrl;
      if (loading && !c) loading.style.display = "flex";
      if (!stage) return;

      stage.innerHTML = "";

      var iframe = document.createElement("iframe");
      iframe.src = fullUrl;
      iframe.title = "Book a meeting with Spotler";
      iframe.setAttribute("frameborder", "0");
      iframe.setAttribute("allowtransparency", "true");
      iframe.setAttribute("data-hs-ignore", "true");

      iframe.addEventListener("load", function () {
        if (c) { c.view.classList.add("ready"); fitCalendar(); }
        else if (loading) loading.style.display = "none";
      });
      if (c) { c.iframe = iframe; c.contentH = 0; c.view.classList.remove("ready"); }

      stage.appendChild(iframe);
      open();

      // Safety fallback in case the browser suppresses the iframe load event.
      setTimeout(function () {
        if (c) { c.view.classList.add("ready"); fitCalendar(); }
        else if (loading) loading.style.display = "none";
      }, 3500);
    }

    // === Listen for the bot's custom event to open the calendar ===
    try {
      window.botpress.on("customEvent", function (rawEvent) {
        var event = unwrapCustomEvent(rawEvent);
        if (event && event.action === "showHubSpotCalendar" && event.url) {
          resolveCalendarContact(event).then(function (contact) {
            console.log("[HS] calendar prefill:", {
              email: !!contact.email,
              firstName: !!contact.firstName,
              lastName: !!contact.lastName,
              company: !!contact.company
            });
            showCalendar(event.url, contact);
          });
        }
      });
    } catch (e) {}

    // === Detect successful bookings and report them to Botpress ===
    window.addEventListener("message", function (message) {
      var origin = message.origin || "";
      if (!/^https:\/\/meetings[^.]*\.hubspot\.com$/.test(origin)) return;

      if (message.data && message.data.meetingBookSucceeded && !bookingReported) {
        console.log('[BP] meetingBookSucceeded received from HubSpot');
        bookingReported = true;

        var mp = message.data.meetingsPayload || null;
        var ev = (mp && mp.bookingResponse) ? mp.bookingResponse.event : null;

        var bookedContact = (ev && ev.contact) ? ev.contact : null;
        var contactEmail = (bookedContact && bookedContact.email) || hsLastEmail || null;
        var guessed = guessFromEmail(contactEmail || "");
        var contactFirstName = (bookedContact && (bookedContact.firstName || bookedContact.firstname)) || guessed.firstName || null;
        var contactLastName  = (bookedContact && (bookedContact.lastName  || bookedContact.lastname))  || guessed.lastName  || null;
        var contactName = [contactFirstName, contactLastName].filter(Boolean).join(" ") || null;

        var ownerSlug = (mp && mp.userSlug) || hsLastOwnerSlug || null;

        var payload = {
          type: "demoBooked",
          booked: true,
          userEmail: contactEmail,
          userName: contactName,
          userFirstName: contactFirstName,
          userLastName: contactLastName,
          ownerSlug: ownerSlug,
          ownerEmail: (ownerSlug && OWNER_EMAILS[ownerSlug]) || null,
          ownerName: (ownerSlug && OWNER_NAMES[ownerSlug]) || null,
          meetingDate: null,
          meetingDateFormatted: null,
          meetingTime: null,
          meetingWhen: null
        };

        try {
          var raw = ev ? ev.dateString : null;
          if (raw) {
            payload.meetingDate = raw;
            var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
            if (m) payload.meetingDateFormatted = m[3] + "/" + m[2] + "/" + m[1];
          }
          var ts = ev ? Number(ev.dateTime) : NaN;
          if (ts && !isNaN(ts)) {
            var d = new Date(ts);
            payload.meetingTime =
              String(d.getHours()).padStart(2, "0") + ":" +
              String(d.getMinutes()).padStart(2, "0");
            if (!payload.meetingDateFormatted) {
              payload.meetingDateFormatted =
                String(d.getDate()).padStart(2, "0") + "/" +
                String(d.getMonth() + 1).padStart(2, "0") + "/" +
                d.getFullYear();
            }
          }
          if (payload.meetingDateFormatted) {
            payload.meetingWhen = payload.meetingDateFormatted +
              (payload.meetingTime ? " at " + payload.meetingTime : "");
          }
        } catch (err) {
          console.warn("[BP] Could not parse HubSpot booking details", err);
        }

        // The bot's flow sees demoBooked as a new event; with the click from
        // minutes ago no longer "fresh" its gate would run the greeting.
        // Refresh the skip-greeting flag first.
        try {
          if (window.botpress.updateUser) window.botpress.updateUser({ data: { proactiveClickAt: String(now()), proactiveTopic: "demoBooked" } });
        } catch (err) {}
        try { State.touch(); } catch (err) {}
        log("calendar: booking reported (conversation " + (SS.get("spotler_last_conversation_id") || "?") + ")");
        console.log('[BP] sending demoBooked to botpress:', JSON.stringify(payload));
        try {
          window.botpress.sendEvent(payload);
        } catch (err) {
          console.warn("[BP] demoBooked sendEvent failed", err);
        }

        // A beat to see HubSpot's confirmation, then back to the chat,
        // where the bot answers the demoBooked event.
        setTimeout(function () {
          closeCalendar();
          var modalStage = document.getElementById("hubspot-iframe-stage");
          if (modalStage) modalStage.innerHTML = "";
          if (cal) { cal.stage.innerHTML = ""; cal.iframe = null; }
          hsCurrentKey = null;
        }, 1500);
      }
    });

    // Escape key closes modal
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeCalendar();
      }
    });
  }
