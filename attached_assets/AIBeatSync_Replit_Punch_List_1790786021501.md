# AIBeatSync Replit punch list

## Goal

Improve first-visit trust, let prospects understand the product before signing up, and make pricing easier to evaluate. Complete the work in the order below so conversion blockers are fixed before broader growth work begins.

## Product rules for every change

- Preserve the existing image, music, video, authentication, credit, subscription, and Stripe flows unless a task explicitly changes one.
- Use only real AIBeatSync creations, customer activity, and usage data. Do not invent testimonials, customer counts, ratings, or output examples.
- Keep the experience clear for casual users; avoid creator-industry jargon where plain language works.
- Make every new section responsive and accessible on mobile and desktop.
- Confirm production Stripe price IDs and billing intervals before changing checkout behavior.

---

## Priority 0 — Fix trust and functional blockers

### 1. Make the trial offer consistent

**Problem:** The homepage promises a “7-day free trial,” while the fine print says trial accounts begin with zero credits. A visitor cannot tell what is actually free.

**Replit task:**

- Identify the real trial rules in the application and Stripe configuration.
- Choose one accurate offer and use the same wording on the homepage, pricing page, signup page, account creation flow, and checkout.
- If a trial includes usable generation credits, state the exact amount and what those credits can create.
- If a new account includes no generation credits, stop calling it a free trial. Use wording such as “Create a free account to explore AIBeatSync,” then clearly state when payment is required.
- Put key terms next to the primary call to action rather than hiding them in fine print.

**Acceptance criteria:**

- No page makes a promise that conflicts with account or billing behavior.
- A visitor can answer “What can I make for free?” without opening another page.
- Signup and checkout use the same trial language and terms.

### 2. Repair the annual pricing toggle

**Problem:** Switching to yearly billing does not update the visible prices.

**Replit task:**

- Make the monthly/yearly control update every displayed price, billing interval, savings message, and checkout selection.
- Verify that each displayed plan maps to the correct Stripe price ID.
- Preserve the selected billing interval when the visitor clicks a plan.
- Add an obvious selected state and keyboard support to the toggle.

**Acceptance criteria:**

- Monthly and annual prices change immediately without a page reload.
- The amount and interval shown before checkout match Stripe checkout.
- Refresh, browser back, mobile, and desktop behavior are tested.

### 3. Fix page titles and route metadata

**Problem:** The browser tab title does not update correctly when navigating through the single-page application.

**Replit task:**

- Add a unique HTML title and meta description for the homepage, image generator, music generator, video generator, pricing, gallery, login, and signup routes.
- Update metadata on client-side route changes.
- Add one canonical URL per public page and appropriate Open Graph title, description, and image metadata.
- Keep login, signup, account, and private application pages out of search results where appropriate.

**Acceptance criteria:**

- The browser title changes immediately on every route.
- View source or rendered metadata shows the correct title, description, and canonical URL.
- Shared links display the intended title and preview image.

### 4. Repair truncated signup copy

**Problem:** The signup page contains cut-off text beginning with “You also…”

**Replit task:**

- Find and repair the incomplete sentence or remove it if it adds no value.
- Check the full signup page at common mobile and desktop widths for clipping, overflow, and hidden text.
- Review validation, error, success, and loading states while on the page.

**Acceptance criteria:**

- No incomplete, clipped, or overlapping copy remains.
- The full signup path works on mobile and desktop.

---

## Priority 1 — Let visitors experience the product before signup

### 5. Add public music examples

**Problem:** Visitors cannot hear what the music generator produces before signing in.

**Replit task:**

- Add a public sample area to the music page using selected real AIBeatSync tracks.
- Show a play/pause control, track title, duration, and a short plain-language description of the prompt or style.
- Include three to six varied examples if suitable real tracks are available.
- Place a clear “Create your own music” call to action beside the samples.
- Keep generation behind signup if required, but do not hide product quality behind the account wall.

**Acceptance criteria:**

- Samples play without an account on desktop and mobile.
- Playback is accessible by keyboard and does not start automatically.
- Missing or failed audio has a clean fallback state.

### 6. Add public AI video examples

**Problem:** The video page sends visitors directly to login, so they cannot judge the output first.

**Replit task:**

