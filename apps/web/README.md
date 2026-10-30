# Web

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.5.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Runtime API configuration (CDN hosting)

The shell can be hosted on a static CDN while the API runs on another origin. The API origin is read at runtime from `config.js`, which `public/config.js` copies into the build output unchanged (`dist/web/browser/config.js`):

```js
globalThis.COMPLY_CONFIG = { apiBase: '' };
```

- Leave `apiBase` empty when the UI and API share an origin. Requests stay relative (`/api/library`), and the dev server proxies `/api` to `http://127.0.0.1:4300` through `proxy.conf.json`.
- For CDN hosting, edit `config.js` in the deployed output and set the API origin, for example `apiBase: 'https://comply-api.example.com'`. API calls and the OIDC sign-in redirect then target that host. A base with a path prefix (`https://comply-api.example.com/gateway`) also works; trailing slashes are ignored.
- Because `config.js` is an editable file rather than a build constant, redeploying a new API origin does not require rebuilding the shell. Serve it with a short cache lifetime (`no-cache`) so configuration changes take effect.
- The API must accept the CDN origin via CORS: return `Access-Control-Allow-Origin` for the CDN origin and answer preflight requests for the JSON `POST`/`DELETE` calls and the `x-comply-tenant` header. If the API uses cookies rather than bearer tokens, also allow credentials and set `fetch` credentials accordingly.
- OIDC providers must be registered with the API host's callback URL, and that callback must redirect back to the deployed UI origin.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
