export async function waitForGoogle(operation, milliseconds = 60000) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(
            "Google sign-in is still waiting. Check for a Google window or a blocked-popup indicator. Close any unfinished Google window, then retry. You can also open Page Grove in a regular browser tab.",
          );
          error.code = "grove/google-timeout";
          reject(error);
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function googleAuthMessage(error) {
  const messages = {
    "auth/popup-blocked":
      "Your browser blocked Google’s sign-in window. Allow popups for this Page Grove site, then try again. If you are in an installed app or an embedded browser, open Page Grove in a regular browser tab.",
    "auth/popup-closed-by-user":
      "The Google window closed before sign-in finished. You can try again.",
    "auth/cancelled-popup-request":
      "A newer Google sign-in attempt replaced this one. Complete the latest Google window.",
    "auth/network-request-failed":
      "Google sign-in could not connect. Check your internet connection and whether a browser extension is blocking Google or Firebase requests, then retry.",
    "auth/web-storage-unsupported":
      "This browser is preventing sign-in storage. Open Page Grove in a regular browser tab with site storage enabled.",
    "auth/unauthorized-domain":
      "Google sign-in is not enabled for this address. Open https://pagegrovehq.github.io/pagegrovehq/ and try again.",
    "auth/operation-not-allowed":
      "Google sign-in is not enabled in this Firebase project. The app owner needs to enable the Google provider.",
    "auth/account-exists-with-different-credential":
      "Use the Google email belonging to your existing Page Grove account. If another device is still signed in with email, connect Google sign-in there first to retain the same library owner.",
    "auth/credential-already-in-use":
      "That Google account is linked to a different Page Grove account. Choose the Google account matching the email shown here; do not create another account to recover your library.",
    "auth/user-mismatch":
      "Choose the same Google account that is already signed in to Page Grove.",
  };
  return (
    messages[error?.code] ||
    error?.message ||
    "Google sign-in did not finish. Please try again."
  );
}