- Replace the immediate login redirect for unauthenticated visitors with a public product page.
- Show selected real video examples, a short “how it works” section, basic credit expectations, and a signup call to action.
- After signup, return the user to the video creation flow rather than dropping them on a generic dashboard.
- Optimize previews so the page remains fast on mobile; use poster images and click-to-play rather than autoplay.

**Acceptance criteria:**

- An unauthenticated visitor can view examples and understand the video workflow.
- Clicking the creation call to action starts signup/login, then returns to video creation.
- Video previews do not autoplay and have captions when speech is present.

### 7. Bring real creations onto the homepage

**Problem:** The homepage has no visible social proof even though AIBeatSync has a community gallery and real outputs.

**Replit task:**

- Add a “Made with AIBeatSync” section near the top half of the homepage.
- Pull selected or approved items from the existing gallery rather than duplicating content manually.
- Include a useful mix of images, music, and video when real examples are available.
- Link each item to a preview or the relevant creation tool.
- Add testimonials only when they are genuine and permission has been obtained.

**Acceptance criteria:**

- The homepage shows real output before the pricing section.
- Empty and unavailable media states do not leave broken cards.
- No fabricated names, quotes, ratings, or usage totals are displayed.

### 8. Make the three product types obvious immediately

**Problem:** The all-in-one value is the strongest differentiator, but a new visitor should not have to explore the site to discover it.

**Replit task:**

- Rewrite the hero around one clear promise: create AI images, original music, and AI video in one place.
- Add three simple product cards or steps directly beneath the hero.
- Give each card one real example and one action-oriented link.
- Use a primary call to action that matches the actual trial/free-account rules from Item 1.

**Suggested hero direction:**

> Create images, original music, and AI video in one studio.

**Acceptance criteria:**

- A first-time visitor can identify all three capabilities without scrolling far.
- The hero has one dominant action and one lower-emphasis example/gallery action.

---

## Priority 2 — Make pricing understandable

### 9. Translate credits into expected output

**Problem:** Credit totals alone do not tell a casual user what each plan can produce.

**Replit task:**

- Show approximate output equivalents under every subscription and credit pack.
- Calculate equivalents from the application’s current generation costs; do not hard-code numbers in multiple components.
- Account for different image, music, and video costs. Where outputs vary by model or settings, show an honest range.
- Link “How credits work” to a concise explanation with current costs.

**Display format:**

- Use a sentence beginning “Enough for about…” followed by the quantities calculated from current generation costs.
- Follow it with: “Actual usage varies by model and settings.”

**Acceptance criteria:**

- Every paid option explains what its credits can reasonably create.
- Equivalent figures stay synchronized when generation costs change.
- The wording distinguishes estimates from guarantees.

### 10. Clarify why each subscription tier exists

**Problem:** The plans appear to have the same features, with only the credit quantity changing.

**Replit task:**

- If features truly are the same, say so and position tiers by usage level: occasional, regular, and high-volume.
- Show credits, approximate outputs, effective credit value, rollover/expiration rules, and renewal interval.
- Highlight one recommended plan only if there is a genuine reason, such as best fit or best value.
- Do not create artificial feature restrictions merely to make the table look different.

**Acceptance criteria:**

- A casual user can select a tier based on expected use.
- All renewal, cancellation, expiration, and rollover statements match actual account behavior.
- Monthly subscriptions, annual subscriptions, and one-time packs are visually distinct.

---

## Priority 3 — Improve the path from YouTube to purchase

### 11. Preserve visitor intent through signup

**Problem:** A user who clicks from a specific product page should not lose context when authentication is required.

**Replit task:**

- Store the intended destination when signup or login begins.
- After authentication, return the user to the selected image, music, or video flow.
- Carry forward any safe draft settings or selected example where practical.
- Add a clear next step after account creation instead of a generic dashboard dead end.

**Acceptance criteria:**

- Image CTA --> signup/login --> image creation.
- Music CTA --> signup/login --> music creation.
- Video CTA --> signup/login --> video creation.
- Direct visits and expired sessions have sensible fallback behavior.

### 12. Add conversion analytics

**Problem:** Current revenue proves some demand, but the site needs funnel data to show where visitors stop.

**Replit task:**

Track these events with the site’s existing analytics provider, or add one privacy-conscious provider if none exists:

- Landing page viewed
- Product example played or opened
- Primary CTA clicked
- Signup started and completed
- Generator opened
- First generation attempted and completed
- Pricing viewed
- Plan or credit pack selected
- Checkout started
- Purchase or subscription completed

