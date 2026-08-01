/* =========================================================================
   Vision Guard — google-auth.js
   The Google client ID, and the "Continue with Google" button.

   Imported twice, exactly like catalog.js:
     • the browser, by account.js
     • the server, by functions/api/auth/google.js, which checks that an ID
       token's `aud` claim equals this value

   That is the whole reason it lives in public/ rather than lib/. If the two
   sides could disagree about which client ID is ours, the server would be
   validating tokens minted for somebody else's app — which is precisely the
   check that stops an attacker replaying a Google token from another site.
   One constant, both sides, no drift.

   A client ID is public by design. It ships in the page of every site that
   offers Google sign-in. There is no client SECRET anywhere in this project:
   the flow used here is the ID-token flow, where the browser receives a
   signed assertion and the server verifies the signature against Google's
   published keys. Nothing we hold would help an attacker, so there is
   nothing to leak.
   ========================================================================= */

export const GOOGLE_CLIENT_ID =
  '523216293057-k23pi3f4kksmfvr7v9uq01jacdmsf133.apps.googleusercontent.com';

/* Google's script. Loaded on demand rather than in <head> so a page that
   never shows the button never pays for it, and so a Google outage cannot
   block first paint. */
const GSI_SRC = 'https://accounts.google.com/gsi/client';

let loading = null;
let initialized = false;
let credentialHandler = null;

function loadGsi() {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    return Promise.resolve();
  }
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('gsi_unavailable')); };
    document.head.appendChild(s);
  });
  return loading;
}

/* Renders Google's own button into each given element and calls
   onCredential(idToken) when someone completes the flow.

   Google's button is an iframe it controls; it cannot be restyled beyond the
   options below, and it must not be reimplemented with our own markup — a
   look-alike button that collects Google credentials is a phishing pattern,
   and Google's terms require the real thing. `theme` follows the site's own
   dark/light setting so it does not look pasted on.

   Returns false if Google could not be reached, so the caller can leave the
   email-and-password form as the only path rather than showing a dead
   button. */
export async function mountGoogleButtons(targets, onCredential, opts) {
  const nodes = (Array.isArray(targets) ? targets : [targets]).filter(Boolean);
  if (!nodes.length) return false;

  try {
    await loadGsi();
  } catch (e) {
    return false;
  }

  const gid = window.google.accounts.id;

  /* initialize() is global state, not per-button, and calling it again on
     every language or theme switch made GSI warn that only the last instance
     would be used. Do it once; re-render the buttons as often as we like.
     The callback closes over the latest handler via `credentialHandler`, so
     one initialization stays correct for the life of the page. */
  credentialHandler = onCredential;
  if (!initialized) {
    initialized = true;
    gid.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (res) => {
        if (res && res.credential && credentialHandler) credentialHandler(res.credential);
      },
      /* One Tap is deliberately off. It pops over the page uninvited, and on a
         shop that mostly gets first-time visitors it reads as an interruption
         rather than a convenience. The button is enough. */
      auto_select: false,
      cancel_on_tap_outside: true,
      ux_mode: 'popup'
    });
  }

  const o = opts || {};
  nodes.forEach((node) => {
    node.textContent = '';
    gid.renderButton(node, {
      type: 'standard',
      theme: o.theme === 'light' ? 'outline' : 'filled_black',
      size: 'large',
      shape: 'pill',
      text: o.text || 'continue_with',
      logo_alignment: 'center',
      locale: o.locale === 'en' ? 'en' : 'ar',
      width: o.width || 320
    });
  });
  return true;
}
