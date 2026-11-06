# Custom chocolates shop

Website, online shop, bespoke orders and a private admin for a handmade chocolate business. It runs on Cloudflare Workers with a D1 database. Built by NEMORA.

## What it does

- **Pages:** Home, Shop, product pages, Bespoke, Weddings, Gallery, Journal, Allergens, Delivery, Questions, Contact, Privacy and Terms.
- **Shop:** basket and checkout with collection, local delivery or UK delivery, a minimum notice period and a choice of date. Payment is through Stripe Checkout, and prices are always worked out on the server.
- **Allergens:** every product must declare all 14 UK allergens before it can be published. The allergen table updates itself from the products.
- **Bespoke and wedding enquiries:** each enquiry lands in an inbox section based on what the customer picked:
  - Weddings
  - Birthdays and celebrations
  - Business and events
  - Bespoke designs
  - Order questions
  - General enquiries
- **Quotes and deposits:** from any message, the owner can create a secure payment link for any amount, optionally emailed to the customer. When it's paid, the message is marked paid.
- **Order requests:** without Stripe, checkout still works. Orders arrive as requests, and the owner sends a payment link.
- **Admin at `/admin/`:**
  - dashboard
  - messages
  - orders (To do, Done, Cancelled)
  - products
  - gallery
  - journal
  - all website text and photos
  - delivery options and fees
  - shop open or closed
  - payments
  - logins and activity log
  - customer data export
  - cookieless visit stats
- **Phone-first:** the admin has a bottom tab bar on phones.

## Setup

1. Deploy this repository with Cloudflare Workers. The D1 database binding is already in `wrangler.jsonc`, and the tables create themselves on first visit.
2. Go to `/admin/`. Enter the one-time setup code, then choose a username and password. The code stops working once it's used.
   - Alternatively, set a `SETUP_CODE` secret.

Optional secrets, set in Cloudflare → Workers → custom-chocolates → Settings → Variables and Secrets:

| Secret | What it does |
| --- | --- |
| `STRIPE_SECRET_KEY` | Turns on card payments. Use a restricted or test key first. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the webhook `https://<site>/stripe/webhook`, which listens for the event `checkout.session.completed`. |
| `RESEND_API_KEY` and `EMAIL_FROM` | Order confirmations, order and enquiry alerts, and emailed payment links. |

No keys or passwords are stored in this repository, in the database or in anything sent to browsers.

## Security

- **Passwords:** stored only as PBKDF2 hashes. Sessions are random 256-bit tokens, stored hashed, in `__Host-` cookies (HttpOnly, Secure, SameSite=Strict).
- **Login protection:** login and setup are rate limited, and every admin write needs a same-origin request plus a custom header.
- **Content Security Policy:** strict on every page, with no inline scripts and no third-party scripts.
- **Escaping:** everything is escaped. The admin builds its pages with `textContent`.
- **Payments:** order totals are recalculated on the server, and Stripe amounts and session ids are checked on return and in the webhook. The webhook signature is verified.
- **Links:** payment links and order confirmation links use secrets that are stored hashed.
- **Photos:** resized in the browser, which removes location data. Uploads are checked to be real JPEG or WebP files.

## Privacy (UK GDPR / PECR)

- **No cookies to track visitors.** The only cookie is a strictly necessary basket cookie, so no consent banner is needed. Visit counts store no IP addresses or identifiers.
- **Automatic deletion, done by a daily job:**
  - enquiries that didn't lead to an order are deleted after 24 months (changeable in the admin);
  - unfinished checkouts are deleted after 7 days;
  - orders and payments are kept for 6 years (HMRC).
- **Stand-in photographs** are served through the site, so visitors' browsers never contact another server.

## Local testing

```
node test/server.mjs      # in-memory D1, mocked Stripe and email, on port 8810
node test/api.mjs         # end-to-end checks
```
