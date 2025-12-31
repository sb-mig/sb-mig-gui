/**
 * Global Type Definitions
 *
 * Type definitions for the window.sbmigGui API exposed by the preload script.
 */

// ============================================================================
// Global Types (available without import)
// ============================================================================

declare global {
  // sb-mig Types
  interface SbmigEnvironment {
    oauthToken?: string
    spaceId?: string
    accessToken?: string
  }

  interface SbmigExecuteResult {
    success: boolean
    exitCode: number | null
    error?: string
  }

  interface SbmigValidateResult {
    success: boolean
    version?: string
    config?: Record<string, unknown>
    error?: string
  }

  interface SbmigOutputEvent {
    type: 'stdout' | 'stderr' | 'info' | 'error' | 'complete'
    data: string
    timestamp: number
  }

  interface SbmigDiscoveredComponent {
    name: string
    filePath: string
    type: 'local' | 'external'
  }

  interface SbmigDebugInfo {
    home: string
    fnmDirMac: string
    fnmDirMacExists: boolean
    fnmVersions: string[]
    extendedPath: string
    sbmigFound: boolean
    sbmigVersion: string | null
    error: string | null
  }

  // Storyblok Types
  interface StoryblokStory {
    id: number
    name: string
    slug: string
    full_slug: string
    parent_id: number | null
    is_folder: boolean
    is_startpage: boolean
    position: number
    uuid: string
    content?: Record<string, unknown>
    created_at: string
    updated_at: string
    published_at: string | null
    published: boolean
  }

  interface StoryblokTreeNode {
    id: number
    name: string
    slug: string
    full_slug: string
    is_folder: boolean
    is_startpage: boolean
    parent_id: number | null
    children: StoryblokTreeNode[]
    story: StoryblokStory
  }

  interface StoryblokFetchStoriesResult {
    stories: StoryblokStory[]
    tree: StoryblokTreeNode[]
    total: number
  }

  interface StoryblokCopyProgress {
    current: number
    total: number
    currentStory: string
    status: 'pending' | 'copying' | 'done' | 'error'
    error?: string
  }

  interface StoryblokCopyResult {
    success: boolean
    copiedCount: number
    errors: string[]
  }

  interface ApiV2SyncResult {
    created: string[]
    updated: string[]
    skipped: string[]
    errors: { name: string; message: string }[]
  }

  // Window API
  interface SbmigGuiAPI {
    db: {
      getSetting: (key: string) => Promise<string | null>
      setSetting: (key: string, value: string) => Promise<void>
      deleteSetting: (key: string) => Promise<void>
    }
    sbmig: {
      execute: (
        command: string,
        args: string[],
        workingDir: string,
        env: SbmigEnvironment
      ) => Promise<SbmigExecuteResult>
      validate: (workingDir: string, env: SbmigEnvironment) => Promise<SbmigValidateResult>
      getVersion: () => Promise<string | null>
      isInstalled: () => Promise<boolean>
      getDebugInfo: () => Promise<SbmigDebugInfo>
      isRunning: () => Promise<boolean>
      killProcess: () => Promise<boolean>
      selectDirectory: () => Promise<string | null>
      discoverComponents: (workingDir: string) => Promise<SbmigDiscoveredComponent[]>
      discoverDatasources: (workingDir: string) => Promise<SbmigDiscoveredComponent[]>
      discoverRoles: (workingDir: string) => Promise<SbmigDiscoveredComponent[]>
      onOutput: (callback: (event: SbmigOutputEvent) => void) => () => void
    }
    storyblok: {
      fetchStories: (spaceId: string, oauthToken: string) => Promise<StoryblokFetchStoriesResult>
      fetchStory: (spaceId: string, storyId: number, oauthToken: string) => Promise<StoryblokStory>
      getStoryBySlug: (
        spaceId: string,
        slug: string,
        oauthToken: string
      ) => Promise<StoryblokStory | null>
      copyStories: (
        sourceSpaceId: string,
        targetSpaceId: string,
        storyIds: number[],
        destinationParentId: number | null,
        oauthToken: string
      ) => Promise<StoryblokCopyResult>
      onCopyProgress: (callback: (progress: StoryblokCopyProgress) => void) => () => void
    }

    apiV2: {
      fetchStories: (spaceId: string, oauthToken: string) => Promise<StoryblokFetchStoriesResult>
      fetchStory: (spaceId: string, storyId: number, oauthToken: string) => Promise<StoryblokStory>
      getStoryBySlug: (
        spaceId: string,
        slug: string,
        oauthToken: string
      ) => Promise<StoryblokStory | null>
      copyStories: (
        sourceSpaceId: string,
        targetSpaceId: string,
        storyIds: number[],
        destinationParentId: number | null,
        oauthToken: string
      ) => Promise<StoryblokCopyResult>
      onCopyProgress: (callback: (progress: StoryblokCopyProgress) => void) => () => void

      discoverComponents: (workingDir: string) => Promise<SbmigDiscoveredComponent[]>
      discoverDatasources: (workingDir: string) => Promise<SbmigDiscoveredComponent[]>
      discoverRoles: (workingDir: string) => Promise<SbmigDiscoveredComponent[]>

      syncRoles: (spaceId: string, oauthToken: string, roles: any[], dryRun?: boolean) => Promise<ApiV2SyncResult>
      syncDatasources: (
        spaceId: string,
        oauthToken: string,
        datasources: any[],
        dryRun?: boolean
      ) => Promise<ApiV2SyncResult>
      syncComponents: (
        spaceId: string,
        oauthToken: string,
        components: any[],
        options?: { presets?: boolean; ssot?: boolean; dryRun?: boolean }
      ) => Promise<ApiV2SyncResult>
      syncPlugins: (
        spaceId: string,
        oauthToken: string,
        plugins: { name: string; body: string }[],
        dryRun?: boolean
      ) => Promise<ApiV2SyncResult>
    }
  }

  interface Window {
    sbmigGui: SbmigGuiAPI
  }
}

export {}
