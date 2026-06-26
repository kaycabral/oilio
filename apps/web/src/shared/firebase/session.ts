// Cookie name and lifetime shared between the session API route and the
// server-side reader. Firebase's hosting reverse proxy strips most cookies but
// preserves __session, so we use that name to stay forward-compatible if the
// app is ever served behind Firebase Hosting.
export const SESSION_COOKIE_NAME = '__session'

// Five days, the recommended ceiling for Firebase session cookies; the SDK
// rejects values shorter than 5 minutes or longer than 14 days.
export const SESSION_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 5

// `next` URL handed off from /login to /auth/callback across an OAuth redirect
// flow (signInWithRedirect). Lives in sessionStorage because the popup tab
// path keeps the URL via window.location and doesn't need it.
export const REDIRECT_NEXT_KEY = 'oauth:next'
