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

const STORYBLOK_MAPI_URL = 'https://mapi.storyblok.com/v1'

/**
 * Story object from Storyblok API
 */
export interface StoryblokStory {
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

/**
 * Tree node for displaying stories hierarchically
 */
export interface StoryTreeNode {
  id: number
  name: string
  slug: string
  full_slug: string
  is_folder: boolean
  is_startpage: boolean
  parent_id: number | null
  children: StoryTreeNode[]
  story: StoryblokStory
}

/**
 * Result of fetching stories
 */
export interface FetchStoriesResult {
  stories: StoryblokStory[]
  tree: StoryTreeNode[]
  total: number
}

/**
 * Copy operation progress
 */
export interface CopyProgress {
  current: number
  total: number
  currentStory: string
  status: 'pending' | 'copying' | 'done' | 'error'
  error?: string
}

class StoryblokService {
  /**
   * Fetch all stories from a space
   */
  async fetchStories(spaceId: string, oauthToken: string): Promise<FetchStoriesResult> {
    const stories: StoryblokStory[] = []
    let page = 1
    const perPage = 100
    let hasMore = true

    while (hasMore) {
      const response = await fetch(
        `${STORYBLOK_MAPI_URL}/spaces/${spaceId}/stories/?page=${page}&per_page=${perPage}`,
        {
          headers: {
            Authorization: oauthToken,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Failed to fetch stories: ${response.status} - ${error}`)
      }

      const data = await response.json()
      const fetchedStories = data.stories || []

      stories.push(...fetchedStories)

      const total = parseInt(response.headers.get('total') || '0', 10)
      hasMore = stories.length < total
      page++

      if (page > 1000) {
        break
      }
    }

    const tree = this.buildTree(stories)

    return {
      stories,
      tree,
      total: stories.length,
    }
  }

  /**
   * Fetch a single story with full content
   */
  async fetchStory(spaceId: string, storyId: number, oauthToken: string): Promise<StoryblokStory> {
    const response = await fetch(`${STORYBLOK_MAPI_URL}/spaces/${spaceId}/stories/${storyId}`, {
      headers: {
        Authorization: oauthToken,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to fetch story: ${response.status} - ${error}`)
    }

    const data = await response.json()
    return data.story
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
      `${STORYBLOK_MAPI_URL}/spaces/${spaceId}/stories/?with_slug=${encodeURIComponent(slug)}`,
      {
        headers: {
          Authorization: oauthToken,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.stories?.[0] || null
  }

  /**
   * Create a story in a space
   */
  async createStory(
    spaceId: string,
    story: Partial<StoryblokStory> & { name: string; slug: string },
    oauthToken: string
  ): Promise<StoryblokStory> {
    const response = await fetch(`${STORYBLOK_MAPI_URL}/spaces/${spaceId}/stories/`, {
      method: 'POST',
      headers: {
        Authorization: oauthToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ story }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to create story: ${response.status} - ${error}`)
    }

    const data = await response.json()
    return data.story
  }

  /**
   * Build a tree structure from flat story list
   */
  buildTree(stories: StoryblokStory[]): StoryTreeNode[] {
    const storyMap = new Map<number, StoryTreeNode>()

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
      })
    }

    // Second pass: build tree structure
    const rootNodes: StoryTreeNode[] = []

    for (const story of stories) {
      const node = storyMap.get(story.id)!

      if (story.parent_id === null || story.parent_id === 0) {
        rootNodes.push(node)
      } else {
        const parent = storyMap.get(story.parent_id)
        if (parent) {
          parent.children.push(node)
        } else {
          rootNodes.push(node)
        }
      }
    }

    // Sort children
    const sortNodes = (nodes: StoryTreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.is_folder && !b.is_folder) return -1
        if (!a.is_folder && b.is_folder) return 1
        if (a.story.position !== b.story.position) {
          return a.story.position - b.story.position
        }
        return a.name.localeCompare(b.name)
      })

      for (const node of nodes) {
        if (node.children.length > 0) {
          sortNodes(node.children)
        }
      }
    }

    sortNodes(rootNodes)

    return rootNodes
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
    const errors: string[] = []
    let copiedCount = 0

    // Fetch all stories with their full content
    const storiesToCopy: StoryblokStory[] = []
    for (let i = 0; i < storyIds.length; i++) {
      const storyId = storyIds[i]
      onProgress?.({
        current: i + 1,
        total: storyIds.length,
        currentStory: `Fetching story ${storyId}...`,
        status: 'copying',
      })

      try {
        const story = await this.fetchStory(sourceSpaceId, storyId, oauthToken)
        storiesToCopy.push(story)
      } catch (error) {
        errors.push(`Failed to fetch story ${storyId}: ${error}`)
      }
    }

    // Build tree from selected stories
    const tree = this.buildTree(storiesToCopy)

    // Map of old IDs to new IDs
    const idMap = new Map<number, number>()

    // Recursive function to create stories maintaining hierarchy
    const createInOrder = async (
      nodes: StoryTreeNode[],
      newParentId: number | null
    ): Promise<void> => {
      for (const node of nodes) {
        onProgress?.({
          current: copiedCount + 1,
          total: storiesToCopy.length,
          currentStory: node.name,
          status: 'copying',
        })

        try {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, uuid, ...storyData } = node.story
          const newStory = await this.createStory(
            targetSpaceId,
            {
              ...storyData,
              parent_id: newParentId,
            },
            oauthToken
          )

          idMap.set(node.id, newStory.id)
          copiedCount++

          // Recursively create children
          if (node.children.length > 0) {
            await createInOrder(node.children, newStory.id)
          }
        } catch (error) {
          errors.push(`Failed to create "${node.name}": ${error}`)
        }
      }
    }

    // Start creating from root nodes
    await createInOrder(tree, destinationParentId)

    onProgress?.({
      current: copiedCount,
      total: storiesToCopy.length,
      currentStory: 'Complete',
      status: errors.length > 0 ? 'error' : 'done',
    })

    return {
      success: errors.length === 0,
      copiedCount,
      errors,
    }
  }
}

export const storyblokService = new StoryblokService()