Include product type, plan, billing interval, referral source, campaign, and landing page where applicable. Never send prompts, generated media, payment details, or other private user content to analytics.

**Acceptance criteria:**

- A funnel can be viewed from landing page through completed purchase.
- YouTube traffic can be separated from direct and other referral traffic.
- Purchase events use server-confirmed Stripe success or webhook data, not only a browser redirect.
- Duplicate events are prevented or documented.

### 13. Create focused YouTube landing links

**Problem:** Demo videos create demand, but every viewer should land on the most relevant experience.

**Replit task:**

- Give image, music, and video demos distinct landing destinations.
- Support standard campaign parameters without breaking routing.
- Preserve referral data through signup and checkout.
- Use one consistent link pattern in future YouTube descriptions and pinned comments.
- Do not redirect older working links until replacement routes have been tested.

**Acceptance criteria:**

- Each demo can link directly to the corresponding product page.
- Analytics reports visits and conversions by video or campaign.
- Campaign parameters do not appear in sensitive account or payment data.

---

## Priority 4 — Polish and quality assurance

### 14. Run a responsive and accessibility pass

**Replit task:**

- Test the homepage, pricing, signup, gallery, and all three product pages at common phone, tablet, and desktop widths.
- Confirm keyboard navigation, visible focus states, form labels, useful alternative text, sufficient color contrast, and reduced-motion behavior.
- Check audio and video controls with keyboard-only navigation.
- Fix horizontal scrolling, clipped text, overlapping cards, tiny tap targets, and layout shifts.

**Acceptance criteria:**

- Core visitor and checkout paths can be completed by keyboard.
- No important text or control is clipped at tested widths.
- Media has accessible names; spoken video has captions when applicable.

### 15. Protect page speed

**Replit task:**

- Compress thumbnails and preview media.
- Lazy-load below-the-fold gallery items.
- Use poster frames for video and load the player only on interaction.
- Avoid loading every sample or generator dependency on the homepage.
- Measure before and after changes with the same pages and device profile.

**Acceptance criteria:**

- The homepage remains responsive while examples load.
- Media failures do not block the page or primary call to action.
- Before-and-after performance measurements are recorded in the Replit task notes.

---

## Recommended implementation order

### Release 1 — Credibility and broken behavior

1. Make the trial/free-account wording accurate and consistent.
2. Fix annual pricing display and Stripe plan mapping.
3. Fix route titles and metadata.
4. Repair the incomplete signup copy and responsive layout.

### Release 2 — Product proof

5. Add public music samples.
6. Replace the video login redirect with a public product page and samples.
7. Add real creations to the homepage.
8. Clarify the all-in-one image, music, and video message.

### Release 3 — Pricing and funnel

9. Add usage equivalents to credits.
10. Rework plan presentation around usage level and value.
11. Preserve product intent through authentication.
12. Instrument the conversion funnel.
13. Add focused, trackable landing links for YouTube demos.

### Release 4 — Final polish

14. Complete responsive and accessibility testing.
15. Optimize media and page performance.

## Release checklist

Use this checklist for each release:

- [ ] Production and staging configurations are separated.
- [ ] Stripe changes are tested in Stripe test mode before production.
- [ ] Prices, billing intervals, credits, and checkout totals agree everywhere.
- [ ] New analytics events are visible once and contain no private prompts or payment details.
- [ ] Login and signup return users to the product they selected.
- [ ] Homepage, pricing, signup, gallery, image, music, and video pages are checked on mobile and desktop.
- [ ] Browser back, refresh, expired session, loading, empty, and error states are tested.
- [ ] Public examples use real AIBeatSync output with the right permission to display it.
- [ ] Page titles and share previews are checked for each public route.
- [ ] Existing customers can still sign in, see balances, generate media, buy credits, and manage subscriptions.

## Definition of done

This punch list is complete when a first-time visitor can:

1. Understand that AIBeatSync creates images, music, and AI video in one place.
2. See or hear genuine examples without creating an account.
3. Understand exactly what is free and when payment begins.
4. Compare monthly, annual, and one-time options without doing credit math.
5. Follow a relevant YouTube link, create an account, return to the chosen tool, and complete a purchase without losing context.
6. Use the core flow on mobile, desktop, and keyboard-only navigation.

The business should also be able to measure each step from YouTube visit through successful signup, first generation, and Stripe-confirmed purchase.
