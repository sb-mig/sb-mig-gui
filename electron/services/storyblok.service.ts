/**
 * Storyblok Service
 *
 * Provides direct access to Storyblok Management API for:
 * - Fetching stories and building tree structures
 * - Copying stories between spaces
 *
 * Uses OAuth token for authentication with the Management API.
 * API Docs: https://www.storyblok.com/docs/api/management/stories
 */

const STORYBLOK_MAPI_URL = "https://mapi.storyblok.com/v1";

/**
 * Story object from Storyblok API
 */
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

/**
 * Tree node for displaying stories hierarchically
 */
export interface StoryTreeNode {
  id: number;
  name: string;
  slug: string;
  full_slug: string;
  is_folder: boolean;
  is_startpage: boolean;
  parent_id: number | null;
  children: StoryTreeNode[];
  story: StoryblokStory;
}

/**
 * Result of fetching stories
 */
export interface FetchStoriesResult {
  stories: StoryblokStory[];
  tree: StoryTreeNode[];
  total: number;
}

/**
 * Copy operation progress
 */
export interface CopyProgress {
  current: number;
  total: number;
  currentStory: string;
  status: "pending" | "copying" | "done" | "error";
  error?: string;
}

class StoryblokService {
  /**
   * Fetch all stories from a space
   */
  async fetchStories(
    spaceId: string,
    oauthToken: string
  ): Promise<FetchStoriesResult> {
    const stories: StoryblokStory[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(
        `${STORYBLOK_MAPI_URL}/spaces/${spaceId}/stories/?page=${page}&per_page=${perPage}`,
        {
          headers: {
            Authorization: oauthToken,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Failed to fetch stories: ${response.status} - ${error}`
        );
      }

      const data = await response.json();
      const fetchedStories = data.stories || [];

      stories.push(...fetchedStories);

      const total = parseInt(response.headers.get("total") || "0", 10);
      hasMore = stories.length < total;
      page++;

      if (page > 1000) {
        break;
      }
    }

    const tree = this.buildTree(stories);

    return {
      stories,
      tree,
      total: stories.length,
    };
  }

  /**
   * Fetch a single story with full content
   */
  async fetchStory(
    spaceId: string,
    storyId: number,
    oauthToken: string
  ): Promise<StoryblokStory> {
    const response = await fetch(
      `${STORYBLOK_MAPI_URL}/spaces/${spaceId}/stories/${storyId}`,
      {
        headers: {
          Authorization: oauthToken,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch story: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.story;
  }

  /**
   * Get story by slug
   */
  async getStoryBySlug(
    spaceId: string,
    slug: string,
    oauthToken: string
  ): Promise<StoryblokStory | null> {
    const response = await fetch(
      `${STORYBLOK_MAPI_URL}/spaces/${spaceId}/stories/?with_slug=${encodeURIComponent(
        slug
      )}`,
      {
        headers: {
          Authorization: oauthToken,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.stories?.[0] || null;
  }

  /**
   * Create a story in a space
   */
  async createStory(
    spaceId: string,
    story: Partial<StoryblokStory> & { name: string; slug: string },
    oauthToken: string
  ): Promise<StoryblokStory> {
    const response = await fetch(
      `${STORYBLOK_MAPI_URL}/spaces/${spaceId}/stories/`,
      {
        method: "POST",
        headers: {
          Authorization: oauthToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ story }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create story: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.story;
  }

  /**
   * Build a tree structure from flat story list
   */
  buildTree(stories: StoryblokStory[]): StoryTreeNode[] {
    const storyMap = new Map<number, StoryTreeNode>();

    // First pass: create all nodes
    for (const story of stories) {
      storyMap.set(story.id, {
        id: story.id,
        name: story.name,
        slug: story.slug,
        full_slug: story.full_slug,
        is_folder: story.is_folder,
        is_startpage: story.is_startpage,
        parent_id: story.parent_id,
        children: [],
        story,
      });
    }

    // Second pass: build tree structure
    const rootNodes: StoryTreeNode[] = [];

    for (const story of stories) {
      const node = storyMap.get(story.id)!;

      if (story.parent_id === null || story.parent_id === 0) {
        rootNodes.push(node);
      } else {
        const parent = storyMap.get(story.parent_id);
        if (parent) {
          parent.children.push(node);
        } else {
          rootNodes.push(node);
        }
      }
    }

    // Sort children
    const sortNodes = (nodes: StoryTreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.is_folder && !b.is_folder) return -1;
        if (!a.is_folder && b.is_folder) return 1;
        if (a.story.position !== b.story.position) {
          return a.story.position - b.story.position;
        }
        return a.name.localeCompare(b.name);
      });

      for (const node of nodes) {
        if (node.children.length > 0) {
          sortNodes(node.children);
        }
      }
    };

    sortNodes(rootNodes);

    return rootNodes;
  }

  /**
   * Copy stories from source space to target space
   */
  async copyStories(
    sourceSpaceId: string,
    targetSpaceId: string,
    storyIds: number[],
    destinationParentId: number | null,
    oauthToken: string,
    onProgress?: (progress: CopyProgress) => void
  ): Promise<{ success: boolean; copiedCount: number; errors: string[] }> {
    const errors: string[] = [];
    let copiedCount = 0;

    // Fetch all stories with their full content - batched for performance
    // Use batches of 5 to respect API rate limits while still gaining parallelism
    const BATCH_SIZE = 5;
    const storiesToCopy: StoryblokStory[] = [];

    for (let batchStart = 0; batchStart < storyIds.length; batchStart += BATCH_SIZE) {
      const batchIds = storyIds.slice(batchStart, batchStart + BATCH_SIZE);

      onProgress?.({
        current: batchStart + 1,
        total: storyIds.length,
        currentStory: `Fetching stories ${batchStart + 1}-${Math.min(batchStart + BATCH_SIZE, storyIds.length)}...`,
        status: "copying",
      });

      // Fetch batch in parallel
      const batchResults = await Promise.allSettled(
        batchIds.map(storyId => this.fetchStory(sourceSpaceId, storyId, oauthToken))
      );

      // Process results
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          storiesToCopy.push(result.value);
        } else {
          errors.push(`Failed to fetch story ${batchIds[index]}: ${result.reason}`);
        }
      });
    }

    // Build tree from selected stories
    const tree = this.buildTree(storiesToCopy);

    // Map of old IDs to new IDs
    const idMap = new Map<number, number>();

    // Helper to create a single story and recursively create its children
    const createStoryWithChildren = async (
      node: StoryTreeNode,
      newParentId: number | null
    ): Promise<void> => {
      onProgress?.({
        current: copiedCount + 1,
        total: storiesToCopy.length,
        currentStory: node.name,
        status: "copying",
      });

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, uuid, ...storyData } = node.story;
        const newStory = await this.createStory(
          targetSpaceId,
          {
            ...storyData,
            parent_id: newParentId,
          },
          oauthToken
        );

        idMap.set(node.id, newStory.id);
        copiedCount++;

        // Recursively create children (in parallel batches)
        if (node.children.length > 0) {
          await createSiblingsInBatches(node.children, newStory.id);
        }
      } catch (error) {
        errors.push(`Failed to create "${node.name}": ${error}`);
      }
    };

    // Create sibling nodes in parallel batches (respects rate limits while gaining parallelism)
    const createSiblingsInBatches = async (
      nodes: StoryTreeNode[],
      newParentId: number | null
    ): Promise<void> => {
      // Batch size of 3 to respect Storyblok's rate limit (3 req/sec for MAPI)
      const SIBLING_BATCH_SIZE = 3;

      for (let i = 0; i < nodes.length; i += SIBLING_BATCH_SIZE) {
        const batch = nodes.slice(i, i + SIBLING_BATCH_SIZE);
        // Create siblings in this batch in parallel
        await Promise.all(
          batch.map(node => createStoryWithChildren(node, newParentId))
        );
      }
    };

    // Start creating from root nodes (in parallel batches)
    await createSiblingsInBatches(tree, destinationParentId);

    onProgress?.({
      current: copiedCount,
      total: storiesToCopy.length,
      currentStory: "Complete",
      status: errors.length > 0 ? "error" : "done",
    });

    return {
      success: errors.length === 0,
      copiedCount,
      errors,
    };
  }
}

export const storyblokService = new StoryblokService();
