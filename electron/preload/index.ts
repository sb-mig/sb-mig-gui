/**
 * Preload Script
 *
 * Exposes a secure, typed API to the renderer process.
 * Uses contextBridge to safely expose IPC functions.
 */

import { contextBridge, ipcRenderer } from "electron";

// ============================================================================
// Types
// ============================================================================

export interface SbmigEnvironment {
  oauthToken?: string;
  spaceId?: string;
  accessToken?: string;
}

export interface SbmigExecuteResult {
  success: boolean;
  exitCode: number | null;
  error?: string;
}

export interface SbmigValidateResult {
  success: boolean;
  version?: string;
  config?: Record<string, unknown>;
  error?: string;
}

export interface SbmigOutputEvent {
  type: "stdout" | "stderr" | "info" | "error" | "complete";
  data: string;
  timestamp: number;
}

export interface SbmigDiscoveredComponent {
  name: string;
  filePath: string;
  type: "local" | "external";
}

export interface SbmigDebugInfo {
  home: string;
  fnmDirMac: string;
  fnmDirMacExists: boolean;
  fnmVersions: string[];
  extendedPath: string;
  sbmigFound: boolean;
  sbmigVersion: string | null;
  error: string | null;
}

export interface StoryblokStory {
  id: number;
  name: string;
  slug: string;
  full_slug: string;
  parent_id: number | null;
  is_folder: boolean;
  is_startpage: boolean;
  position: number;
  uuid: string;
  content?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  published: boolean;
}

export interface StoryblokTreeNode {
  id: number;
  name: string;
  slug: string;
  full_slug: string;
  is_folder: boolean;
  is_startpage: boolean;
  parent_id: number | null;
  children: StoryblokTreeNode[];
  story: StoryblokStory;
}

export interface StoryblokFetchStoriesResult {
  stories: StoryblokStory[];
  tree: StoryblokTreeNode[];
  total: number;
}

export interface StoryblokCopyProgress {
  current: number;
  total: number;
  currentStory: string;
  status: "pending" | "copying" | "done" | "error";
  error?: string;
}

export interface StoryblokCopyResult {
  success: boolean;
  copiedCount: number;
  errors: string[];
}

// ============================================================================
// API v2 types (sb-mig)
// ============================================================================

export interface ApiV2SyncResult {
  created: string[];
  updated: string[];
  skipped: string[];
  errors: { name: string; message: string }[];
}

export interface ApiV2SyncProgressEvent {
  type: "start" | "progress" | "complete";
  current?: number;
  total?: number;
  name?: string;
  action?:
    | "creating"
    | "updating"
    | "created"
    | "updated"
    | "skipped"
    | "error";
  message?: string;
}

// ============================================================================
// API Definition
// ============================================================================

