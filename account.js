/* ===========================================================================
   ACCOUNTS, IN THE BROWSER
   One file, loaded by the tree, the editor and the work page. It owns:

     TAS.api      fetch with the app header, JSON both ways, real error objects
     TAS.auth     who is signed in, and the sign-in / register / guest dialog
     TAS.store    saved trees, paths and documents
     TAS.ui       the account chip in the top bar, toasts, confirm dialogs

   It brings its own CSS, written against the variables every page already
   defines, so it themes light and dark with the page and nothing new is
   fetched. If the API is not there — no DATABASE_URL, a static host, a file://
   open — everything still loads and the chip says saving is unavailable
   instead of throwing.

   Guest access is a supported way to use this tool, not a degraded one. A
   guest answers every question, prints every result and edits the tree in
   their own browser. What a guest cannot do is keep any of it anywhere but
   that browser, and every button that would imply otherwise says so first.
   ========================================================================= */
(function () {
  'use strict';

  if (window.TAS && window.TAS.__loaded) return;

  var API = '/api';
  var APP_HEADER = 'X-TAS-App';
  var GUEST_KEY = 'tas-guest-ack';

  /* ---- tiny event bus -------------------------------------------------- */
  function bus() {
    var map = {};
    return {
      on: function (name, fn) {
        (map[name] || (map[name] = [])).push(fn);
        return function () {
          map[name] = (map[name] || []).filter(function (f) {
            return f !== fn;
          });
        };
      },
      emit: function (name, arg) {
        (map[name] || []).slice().forEach(function (fn) {
          try {
            fn(arg);
          } catch (e) {
            console.error('[tas] listener for ' + name + ' failed:', e);
          }
        });
      },
    };
  }

  /* ---- errors ---------------------------------------------------------- */
  function ApiError(status, code, message, fields) {
    var e = new Error(message || code || 'Request failed');
    e.name = 'ApiError';
    e.status = status;
    e.code = code;
    if (fields) e.fields = fields;
    return e;
  }

  /* ---- fetch ----------------------------------------------------------- */
  /* Every mutating request carries the app header. A form on another site can
     post to this origin but cannot set a custom header without a preflight,
     and no CORS headers are sent, so no preflight succeeds. */
  function api(path, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json' };
    headers[APP_HEADER] = '1';
    var init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: headers,
      cache: 'no-store',
    };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    if (opts.signal) init.signal = opts.signal;
    return fetch(API + path, init).then(
      function (res) {
        if (res.status === 204) return null;
        return res
          .text()
          .then(function (text) {
            var data = null;
            if (text) {
              try {
                data = JSON.parse(text);
              } catch (e) {
                data = null;
              }
            }
            if (!res.ok) {
              /* An HTML error page from a host that does not run the
                 functions at all reads as "saving is not set up here",
                 which is exactly what it is. */
              if (!data) {
                throw ApiError(
                  res.status,
                  res.status === 404 ? 'no_api' : 'server_error',
                  res.status === 404
                    ? 'This deployment has no saving service — the tool works, but nothing can be kept.'
                    : 'The server returned ' + res.status + '.'
                );
              }
              throw ApiError(res.status, data.error, data.message, data.fields);
            }
            return data;
          });
      },
      function () {
        throw ApiError(0, 'offline', 'No connection to the server. Nothing was saved.');
      }
    );
  }

  /* ===== auth ============================================================ */
  var events = bus();
  var state = {
    ready: false,
    user: null,
    storage: 'unknown', /* unknown | ready | unconfigured | unreachable */
    /* which ways in this deployment offers, and which this account has */
    auth: { password: true, google: false },
    methods: null,
    /* whether the editor at /admin is limited to one account, and whether
       this is that account. With no ADMIN_EMAIL configured the gate is off
       and admin comes back true for anyone signed in. */
    adminGate: false,
    admin: false,
    counts: null,
    limits: null,
  };

  function setState(patch) {
    var before = JSON.stringify([state.user, state.storage]);
    for (var k in patch) state[k] = patch[k];
    if (JSON.stringify([state.user, state.storage]) !== before || patch.counts) {
      events.emit('change', state);
    }
  }

  var refreshing = null;
  function refresh(force) {
    if (refreshing && !force) return refreshing;
    refreshing = api('/auth/me')
      .then(function (data) {
        setState({
          ready: true,
          user: (data && data.user) || null,
          storage: (data && data.storage) || 'ready',
          auth: (data && data.auth) || { password: true, google: false },
          methods: (data && data.methods) || null,
          adminGate: !!(data && data.adminGate),
          admin: !!(data && data.admin),
          counts: (data && data.counts) || null,
          limits: (data && data.limits) || null,
        });
        return state;
      })
      .catch(function (err) {
        setState({
          ready: true,
          user: null,
          admin: false,
          storage: err.code === 'storage_unavailable' || err.code === 'no_api' ? 'unconfigured' : 'unreachable',
        });
        return state;
      })
      .then(function (s) {
        refreshing = null;
        return s;
      });
    return refreshing;
  }

  function signIn(email, password) {
    return api('/auth/login', { method: 'POST', body: { email: email, password: password } }).then(
      function (data) {
        setState({ user: data.user, storage: 'ready' });
        try {
          localStorage.removeItem(GUEST_KEY);
        } catch (e) {}
        return refresh(true).then(function () {
          events.emit('signin', state.user);
          return state.user;
        });
      }
    );
  }

  function register(name, email, password) {
    return api('/auth/register', {
      method: 'POST',
      body: { name: name, email: email, password: password },
    }).then(function (data) {
      setState({ user: data.user, storage: 'ready' });
      try {
        localStorage.removeItem(GUEST_KEY);
      } catch (e) {}
      return refresh(true).then(function () {
        events.emit('signin', state.user);
        return state.user;
      });
    });
  }

  function signOut() {
    return api('/auth/logout', { method: 'POST' })
      .catch(function () {})
      .then(function () {
        var was = state.user;
        setState({ user: null, counts: null, admin: false, methods: null });
        events.emit('signout', was);
        return null;
      });
  }

  function canSave() {
    return !!state.user && state.storage === 'ready';
  }
  function ackGuest() {
    try {
      localStorage.setItem(GUEST_KEY, '1');
    } catch (e) {}
  }
  function guestAcked() {
    try {
      return localStorage.getItem(GUEST_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  /* ===== store =========================================================== */
  var KINDS = { trees: 1, runs: 1, documents: 1 };
  function kindPath(kind) {
    if (!KINDS[kind]) throw new Error('unknown kind: ' + kind);
    return '/' + kind;
  }
  var store = {
    list: function (kind, opts) {
      opts = opts || {};
      var q = [];
      if (opts.trash) q.push('trash=1');
      if (opts.limit) q.push('limit=' + encodeURIComponent(opts.limit));
      if (opts.offset) q.push('offset=' + encodeURIComponent(opts.offset));
      return api(kindPath(kind) + (q.length ? '?' + q.join('&') : ''));
    },
    get: function (kind, id, opts) {
      return api(kindPath(kind) + '/' + encodeURIComponent(id) + ((opts && opts.trash) ? '?trash=1' : '')).then(
        function (d) {
          return d.item;
        }
      );
    },
    create: function (kind, body) {
      return api(kindPath(kind), { method: 'POST', body: body }).then(function (d) {
        countsStale();
        return d.item;
      });
    },
    update: function (kind, id, patch) {
      return api(kindPath(kind) + '/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: patch,
      }).then(function (d) {
        return d.item;
      });
    },
    remove: function (kind, id) {
      return api(kindPath(kind) + '/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () {
        countsStale();
        return true;
      });
    },
    restore: function (kind, id) {
      return api(kindPath(kind) + '/' + encodeURIComponent(id) + '?restore=1', {
        method: 'PATCH',
        body: {},
      }).then(function () {
        countsStale();
        return true;
      });
    },
    purge: function (kind, id) {
      return api(kindPath(kind) + '/' + encodeURIComponent(id) + '?purge=1&confirm=1', {
        method: 'DELETE',
      }).then(function () {
        countsStale();
        return true;
      });
    },
  };
  var countsTimer = null;
  function countsStale() {
    clearTimeout(countsTimer);
    countsTimer = setTimeout(function () {
      refresh(true);
    }, 250);
  }

  /* ===== ui ============================================================== */
  var CSS =
    '.tasa-chip{display:flex;align-items:center;gap:7px;border:1px solid var(--border-strong);' +
    'background:var(--surface);color:var(--ink);border-radius:9px;padding:6px 10px;font-family:var(--sans);' +
    'font-weight:600;font-size:12.5px;letter-spacing:var(--track);cursor:pointer;line-height:1.1;' +
    'transition:transform .16s,box-shadow .16s,border-color .16s}' +
    '.tasa-chip:hover{border-color:var(--accent);color:var(--accent-ink);transform:translateY(-1px);box-shadow:var(--sh1)}' +
    '.tasa-chip:focus-visible{outline:3px solid var(--accent-soft);outline-offset:2px}' +
    '.tasa-chip svg{width:14px;height:14px;flex:none}' +
    '.tasa-chip .tasa-av{flex:none;width:20px;height:20px;border-radius:50%;background:var(--accent);' +
    'color:var(--on-accent,#fff);display:grid;place-items:center;font-size:9.5px;letter-spacing:.02em}' +
    '.tasa-chip.off{opacity:.75}' +
    '.tasa-wrap{position:relative;flex:none}' +
    '.tasa-menu{position:absolute;right:0;top:calc(100% + 7px);z-index:200;min-width:238px;' +
    'background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--sh2);' +
    'padding:7px;font-family:var(--sans)}' +
    '.tasa-menu[hidden]{display:none}' +
    '.tasa-menu .tasa-who{padding:8px 9px 9px;border-bottom:1px solid var(--border);margin-bottom:6px}' +
    '.tasa-menu .tasa-who b{display:block;font-size:13px;font-weight:650;color:var(--ink);' +
    'overflow:hidden;text-overflow:ellipsis}' +
    '.tasa-menu .tasa-who span{display:block;font-size:11.5px;color:var(--muted);margin-top:2px;' +
    'overflow:hidden;text-overflow:ellipsis}' +
    '.tasa-menu button,.tasa-menu a{display:flex;width:100%;box-sizing:border-box;align-items:center;gap:8px;' +
    'background:none;border:0;text-align:left;font:inherit;font-size:12.5px;color:var(--ink);' +
    'padding:8px 9px;border-radius:8px;cursor:pointer;text-decoration:none}' +
    '.tasa-menu button:hover,.tasa-menu a:hover{background:var(--surface-2);color:var(--accent-ink)}' +
    '.tasa-menu .tasa-n{margin-left:auto;font-size:11px;color:var(--faint)}' +
    '.tasa-menu hr{border:0;border-top:1px solid var(--border);margin:6px 2px}' +
    '.tasa-menu .tasa-note{padding:7px 9px 8px;font-size:11.5px;color:var(--muted);line-height:1.45}' +
    /* dialog */
    '.tasa-ovl{position:fixed;inset:0;z-index:400;display:flex;align-items:center;justify-content:center;' +
    'padding:clamp(10px,3vw,28px);font-family:var(--sans)}' +
    '.tasa-ovl[hidden]{display:none}' +
    '.tasa-ovl>.tasa-bg{position:absolute;inset:0;background:rgba(8,27,35,.6)}' +
    '.tasa-card{position:relative;width:min(460px,100%);max-height:100%;overflow:auto;background:var(--surface);' +
    'border:1px solid var(--border);border-radius:16px;box-shadow:var(--sh2);padding:0}' +
    '.tasa-card.wide{width:min(620px,100%)}' +
    '.tasa-hd{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 12px;border-bottom:1px solid var(--border)}' +
    '.tasa-hd .kk{font-size:9.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);display:block;line-height:1.35}' +
    '.tasa-hd h3{font-family:var(--display);font-weight:400;font-size:22px;margin:7px 0 0;line-height:1.25;color:var(--ink)}' +
    '.tasa-hd .tasa-x{margin-left:auto;background:none;border:1px solid transparent;border-radius:8px;' +
    'color:var(--muted);font-size:15px;line-height:1;padding:5px 8px;cursor:pointer}' +
    '.tasa-hd .tasa-x:hover{border-color:var(--border-strong);color:var(--ink)}' +
    '.tasa-bd{padding:14px 18px 4px}' +
    '.tasa-ft{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:12px 18px 16px}' +
    '.tasa-ft .grow{flex:1}' +
    '.tasa-tabs{display:flex;gap:4px;padding:10px 18px 0}' +
    '.tasa-tabs button{flex:1;background:none;border:1px solid transparent;border-bottom:2px solid transparent;' +
    'font:inherit;font-size:12.5px;font-weight:600;color:var(--muted);padding:8px 6px;cursor:pointer;border-radius:8px 8px 0 0}' +
    '.tasa-tabs button[aria-selected="true"]{color:var(--accent-ink);border-bottom-color:var(--accent);background:var(--surface-2)}' +
    '.tasa-f{display:block;margin:0 0 12px}' +
    '.tasa-f>label{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;' +
    'color:var(--muted);margin-bottom:5px}' +
    '.tasa-f input,.tasa-f textarea{width:100%;box-sizing:border-box;font:inherit;font-size:14px;' +
    'font-family:var(--sans);background:var(--bg);color:var(--ink);border:1px solid var(--border-strong);' +
    'border-radius:9px;padding:9px 11px}' +
    '.tasa-f input:focus,.tasa-f textarea:focus{outline:3px solid var(--accent-soft);outline-offset:1px;border-color:var(--accent)}' +
    '.tasa-f .tasa-hint{font-size:11.5px;color:var(--faint);margin-top:5px;line-height:1.45}' +
    '.tasa-f.bad input{border-color:var(--alert)}' +
    '.tasa-f .tasa-err{font-size:11.5px;color:var(--alert);margin-top:5px;line-height:1.45}' +
    '.tasa-msg{border:1px solid var(--border);border-left:3px solid var(--accent);background:var(--surface-2);' +
    'border-radius:9px;padding:10px 12px;font-size:12.5px;line-height:1.5;color:var(--ink);margin:0 0 13px}' +
    '.tasa-msg.bad{border-left-color:var(--alert);background:var(--alert-bg)}' +
    '.tasa-msg.warn{border-left-color:var(--risk);background:var(--risk-bg)}' +
    '.tasa-msg.good{border-left-color:var(--good);background:var(--good-bg)}' +
    '.tasa-msg b{font-weight:650}' +
    '.tasa-b{border:1px solid var(--border-strong);background:var(--surface);color:var(--ink);border-radius:9px;' +
    'padding:8px 13px;font-family:var(--sans);font-weight:600;font-size:12.5px;letter-spacing:var(--track);' +
    'cursor:pointer;line-height:1.15}' +
    '.tasa-b:hover{border-color:var(--accent);color:var(--accent-ink)}' +
    '.tasa-b:focus-visible{outline:3px solid var(--accent-soft);outline-offset:2px}' +
    '.tasa-b.solid{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}' +
    '.tasa-b.solid:hover{color:var(--on-accent,#fff);filter:brightness(1.07)}' +
    '.tasa-b.danger{border-color:var(--alert);color:var(--alert)}' +
    '.tasa-b.danger:hover{background:var(--alert-bg)}' +
    '.tasa-b.link{border-color:transparent;background:none;color:var(--muted);padding:8px 4px}' +
    '.tasa-b.link:hover{color:var(--accent-ink);text-decoration:underline}' +
    '.tasa-b:disabled{opacity:.55;cursor:not-allowed}' +
    '.tasa-b:disabled:hover{border-color:var(--border-strong);color:var(--ink);background:var(--surface);filter:none}' +
    /* sign in with Google */
    '.tasa-g{display:flex;width:100%;box-sizing:border-box;align-items:center;justify-content:center;' +
    'gap:11px;padding:11px 14px;border:1px solid var(--border-strong);background:var(--surface);' +
    'color:var(--ink);border-radius:10px;font-family:var(--sans);font-weight:600;font-size:13.5px;' +
    'letter-spacing:var(--track);cursor:pointer;text-decoration:none;line-height:1.15;' +
    'transition:border-color .18s,box-shadow .18s,transform .12s}' +
    '.tasa-g:hover{border-color:var(--accent);box-shadow:var(--sh1);transform:translateY(-1px)}' +
    '.tasa-g:focus-visible{outline:3px solid var(--accent-soft);outline-offset:2px}' +
    '.tasa-g svg{width:18px;height:18px;flex:none}' +
    '.tasa-or{display:flex;align-items:center;gap:10px;margin:15px 0 13px;color:var(--faint);' +
    'font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}' +
    '.tasa-or:before,.tasa-or:after{content:"";flex:1;height:1px;background:var(--border)}' +
    /* toasts */
    '.tasa-toasts{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:500;' +
    'display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;' +
    'width:min(440px,calc(100% - 24px))}' +
    '.tasa-toast{pointer-events:auto;background:var(--surface);border:1px solid var(--border);' +
    'border-left:3px solid var(--accent);border-radius:10px;box-shadow:var(--sh2);padding:10px 13px;' +
    'font-family:var(--sans);font-size:12.5px;line-height:1.45;color:var(--ink);' +
    'display:flex;align-items:flex-start;gap:10px;width:100%;box-sizing:border-box;' +
    'animation:tasaIn .22s cubic-bezier(.22,.68,0,1) both}' +
    '.tasa-toast.bad{border-left-color:var(--alert);background:var(--alert-bg)}' +
    '.tasa-toast.good{border-left-color:var(--good);background:var(--good-bg)}' +
    '.tasa-toast.warn{border-left-color:var(--risk);background:var(--risk-bg)}' +
    '.tasa-toast button{margin-left:auto;background:none;border:0;color:var(--muted);cursor:pointer;' +
    'font:inherit;font-size:12px;padding:0 0 0 6px;text-decoration:underline}' +
    '.tasa-toast.leaving{animation:tasaOut .2s ease both}' +
    '@keyframes tasaIn{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}' +
    '@keyframes tasaOut{to{opacity:0;transform:translateY(6px)}}' +
    '@media (prefers-reduced-motion:reduce){.tasa-toast{animation:none}}' +
    '@media print{.tasa-chip,.tasa-menu,.tasa-ovl,.tasa-toasts{display:none !important}}';

  function injectCss() {
    if (document.getElementById('tasa-css')) return;
    var s = document.createElement('style');
    s.id = 'tasa-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] === true) n.setAttribute(k, '');
        else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
      }
    }
    (kids || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---- toasts ---------------------------------------------------------- */
  var toastHost = null;
  function toast(message, kind, opts) {
    injectCss();
    opts = opts || {};
    if (!toastHost) {
      toastHost = el('div', { class: 'tasa-toasts', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastHost);
    }
    var t = el('div', { class: 'tasa-toast' + (kind ? ' ' + kind : '') }, [
      el('span', { text: message }),
    ]);
    if (opts.action && opts.onAction) {
      t.appendChild(
        el('button', {
          type: 'button',
          text: opts.action,
          onclick: function () {
            close();
            opts.onAction();
          },
        })
      );
    }
    toastHost.appendChild(t);
    var timer = setTimeout(close, opts.ms || (kind === 'bad' ? 7000 : 4200));
    function close() {
      clearTimeout(timer);
      if (!t.parentNode) return;
      t.classList.add('leaving');
      setTimeout(function () {
        if (t.parentNode) t.parentNode.removeChild(t);
      }, 200);
    }
    return close;
  }

  /* ---- modal shell ----------------------------------------------------- */
  var openModal = null;
  function modal(opts) {
    injectCss();
    if (openModal) openModal.close();
    var lastFocus = document.activeElement;
    var body = el('div', { class: 'tasa-bd' });
    var foot = el('div', { class: 'tasa-ft' });
    var card = el('div', { class: 'tasa-card' + (opts.wide ? ' wide' : '') }, [
      el('div', { class: 'tasa-hd' }, [
        el('div', {}, [
          opts.kicker ? el('span', { class: 'kk', text: opts.kicker }) : null,
          el('h3', { text: opts.title || '' }),
        ]),
        el('button', {
          class: 'tasa-x',
          type: 'button',
          'aria-label': 'Close',
          html: '&#10005;',
          onclick: function () {
            api2.close('dismiss');
          },
        }),
      ]),
      body,
      foot,
    ]);
    var tabsEl = null;
    var ovl = el(
      'div',
      {
        class: 'tasa-ovl',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': opts.title || 'Dialog',
      },
      [
        el('div', {
          class: 'tasa-bg',
          onclick: function () {
            if (opts.dismissable !== false) api2.close('dismiss');
          },
        }),
        card,
      ]
    );
    function onKey(e) {
      if (e.key === 'Escape' && opts.dismissable !== false) {
        e.stopPropagation();
        api2.close('dismiss');
      }
      if (e.key === 'Tab') {
        var f = card.querySelectorAll(
          'button:not([disabled]),input:not([disabled]),select,textarea,a[href]'
        );
        if (!f.length) return;
        var first = f[0],
          last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ovl);

    var resolved = null;
    var settle;
    var done = new Promise(function (r) {
      settle = r;
    });

    var api2 = {
      body: body,
      foot: foot,
      card: card,
      done: done,
      setTabs: function (labels, onPick, current) {
        if (!tabsEl) {
          tabsEl = el('div', { class: 'tasa-tabs', role: 'tablist' });
          card.insertBefore(tabsEl, body);
        }
        tabsEl.innerHTML = '';
        labels.forEach(function (lb, i) {
          tabsEl.appendChild(
            el('button', {
              type: 'button',
              role: 'tab',
              'aria-selected': String(i === current),
              text: lb,
              onclick: function () {
                onPick(i);
              },
            })
          );
        });
      },
      setTitle: function (t) {
        card.querySelector('.tasa-hd h3').textContent = t;
      },
      close: function (value) {
        if (resolved) return;
        resolved = true;
        document.removeEventListener('keydown', onKey, true);
        if (ovl.parentNode) ovl.parentNode.removeChild(ovl);
        if (openModal === api2) openModal = null;
        if (lastFocus && lastFocus.focus) {
          try {
            lastFocus.focus({ preventScroll: true });
          } catch (e) {}
        }
        settle(value);
      },
    };
    openModal = api2;
    return api2;
  }

  /* ---- form helpers ---------------------------------------------------- */
  function field(opts) {
    var input = el('input', {
      type: opts.type || 'text',
      id: opts.id,
      name: opts.name || opts.id,
      value: opts.value || '',
      autocomplete: opts.autocomplete || 'off',
      placeholder: opts.placeholder || '',
      spellcheck: 'false',
      maxlength: opts.maxlength || 254,
    });
    var err = el('div', { class: 'tasa-err', hidden: true });
    var wrap = el('div', { class: 'tasa-f' }, [
      el('label', { for: opts.id, text: opts.label }),
      input,
      opts.hint ? el('div', { class: 'tasa-hint', text: opts.hint }) : null,
      err,
    ]);
    return {
      wrap: wrap,
      input: input,
      value: function () {
        return input.value;
      },
      setError: function (msg) {
        if (msg) {
          wrap.classList.add('bad');
          err.textContent = msg;
          err.hidden = false;
        } else {
          wrap.classList.remove('bad');
          err.textContent = '';
          err.hidden = true;
        }
      },
    };
  }

  function message(text, kind) {
    return el('div', { class: 'tasa-msg' + (kind ? ' ' + kind : ''), html: text });
  }

  /* Google's own mark, inline, because this page fetches nothing. */
  var GOOGLE_G =
    '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">' +
    '<path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>' +
    '<path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>' +
    '<path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>' +
    '<path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>' +
    '</svg>';

  /* A link, not a fetch: the OAuth flow is a top-level navigation to Google
     and back, and `next` is where "back" lands. */
  function googleButton(label) {
    var next = location.pathname + location.search + location.hash;
    var b = el('a', {
      class: 'tasa-g',
      href: '/api/auth/google/start?next=' + encodeURIComponent(next),
      role: 'button',
    });
    b.innerHTML = GOOGLE_G;
    b.appendChild(el('span', { text: label || 'Continue with Google' }));
    return b;
  }

  /* ---- confirm --------------------------------------------------------- */
  function confirmDialog(opts) {
    var m = modal({
      title: opts.title || 'Are you sure?',
      kicker: opts.kicker || null,
      dismissable: true,
    });
    m.body.appendChild(message(opts.html || esc(opts.text || ''), opts.kind || 'warn'));
    var typed = null;
    if (opts.requireWord) {
      typed = field({
        id: 'tasa-confirm-word',
        label: 'Type ' + opts.requireWord + ' to confirm',
        maxlength: 40,
      });
      m.body.appendChild(typed.wrap);
    }
    var go = el('button', {
      class: 'tasa-b ' + (opts.danger ? 'danger' : 'solid'),
      type: 'button',
      text: opts.confirmLabel || 'Yes, do it',
      onclick: function () {
        if (opts.requireWord && typed.value().trim().toUpperCase() !== opts.requireWord.toUpperCase()) {
          typed.setError('Type ' + opts.requireWord + ' exactly.');
          return;
        }
        m.close(true);
      },
    });
    m.foot.appendChild(
      el('button', {
        class: 'tasa-b',
        type: 'button',
        text: opts.cancelLabel || 'Cancel',
        onclick: function () {
          m.close(false);
        },
      })
    );
    m.foot.appendChild(el('span', { class: 'grow' }));
    m.foot.appendChild(go);
    setTimeout(function () {
      (typed ? typed.input : go).focus();
    }, 30);
    return m.done.then(function (v) {
      return v === true;
    });
  }

  /* ---- the sign-in dialog --------------------------------------------- */
  var GUEST_COPY =
    'You can use every part of this tool as a guest — answer the questions, print the result, ' +
    'edit the tree. What a guest cannot do is <b>keep</b> any of it: nothing is stored on the ' +
    'server, and a saved draft lives only in this browser, on this machine. Clear the browser ' +
    'and it is gone.';

  function authDialog(opts) {
    opts = opts || {};
    var mode = opts.mode === 'register' ? 1 : 0;
    var m = modal({
      title: 'Sign in',
      kicker: 'Your account',
      dismissable: opts.dismissable !== false,
    });
    var pending = false;

    function render() {
      m.setTabs(['Sign in', 'Create an account'], function (i) {
        if (pending) return;
        mode = i;
        render();
      }, mode);
      m.setTitle(mode ? 'Create an account' : 'Sign in');
      m.body.innerHTML = '';
      m.foot.innerHTML = '';

      if (state.storage !== 'ready') {
        m.body.appendChild(
          message(
            '<b>Saving is not available on this deployment.</b> ' +
              (state.storage === 'unconfigured'
                ? 'No database is configured for it, so there are no accounts to sign in to. Everything else works.'
                : 'The database did not answer. Try again in a moment; everything else works.'),
            'warn'
          )
        );
        m.foot.appendChild(
          el('button', {
            class: 'tasa-b solid',
            type: 'button',
            text: 'Carry on as a guest',
            onclick: function () {
              ackGuest();
              m.close(null);
            },
          })
        );
        return;
      }

      if (opts.reason) m.body.appendChild(message(opts.reason, 'warn'));

      /* Google first, because for most people it is one click against a
         password they would otherwise have to invent and remember. */
      if (state.auth && state.auth.google) {
        m.body.appendChild(
          googleButton(mode ? 'Sign up with Google' : 'Continue with Google')
        );
        m.body.appendChild(
          el('div', { class: 'tasa-or' }, [
            el('span', { text: mode ? 'or make one with a password' : 'or sign in with a password' }),
          ])
        );
      }

      var name = mode
        ? field({
            id: 'tasa-name',
            label: 'Your name',
            autocomplete: 'name',
            maxlength: 120,
            hint: 'Shown on your own saved work. Optional.',
          })
        : null;
      var email = field({
        id: 'tasa-email',
        label: 'Email',
        type: 'email',
        autocomplete: mode ? 'email' : 'username',
        placeholder: 'you@example.org',
      });
      var pw = field({
        id: 'tasa-pw',
        label: 'Password',
        type: 'password',
        autocomplete: mode ? 'new-password' : 'current-password',
        maxlength: 200,
        hint: mode ? 'At least 10 characters. A short phrase you will remember beats a scramble you will not.' : '',
      });
      var pw2 = mode
        ? field({
            id: 'tasa-pw2',
            label: 'Password again',
            type: 'password',
            autocomplete: 'new-password',
            maxlength: 200,
          })
        : null;

      if (name) m.body.appendChild(name.wrap);
      m.body.appendChild(email.wrap);
      m.body.appendChild(pw.wrap);
      if (pw2) m.body.appendChild(pw2.wrap);
      var err = message('', 'bad');
      err.hidden = true;
      m.body.appendChild(err);

      var go = el('button', {
        class: 'tasa-b solid',
        type: 'button',
        text: mode ? 'Create account' : 'Sign in',
      });
      /* Some callers have nothing to offer a guest — the editor's gate is one:
         carrying on without an account is exactly what it is refusing. */
      var guest = opts.guest === false ? null : el('button', {
        class: 'tasa-b link',
        type: 'button',
        text: 'Continue as a guest',
        onclick: function () {
          ackGuest();
          m.close(null);
        },
      });

      function submit() {
        if (pending) return;
        email.setError('');
        pw.setError('');
        if (pw2) pw2.setError('');
        err.hidden = true;
        if (mode && pw2 && pw.value() !== pw2.value()) {
          pw2.setError('Those two do not match.');
          pw2.input.focus();
          return;
        }
        pending = true;
        go.disabled = true;
        go.textContent = mode ? 'Creating…' : 'Signing in…';
        var p = mode
          ? register(name.value(), email.value(), pw.value())
          : signIn(email.value(), pw.value());
        p.then(
          function (user) {
            pending = false;
            m.close(user);
            toast(
              mode
                ? 'Account created. Your work will be kept from now on.'
                : 'Signed in as ' + (user.name || user.email) + '.',
              'good'
            );
          },
          function (e) {
            pending = false;
            go.disabled = false;
            go.textContent = mode ? 'Create account' : 'Sign in';
            var fields = e.fields || {};
            if (fields.email) email.setError(fields.email);
            if (fields.password) pw.setError(fields.password);
            if (!fields.email && !fields.password) {
              err.innerHTML = esc(e.message || 'That did not work.');
              err.hidden = false;
            }
            (fields.email ? email : pw).input.focus();
          }
        );
      }
      go.addEventListener('click', submit);
      [name, email, pw, pw2].forEach(function (f) {
        if (!f) return;
        f.input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        });
      });

      if (guest) m.foot.appendChild(guest);
      m.foot.appendChild(el('span', { class: 'grow' }));
      m.foot.appendChild(go);
      setTimeout(function () {
        (mode ? name.input : email.input).focus();
      }, 30);
    }
    render();
    return m.done;
  }

  /* Ask for a sign-in because something needs one. Resolves with the user, or
     null if they chose to stay a guest. */
  function requireSignIn(reason) {
    if (canSave()) return Promise.resolve(state.user);
    return ready().then(function () {
      if (canSave()) return state.user;
      return authDialog({
        reason:
          reason ||
          '<b>Guests cannot save.</b> Sign in, or create an account, to keep this and come back to it later.',
      });
    });
  }

  /* ---- account panel --------------------------------------------------- */
  function accountDialog() {
    var m = modal({ title: 'Your account', kicker: 'Account', wide: true });
    function render() {
      m.body.innerHTML = '';
      m.foot.innerHTML = '';
      if (!state.user) {
        m.body.appendChild(message('You are not signed in.', 'warn'));
        m.foot.appendChild(
          el('button', {
            class: 'tasa-b solid',
            type: 'button',
            text: 'Sign in',
            onclick: function () {
              m.close(null);
              authDialog({});
            },
          })
        );
        return;
      }
      var c = state.counts || {};
      m.body.appendChild(
        message(
          '<b>' +
            esc(state.user.name || state.user.email) +
            '</b><br>' +
            esc(state.user.email) +
            '<br>' +
            (c.trees || 0) +
            ' tree' + ((c.trees || 0) === 1 ? '' : 's') + ' · ' +
            (c.runs || 0) +
            ' saved path' + ((c.runs || 0) === 1 ? '' : 's') + ' · ' +
            (c.documents || 0) +
            ' document' + ((c.documents || 0) === 1 ? '' : 's'),
          'good'
        )
      );

      var nameF = field({
        id: 'tasa-acc-name',
        label: 'Display name',
        value: state.user.name || '',
        maxlength: 120,
      });
      m.body.appendChild(nameF.wrap);
      m.body.appendChild(
        el('div', { class: 'tasa-ft', style: 'padding:0 0 14px' }, [
          el('button', {
            class: 'tasa-b',
            type: 'button',
            text: 'Save name',
            onclick: function (e) {
              var b = e.currentTarget;
              b.disabled = true;
              api('/auth/me', { method: 'PATCH', body: { name: nameF.value() } }).then(
                function (d) {
                  setState({ user: d.user });
                  b.disabled = false;
                  toast('Name updated.', 'good');
                  render();
                },
                function (err) {
                  b.disabled = false;
                  nameF.setError(err.message);
                }
              );
            },
          }),
        ])
      );

      /* how this account signs in */
      var meth = state.methods || { password: true, google: false };
      m.body.appendChild(el('hr', { style: 'border:0;border-top:1px solid var(--border);margin:4px 0 14px' }));
      m.body.appendChild(
        el('div', {
          style: 'font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.06em;' +
            'text-transform:uppercase;color:var(--muted);margin:0 0 8px',
          text: 'How you sign in',
        })
      );
      m.body.appendChild(
        el('div', {
          style: 'font-size:13px;color:var(--muted);margin:0 0 11px;line-height:1.5',
          html:
            meth.password && meth.google
              ? 'A password <b>and</b> Google. Either works, and losing one still leaves a way in.'
              : meth.google
                ? 'Google only. Set a password below as well, and you will not be locked out if you lose access to that Google account.'
                : 'A password only.',
        })
      );
      if (state.auth && state.auth.google && !meth.google) {
        m.body.appendChild(googleButton('Attach a Google account'));
        var linkA = m.body.lastChild;
        linkA.href =
          '/api/auth/google/start?link=1&next=' +
          encodeURIComponent(location.pathname + location.search + location.hash);
        m.body.appendChild(
          el('p', {
            style: 'font-size:11.5px;color:var(--faint);margin:7px 0 14px;line-height:1.45',
            text: 'It does not have to be the same address as this account — attaching it proves you hold both.',
          })
        );
      }
      if (meth.google) {
        m.body.appendChild(
          el('div', { class: 'tasa-ft', style: 'padding:0 0 12px' }, [
            el('button', {
              class: 'tasa-b',
              type: 'button',
              text: 'Remove Google from this account',
              onclick: function (e) {
                var b = e.currentTarget;
                b.disabled = true;
                api('/auth/google/unlink', { method: 'POST', body: {} }).then(
                  function (d) {
                    b.disabled = false;
                    setState({ methods: d.methods });
                    toast('Google is no longer attached to this account.', 'good');
                    render();
                  },
                  function (err) {
                    b.disabled = false;
                    toast(err.message, err.code === 'last_method' ? 'warn' : 'bad', { ms: 8000 });
                  }
                );
              },
            }),
          ])
        );
      }

      /* password */
      var cur = field({ id: 'tasa-cur', label: 'Current password', type: 'password', maxlength: 200 });
      var np = field({
        id: 'tasa-np',
        label: meth.password ? 'New password' : 'Password to set',
        type: 'password',
        maxlength: 200,
        hint: meth.password
          ? 'At least 10 characters. Every other signed-in browser is signed out when you change it.'
          : 'At least 10 characters. Setting one gives you a second way in alongside Google.',
      });
      if (meth.password) m.body.appendChild(cur.wrap);
      m.body.appendChild(np.wrap);
      m.body.appendChild(
        el('div', { class: 'tasa-ft', style: 'padding:0 0 14px' }, [
          el('button', {
            class: 'tasa-b',
            type: 'button',
            text: meth.password ? 'Change password' : 'Set password',
            onclick: function (e) {
              var b = e.currentTarget;
              cur.setError('');
              np.setError('');
              b.disabled = true;
              api('/auth/password', {
                method: 'POST',
                body: { current: cur.value(), password: np.value() },
              }).then(
                function () {
                  b.disabled = false;
                  cur.input.value = '';
                  np.input.value = '';
                  toast(
                    meth.password
                      ? 'Password changed. Other browsers have been signed out.'
                      : 'Password set. You can now sign in either way.',
                    'good'
                  );
                  refresh(true).then(render);
                },
                function (err) {
                  b.disabled = false;
                  var f = err.fields || {};
                  if (f.current) cur.setError(f.current);
                  if (f.password) np.setError(f.password);
                  if (!f.current && !f.password) toast(err.message, 'bad');
                }
              );
            },
          }),
        ])
      );

      /* sessions and closing the account */
      m.body.appendChild(el('hr', { style: 'border:0;border-top:1px solid var(--border);margin:4px 0 14px' }));
      var sess = el('div', { class: 'tasa-hint', style: 'font-size:12px;color:var(--muted);margin-bottom:10px' , text: 'Checking other browsers…'});
      m.body.appendChild(sess);
      api('/auth/sessions').then(
        function (d) {
          var others = (d.items || []).filter(function (s) {
            return !s.current;
          });
          sess.textContent = others.length
            ? 'Signed in on ' + others.length + ' other browser' + (others.length === 1 ? '' : 's') + ': ' +
              others
                .map(function (s) {
                  return s.device;
                })
                .join(', ') + '.'
            : 'This is the only browser signed in to this account.';
        },
        function () {
          sess.textContent = '';
        }
      );
      m.body.appendChild(
        el('div', { class: 'tasa-ft', style: 'padding:0 0 6px' }, [
          el('button', {
            class: 'tasa-b',
            type: 'button',
            text: 'Sign out everywhere else',
            onclick: function (e) {
              var b = e.currentTarget;
              b.disabled = true;
              api('/auth/sessions', { method: 'DELETE' }).then(
                function () {
                  b.disabled = false;
                  toast('Every other browser has been signed out.', 'good');
                  render();
                },
                function (err) {
                  b.disabled = false;
                  toast(err.message, 'bad');
                }
              );
            },
          }),
          el('span', { class: 'grow' }),
          el('button', {
            class: 'tasa-b danger',
            type: 'button',
            text: 'Close account…',
            onclick: function () {
              closeAccountDialog().then(function (gone) {
                if (gone) m.close(null);
              });
            },
          }),
        ])
      );

      m.foot.appendChild(
        el('button', {
          class: 'tasa-b',
          type: 'button',
          text: 'Sign out',
          onclick: function () {
            signOut().then(function () {
              m.close(null);
              toast('Signed out. You are using the tool as a guest.', null);
            });
          },
        })
      );
      m.foot.appendChild(el('span', { class: 'grow' }));
      m.foot.appendChild(
        el('a', { class: 'tasa-b', href: '/work', text: 'My work' })
      );
      m.foot.appendChild(
        el('button', {
          class: 'tasa-b solid',
          type: 'button',
          text: 'Close',
          onclick: function () {
            m.close(null);
          },
        })
      );
    }
    render();
    return m.done;
  }

  function closeAccountDialog() {
    var c = state.counts || {};
    var m = modal({ title: 'Close this account', kicker: 'This cannot be undone' });
    m.body.appendChild(
      message(
        'Closing the account deletes it and <b>everything saved on it</b> — ' +
          (c.trees || 0) + ' tree' + ((c.trees || 0) === 1 ? '' : 's') + ', ' +
          (c.runs || 0) + ' saved path' + ((c.runs || 0) === 1 ? '' : 's') + ' and ' +
          (c.documents || 0) + ' document' + ((c.documents || 0) === 1 ? '' : 's') +
          ', including anything in the deleted list. There is no undo and no backup. ' +
          'Export or print anything you want to keep <b>before</b> you do this.',
        'bad'
      )
    );
    var pw = field({ id: 'tasa-del-pw', label: 'Your password', type: 'password', maxlength: 200 });
    var word = field({ id: 'tasa-del-word', label: 'Type DELETE to confirm', maxlength: 20 });
    m.body.appendChild(pw.wrap);
    m.body.appendChild(word.wrap);
    m.foot.appendChild(
      el('button', {
        class: 'tasa-b',
        type: 'button',
        text: 'Keep my account',
        onclick: function () {
          m.close(false);
        },
      })
    );
    m.foot.appendChild(el('span', { class: 'grow' }));
    m.foot.appendChild(
      el('button', {
        class: 'tasa-b danger',
        type: 'button',
        text: 'Delete everything',
        onclick: function (e) {
          var b = e.currentTarget;
          pw.setError('');
          word.setError('');
          b.disabled = true;
          api('/auth/account', {
            method: 'DELETE',
            body: { password: pw.value(), confirm: word.value() },
          }).then(
            function () {
              setState({ user: null, counts: null });
              events.emit('signout', null);
              m.close(true);
              toast('The account and everything on it has been deleted.', null, { ms: 9000 });
            },
            function (err) {
              b.disabled = false;
              var f = err.fields || {};
              if (f.password) pw.setError(f.password);
              if (f.confirm) word.setError(f.confirm);
              if (!f.password && !f.confirm) toast(err.message, 'bad');
            }
          );
        },
      })
    );
    return m.done.then(function (v) {
      return v === true;
    });
  }

  /* ---- the chip in the top bar ---------------------------------------- */
  /* The two icons the chip wears when there is no account to show. Drawn in
     the same weight as the buttons beside it, so the bar reads as one row of
     controls rather than one row and a badge. */
  var ICON_SIGNIN =
    '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>' +
    '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>';
  var ICON_NOSAVE =
    '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>' +
    '<path d="M3 3l18 18"/>';
  function icon(paths) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = paths;
    return svg;
  }

  function initials(user) {
    var s = (user.name || '').trim();
    if (s) {
      var parts = s.split(/\s+/);
      return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }
    return (user.email || '?').slice(0, 2).toUpperCase();
  }

  function mountChip(host) {
    injectCss();
    host =
      host ||
      document.querySelector('[data-tas-account]') ||
      document.querySelector('.acts') ||
      document.querySelector('header .acts');
    if (!host) return null;
    var wrap = host.querySelector(':scope > .tasa-wrap');
    if (!wrap) {
      wrap = el('div', { class: 'tasa-wrap' });
      host.appendChild(wrap);
    }
    var chip = el('button', { class: 'tasa-chip', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
    var menu = el('div', { class: 'tasa-menu', hidden: true, role: 'menu' });
    wrap.innerHTML = '';
    wrap.appendChild(chip);
    wrap.appendChild(menu);

    function closeMenu() {
      menu.hidden = true;
      chip.setAttribute('aria-expanded', 'false');
    }
    function openMenuNow() {
      buildMenu();
      menu.hidden = false;
      chip.setAttribute('aria-expanded', 'true');
      var f = menu.querySelector('button,a');
      if (f) f.focus();
    }
    chip.addEventListener('click', function () {
      if (!state.ready) return;
      if (!state.user && state.storage !== 'ready') {
        storageDialog();
        return;
      }
      if (!state.user) {
        authDialog({});
        return;
      }
      menu.hidden ? openMenuNow() : closeMenu();
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !wrap.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) closeMenu();
    });

    function buildMenu() {
      menu.innerHTML = '';
      if (!state.user) return;
      var c = state.counts || {};
      menu.appendChild(
        el('div', { class: 'tasa-who' }, [
          el('b', { text: state.user.name || state.user.email }),
          el('span', { text: state.user.email }),
        ])
      );
      var rows = [
        { label: 'My work', href: '/work', n: (c.trees || 0) + (c.runs || 0) + (c.documents || 0) },
        { label: 'Saved paths', href: '/work#runs', n: c.runs || 0 },
        { label: 'Documents', href: '/work#documents', n: c.documents || 0 },
        { label: 'Trees', href: '/work#trees', n: c.trees || 0 },
      ];
      rows.forEach(function (r) {
        menu.appendChild(
          el('a', { href: r.href, role: 'menuitem' }, [
            document.createTextNode(r.label),
            el('span', { class: 'tasa-n', text: String(r.n) }),
          ])
        );
      });
      menu.appendChild(el('hr'));
      menu.appendChild(
        el('button', {
          type: 'button',
          role: 'menuitem',
          text: 'Account settings',
          onclick: function () {
            closeMenu();
            accountDialog();
          },
        })
      );
      menu.appendChild(
        el('button', {
          type: 'button',
          role: 'menuitem',
          text: 'Sign out',
          onclick: function () {
            closeMenu();
            signOut().then(function () {
              toast('Signed out. You are using the tool as a guest.', null);
            });
          },
        })
      );
    }

    function paint() {
      chip.classList.toggle('guest', !state.user);
      chip.classList.toggle('off', state.storage !== 'ready');
      chip.innerHTML = '';
      if (!state.ready) {
        chip.appendChild(icon(ICON_SIGNIN));
        chip.appendChild(el('span', { text: 'Sign in' }));
        chip.title = 'Checking whether saving is available';
        return;
      }
      if (state.user) {
        /* Initials are a face when there is a person behind them. */
        chip.appendChild(el('span', { class: 'tasa-av', text: initials(state.user) }));
        chip.appendChild(
          el('span', { text: (state.user.name || state.user.email).split(/\s+/)[0].slice(0, 18) })
        );
        chip.title = 'Signed in as ' + state.user.email + ' — your work is kept';
      } else if (state.storage !== 'ready') {
        /* An icon, not a letter in a circle: an avatar with a punctuation mark
           where a face goes reads as something having gone wrong, and nothing
           has — there is simply no account here to show. */
        chip.appendChild(icon(ICON_NOSAVE));
        chip.appendChild(el('span', { text: 'No saving' }));
        chip.title = 'This deployment has no storage — nothing can be saved to an account';
      } else {
        chip.appendChild(icon(ICON_SIGNIN));
        chip.appendChild(el('span', { text: 'Sign in' }));
        chip.title = 'Sign in to keep your work';
      }
      if (!menu.hidden) buildMenu();
    }
    paint();
    events.on('change', paint);
    return { chip: chip, paint: paint };
  }

  function storageDialog() {
    var m = modal({ title: 'Saving is not set up here', kicker: 'Guest use only' });
    m.body.appendChild(
      message(
        state.storage === 'unconfigured'
          ? 'This deployment has no database behind it, so there are no accounts and nothing can be kept on the server. ' +
              'Everything else works: answer the questions, print the result, edit the tree in this browser.'
          : 'The database did not answer, so signing in and saving are unavailable right now. Everything else works.',
        'warn'
      )
    );
    m.body.appendChild(
      message(GUEST_COPY + '<br><br>Use <b>Print</b> to keep a copy of anything that matters.', null)
    );
    m.foot.appendChild(el('span', { class: 'grow' }));
    m.foot.appendChild(
      el('button', {
        class: 'tasa-b solid',
        type: 'button',
        text: 'Carry on',
        onclick: function () {
          ackGuest();
          m.close(null);
        },
      })
    );
    return m.done;
  }

  /* A one-time, dismissable note for a guest, shown only where saving is the
     point of the page. Never a gate: the tool is usable without it. */
  function guestNudge(text) {
    if (!state.ready || state.user || state.storage !== 'ready' || guestAcked()) return;
    ackGuest();
    toast(text || 'You are a guest — nothing you do here is saved. Sign in to keep it.', 'warn', {
      ms: 9000,
      action: 'Sign in',
      onAction: function () {
        authDialog({});
      },
    });
  }

  /* ---- ready ----------------------------------------------------------- */
  var readyP = null;
  function ready() {
    if (!readyP) readyP = refresh();
    return readyP;
  }

  /* ---- error reporting ------------------------------------------------- */
  /* One place that turns an ApiError into something a person can act on, so
     no caller has to guess at wording. */
  function report(err, what) {
    if (!err) return;
    if (err.code === 'auth_required') {
      requireSignIn(
        '<b>You are signed out.</b> ' +
          (what ? 'Sign in again to ' + what + '.' : 'Sign in again to save your work.')
      );
      refresh(true);
      return;
    }
    if (err.code === 'storage_unavailable' || err.code === 'no_api') {
      toast(err.message, 'bad', { ms: 8000 });
      refresh(true);
      return;
    }
    if (err.code === 'rate_limited') {
      toast(err.message, 'warn', { ms: 8000 });
      return;
    }
    toast(err.message || 'That did not work.', 'bad');
  }

  window.TAS = {
    __loaded: true,
    api: api,
    auth: {
      state: state,
      ready: ready,
      refresh: refresh,
      signIn: signIn,
      register: register,
      signOut: signOut,
      canSave: canSave,
      /* may this visitor be shown the editor */
      isAdmin: function () {
        return !!state.admin;
      },
      requireSignIn: requireSignIn,
      dialog: authDialog,
      account: accountDialog,
      on: events.on,
      guestNudge: guestNudge,
      guestCopy: GUEST_COPY,
    },
    store: store,
    ui: {
      toast: toast,
      modal: modal,
      confirm: confirmDialog,
      field: field,
      message: message,
      el: el,
      esc: esc,
      mountChip: mountChip,
      report: report,
      injectCss: injectCss,
    },
  };

  /* Coming back from Google. The mark says what happened; it is taken off the
     URL straight away so a refresh, a bookmark or a shared link does not
     announce it a second time. */
  function announceReturn() {
    var url;
    try {
      url = new URL(location.href);
    } catch (e) {
      return;
    }
    var mark = url.searchParams.get('signin');
    if (!mark) return;
    url.searchParams.delete('signin');
    try {
      history.replaceState(null, '', url.pathname + (url.search || '') + (url.hash || ''));
    } catch (e) {}
    var said = {
      google: 'Signed in with Google.',
      new: 'Account created with Google. Your work will be kept from now on.',
      linked:
        'Signed in with Google, and joined to the account already registered on that address.',
      attached: 'Google is attached to your account. Either way in now works.',
      cancelled: 'That Google sign-in was cancelled. Nothing has changed.',
    }[mark];
    if (said) toast(said, mark === 'cancelled' ? null : 'good', { ms: 6000 });
  }

  /* Mount as soon as the bar exists, and ask the server who we are. */
  function boot() {
    injectCss();
    /* window.TAS_CHIP = false, set before this file loads, declines the chip.
       The editor takes it: it gates the whole page on one account, so a
       "Sign in" button in its toolbar would be offering something the page
       has already insisted on. */
    if (window.TAS_CHIP !== false) mountChip();
    announceReturn();
    ready();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
