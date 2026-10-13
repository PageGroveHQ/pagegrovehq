import { it, expect, vi, afterEach } from "vitest";
import { waitForGoogle, googleAuthMessage } from "./google-auth";
afterEach(() => vi.useRealTimers());
it("ends a stalled Google operation and handles a later SDK rejection without an unhandled promise", async () => {
  vi.useFakeTimers();
  let rejectSDK;
  const sdk = new Promise((_, reject) => {
    rejectSDK = reject;
  });
  const waiting = waitForGoogle(sdk, 60000);
  const result = expect(waiting).rejects.toMatchObject({
    code: "grove/google-timeout",
  });
  await vi.advanceTimersByTimeAsync(60000);
  await result;
  rejectSDK(new Error("Late popup close"));
  await vi.advanceTimersByTimeAsync(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("clears the timeout after successful Google authentication", async () => {
  vi.useFakeTimers();
  expect(
    await waitForGoogle(Promise.resolve({ uid: "existing-owner" })),
  ).toEqual({ uid: "existing-owner" });
  expect(vi.getTimerCount()).toBe(0);
});
it("explains blocked popups and account mismatch without discarding the original error", () => {
  expect(googleAuthMessage({ code: "auth/popup-blocked" })).toContain(
    "Allow popups for this Page Grove site",
  );
  expect(googleAuthMessage({ code: "auth/user-mismatch" })).toContain(
    "same Google account",
  );
  expect(googleAuthMessage(new Error("Unknown failure"))).toBe(
    "Unknown failure",
  );
});
