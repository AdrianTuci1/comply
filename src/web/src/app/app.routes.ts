import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'sign-in',
    title: 'Sign in — Comply',
    loadComponent: () => import('./features/auth/sign-in').then((module) => module.SignIn),
  },
  {
    path: '',
    loadComponent: () => import('./layout/app-shell').then((module) => module.AppShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'portal/dashboard' },
      {
        path: 'portal',
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
          {
            path: 'dashboard',
            loadComponent: () =>
              import('./features/portal/dashboard/dashboard').then((module) => module.Dashboard),
          },
          {
            path: 'users',
            loadComponent: () =>
              import('./features/portal/users/users').then((module) => module.Users),
          },
          {
            path: 'website',
            loadComponent: () =>
              import('./features/portal/website/website').then((module) => module.Website),
          },
          {
            path: 'settings',
            loadComponent: () =>
              import('./features/portal/settings/settings').then((module) => module.Settings),
          },
        ],
      },
      {
        path: 'workspace',
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'boards' },
          {
            path: 'sources',
            loadComponent: () =>
              import('./features/workspace/sources/sources').then((module) => module.Sources),
          },
          {
            path: 'boards',
            loadComponent: () =>
              import('./features/workspace/boards/boards').then((module) => module.Boards),
          },
          {
            path: 'boards/agent/:id',
            loadComponent: () =>
              import('./features/workspace/agent-board-detail/agent-board-detail').then(
                (module) => module.AgentBoardDetail,
              ),
          },
          {
            path: 'boards/:id',
            loadComponent: () =>
              import('./features/workspace/board-detail/board-detail').then(
                (module) => module.BoardDetail,
              ),
          },
          {
            path: 'agent',
            loadComponent: () =>
              import('./features/workspace/agent/agent').then((module) => module.AgentGuide),
          },
        ],
      },
    ],
  },
  {
    path: 't/:slug',
    loadComponent: () => import('./features/trust/trust-page').then((module) => module.TrustPage),
  },
  {
    path: 't/:slug/:tab',
    loadComponent: () => import('./features/trust/trust-page').then((module) => module.TrustPage),
  },
  { path: '**', redirectTo: 'portal/dashboard' },
];
