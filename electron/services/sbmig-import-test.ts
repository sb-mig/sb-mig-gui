/**
 * Test file to verify we can import from sb-mig
 *
 * Debugging ESM/CJS interop between Electron main (CJS) and sb-mig (ESM).
 */

import { testAsyncConnection, testConnection } from "sb-mig/api-v2";

export async function testDynamicImport() {
  console.log("[sbmig-import-test] Testing sb-mig api-v2 static import...");
  try {
    // #region agent log (H1)
    fetch("http://127.0.0.1:7245/ingest/2a8fc3d7-292a-4522-9c3c-c62f7e925b33", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "debug-session",
        runId: "post-fix",
        hypothesisId: "H1",
        location: "electron/services/sbmig-import-test.ts:entry",
        message: "Static import test entry",
        data: {
          typeofRequire: typeof require,
          typeofModule: typeof module,
          node: process.versions?.node,
          electron: process.versions?.electron,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion agent log (H1)

    const syncResult = testConnection();
    const asyncResult = await testAsyncConnection();

    // #region agent log (H5)
    fetch("http://127.0.0.1:7245/ingest/2a8fc3d7-292a-4522-9c3c-c62f7e925b33", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "debug-session",
        runId: "post-fix",
        hypothesisId: "H5",
        location: "electron/services/sbmig-import-test.ts:ok",
        message: "Static import ok",
        data: { syncResult },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion agent log (H5)

    return {
      success: true,
      method: "static",
      syncResult,
      asyncResult,
    };
  } catch (error) {
    // #region agent log (H3)
    fetch("http://127.0.0.1:7245/ingest/2a8fc3d7-292a-4522-9c3c-c62f7e925b33", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "debug-session",
        runId: "post-fix",
        hypothesisId: "H5",
        location: "electron/services/sbmig-import-test.ts:catch",
        message: "Static import test threw",
        data: { error: String(error).slice(0, 800) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion agent log (H3)
    console.error("[sbmig-import-test] Static import test FAILED:", error);
    return { success: false, method: "static", error: String(error) };
  }
}
