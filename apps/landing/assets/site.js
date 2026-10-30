(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');

  var config = window.COMPLY_SITE || {};
  var appUrl = (config.appUrl || '').replace(/\/$/, '');
  var repoUrl = config.repoUrl || 'https://github.com/AdrianTuci1/comply';
  var supportUrl = config.supportUrl || repoUrl + '/issues';

  function join(base, path) {
    return base ? base + path : path;
  }

  document.querySelectorAll('[data-site-link]').forEach(function (link) {
    switch (link.getAttribute('data-site-link')) {
      case 'signin':
        link.href = join(appUrl, '/sign-in');
        break;
      case 'docs':
        link.href = join(appUrl, '/docs');
        break;
      case 'repo':
        link.href = repoUrl;
        break;
      case 'support':
        link.href = supportUrl;
        break;
    }
  });

  var year = document.querySelector('[data-current-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  // Mobile navigation.
  var toggle = document.querySelector('[data-nav-toggle]');
  var nav = document.querySelector('#site-nav');
  if (toggle && nav) {
    var setNav = function (open) {
      nav.setAttribute('data-open', open ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Close' : 'Menu';
    };
    setNav(false);
    toggle.addEventListener('click', function () {
      setNav(nav.getAttribute('data-open') !== 'true');
    });
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setNav(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.getAttribute('data-open') === 'true') {
        setNav(false);
        toggle.focus();
      }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 720) setNav(false);
    });
  }

  // The setup prompt lives in one place: the code block in the setup section.
  var promptSource = document.querySelector('#setup-prompt');
  var promptText = promptSource
    ? promptSource.textContent.trim()
    : [
        'Install Comply on this server.',
        '',
        'Requirements: Docker Engine 24+ with Compose v2, and Python 3.8+.',
        '',
        'Run:',
        'curl -fsSLO https://raw.githubusercontent.com/AdrianTuci1/comply/main/easy-install.py',
        'python3 easy-install.py deploy --sitename=comply.example.com',
        '',
        'When it finishes, open the URL and create the first account. That account becomes the administrator. Do not create an account for me.',
      ].join('\n');

  function flash(target, message) {
    if (!target) return;
    target.textContent = message;
    window.clearTimeout(target._timer);
    target._timer = window.setTimeout(function () {
      target.textContent = '';
    }, 4200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
      } catch (error) {
        reject(error);
      } finally {
        document.body.removeChild(area);
      }
    });
  }

  document.querySelectorAll('[data-copy-prompt]').forEach(function (button) {
    button.addEventListener('click', function () {
      var status = document.getElementById(button.getAttribute('data-copy-status') || '');
      copyText(promptText)
        .then(function () {
          flash(status, 'Prompt copied. Paste it into your agent.');
        })
        .catch(function () {
          flash(status, 'Copy failed. Select the prompt in the setup section.');
        });
    });
  });

  // Agent tabs.
  document.querySelectorAll('[data-tabs]').forEach(function (group) {
    var tabs = Array.from(group.querySelectorAll('[role="tab"]'));
    var panels = tabs
      .map(function (tab) {
        return document.getElementById(tab.getAttribute('aria-controls'));
      })
      .filter(Boolean);

    function select(index) {
      tabs.forEach(function (tab, i) {
        var active = i === index;
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
        if (panels[i]) panels[i].hidden = !active;
      });
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        select(index);
      });
      tab.addEventListener('keydown', function (event) {
        var next = index;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;
        event.preventDefault();
        select(next);
        tabs[next].focus();
      });
    });

    select(0);
  });

  // Section reveals. Content stays visible when this script does not run.
  var revealItems = Array.from(document.querySelectorAll('[data-reveal]'));
  if ('IntersectionObserver' in window && revealItems.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    revealItems.forEach(function (item) {
      observer.observe(item);
    });
  } else {
    revealItems.forEach(function (item) {
      item.classList.add('is-visible');
    });
  }
})();