const api = {
  /**
   * Database API - Settings storage
   */
  db: {
    getSetting: (key: string): Promise<string | null> =>
      ipcRenderer.invoke("db:getSetting", key),

    setSetting: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke("db:setSetting", key, value),

    deleteSetting: (key: string): Promise<void> =>
      ipcRenderer.invoke("db:deleteSetting", key),
  },

  /**
   * sb-mig API - CLI operations
   */
  sbmig: {
    execute: (
      command: string,
      args: string[],
      workingDir: string,
      env: SbmigEnvironment
    ): Promise<SbmigExecuteResult> =>
      ipcRenderer.invoke("sbmig:execute", command, args, workingDir, env),

    validate: (
      workingDir: string,
      env: SbmigEnvironment
    ): Promise<SbmigValidateResult> =>
      ipcRenderer.invoke("sbmig:validate", workingDir, env),

    getVersion: (): Promise<string | null> =>
      ipcRenderer.invoke("sbmig:getVersion"),

    getBundledVersion: (): Promise<string | null> =>
      ipcRenderer.invoke("sbmig:getBundledVersion"),

    isInstalled: (): Promise<boolean> =>
      ipcRenderer.invoke("sbmig:isInstalled"),

    getDebugInfo: (): Promise<SbmigDebugInfo> =>
      ipcRenderer.invoke("sbmig:getDebugInfo"),

    isRunning: (): Promise<boolean> => ipcRenderer.invoke("sbmig:isRunning"),

    killProcess: (): Promise<boolean> =>
      ipcRenderer.invoke("sbmig:killProcess"),

    selectDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke("sbmig:selectDirectory"),

    discoverComponents: (
      workingDir: string
    ): Promise<SbmigDiscoveredComponent[]> =>
      ipcRenderer.invoke("sbmig:discoverComponents", workingDir),

    discoverDatasources: (
      workingDir: string
    ): Promise<SbmigDiscoveredComponent[]> =>
      ipcRenderer.invoke("sbmig:discoverDatasources", workingDir),

    discoverRoles: (workingDir: string): Promise<SbmigDiscoveredComponent[]> =>
      ipcRenderer.invoke("sbmig:discoverRoles", workingDir),

    onOutput: (callback: (event: SbmigOutputEvent) => void): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        outputEvent: SbmigOutputEvent
      ) => {
        callback(outputEvent);
      };
      ipcRenderer.on("sbmig:output", handler);
      return () => {
        ipcRenderer.removeListener("sbmig:output", handler);
      };
    },
  },

  /**
   * Storyblok API - Direct Management API access
   */
  storyblok: {
    fetchStories: (
      spaceId: string,
      oauthToken: string
    ): Promise<StoryblokFetchStoriesResult> =>
      ipcRenderer.invoke("storyblok:fetchStories", spaceId, oauthToken),

    fetchStory: (
      spaceId: string,
      storyId: number,
      oauthToken: string
    ): Promise<StoryblokStory> =>
      ipcRenderer.invoke("storyblok:fetchStory", spaceId, storyId, oauthToken),

    getStoryBySlug: (
      spaceId: string,
      slug: string,
      oauthToken: string
    ): Promise<StoryblokStory | null> =>
      ipcRenderer.invoke("storyblok:getStoryBySlug", spaceId, slug, oauthToken),

    copyStories: (
      sourceSpaceId: string,
      targetSpaceId: string,
      storyIds: number[],
      destinationParentId: number | null,
      oauthToken: string
    ): Promise<StoryblokCopyResult> =>
      ipcRenderer.invoke(
        "storyblok:copyStories",
        sourceSpaceId,
        targetSpaceId,
        storyIds,
        destinationParentId,
        oauthToken
      ),

    onCopyProgress: (
      callback: (progress: StoryblokCopyProgress) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: StoryblokCopyProgress
      ) => {
        callback(progress);
      };
      ipcRenderer.on("storyblok:copyProgress", handler);
      return () => {
        ipcRenderer.removeListener("storyblok:copyProgress", handler);
      };
    },
  },

  /**
   * API v2 - sb-mig library (preferred for API mode)
   */
  apiV2: {
    fetchStories: (
      spaceId: string,
      oauthToken: string
    ): Promise<StoryblokFetchStoriesResult> =>
      ipcRenderer.invoke("apiv2:fetchStories", spaceId, oauthToken),

    fetchStory: (
      spaceId: string,
      storyId: number,
      oauthToken: string
    ): Promise<StoryblokStory> =>
      ipcRenderer.invoke("apiv2:fetchStory", spaceId, storyId, oauthToken),

    getStoryBySlug: (
      spaceId: string,
      slug: string,
      oauthToken: string
    ): Promise<StoryblokStory | null> =>
      ipcRenderer.invoke("apiv2:getStoryBySlug", spaceId, slug, oauthToken),

    copyStories: (
      sourceSpaceId: string,
      targetSpaceId: string,
      storyIds: number[],
      destinationParentId: number | null,
      oauthToken: string
    ): Promise<StoryblokCopyResult> =>
      ipcRenderer.invoke(
        "apiv2:copyStories",
        sourceSpaceId,
        targetSpaceId,
        storyIds,
        destinationParentId,
        oauthToken
      ),

    onCopyProgress: (
      callback: (progress: StoryblokCopyProgress) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: StoryblokCopyProgress
      ) => {
        callback(progress);
      };
      ipcRenderer.on("apiv2:copyProgress", handler);
      return () => {
        ipcRenderer.removeListener("apiv2:copyProgress", handler);
      };
    },

    onSyncProgress: (
      callback: (progress: ApiV2SyncProgressEvent) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: ApiV2SyncProgressEvent
      ) => {
        callback(progress);
      };
      ipcRenderer.on("apiv2:syncProgress", handler);
      return () => {
        ipcRenderer.removeListener("apiv2:syncProgress", handler);
      };
    },

    discoverComponents: (
      workingDir: string
    ): Promise<SbmigDiscoveredComponent[]> =>
      ipcRenderer.invoke("apiv2:discoverComponents", workingDir),

    discoverDatasources: (
      workingDir: string
    ): Promise<SbmigDiscoveredComponent[]> =>
      ipcRenderer.invoke("apiv2:discoverDatasources", workingDir),

    discoverRoles: (workingDir: string): Promise<SbmigDiscoveredComponent[]> =>
      ipcRenderer.invoke("apiv2:discoverRoles", workingDir),

    // Combined load + sync for components (precompiles TS then syncs)
    loadAndSyncComponents: (
      filePaths: string[],
      spaceId: string,
      oauthToken: string,
      workingDir: string,
      options?: { presets?: boolean; ssot?: boolean }
    ): Promise<ApiV2SyncResult> =>
      ipcRenderer.invoke(
        "apiv2:loadAndSyncComponents",
        filePaths,
        spaceId,
        oauthToken,
        workingDir,
        options
      ),

    syncRoles: (
      spaceId: string,
      oauthToken: string,
      roles: unknown[],
      dryRun?: boolean
    ): Promise<ApiV2SyncResult> =>
      ipcRenderer.invoke("apiv2:syncRoles", spaceId, oauthToken, roles, dryRun),

    syncDatasources: (
      spaceId: string,
      oauthToken: string,
      datasources: unknown[],
      dryRun?: boolean
    ): Promise<ApiV2SyncResult> =>
      ipcRenderer.invoke(
        "apiv2:syncDatasources",
        spaceId,
        oauthToken,
        datasources,
        dryRun
      ),

    syncComponents: (
      spaceId: string,
      oauthToken: string,
      components: unknown[],
      options?: { presets?: boolean; ssot?: boolean; dryRun?: boolean }
    ): Promise<ApiV2SyncResult> =>
      ipcRenderer.invoke(
        "apiv2:syncComponents",
        spaceId,
        oauthToken,
        components,
        options
      ),

    syncPlugins: (
      spaceId: string,
      oauthToken: string,
      plugins: { name: string; body: string }[],
      dryRun?: boolean
    ): Promise<ApiV2SyncResult> =>
      ipcRenderer.invoke(
        "apiv2:syncPlugins",
        spaceId,
        oauthToken,
        plugins,
        dryRun
      ),
  },
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld("sbmigGui", api);

// Log that preload script has loaded
console.log("sb-mig GUI preload script loaded");
