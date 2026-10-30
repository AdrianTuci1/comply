# Comply site

The public site is a separate static project. It does not build with the Angular app in
`apps/web`, and it does not need the API to render. The home page is a short project page:
description, screenshots, quick start, and the framework table.

## Preview locally

```bash
node apps/landing/serve.mjs
# http://127.0.0.1:3100
```

`/pricing`, `/privacy`, `/terms`, and `/support` are served as clean URLs. The same files work
on any static host.

## Point it at a deployment

Edit `assets/config.js` before publishing:

```js
window.COMPLY_SITE = {
  appUrl: 'https://app.example.com',
  repoUrl: 'https://github.com/AdrianTuci1/comply',
  supportUrl: 'https://github.com/AdrianTuci1/comply/issues',
};
```

`appUrl` supplies the Sign in link (`/sign-in`) and the Docs link (`/docs`). Leave it empty when
the marketing site and the app share an origin.

## What is real on the page

The product images are screenshots of the actual Angular app, captured from a local demo
workspace at 1600px and exported to `assets/img/`. Names, dates, and evidence are seed data. The
requirement counts in the copy come from the current managed library: `1,569` records, made up of
1,006 EU AI Act, 409 NIS2, 93 ISO/IEC 27001 Annex A controls, and 61 SOC 2 criteria.

ISO/IEC 27001 and SOC 2 are licensed standards. The site and the library use short references and
original summaries; no standard text is included. The SOC 2 set is a starter checklist, not the
full AICPA Trust Services Criteria, and ISO/IEC 27001 covers Annex A only.

The site sets no cookies and loads no third-party assets. Fonts (Stack Sans, SIL Open Font
License) are served from `assets/fonts/`.

## Pages

| File          | Route          |
| ------------- | -------------- |
| `index.html`  | `/`            |
| `pricing.html`| `/pricing`     |
| `privacy.html`| `/privacy`     |
| `terms.html`  | `/terms`       |
| `support.html`| `/support`     |
