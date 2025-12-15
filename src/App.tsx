import { useState, useEffect, useRef, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, Input, Modal, Spinner } from './components/ui'
import { SettingsScreen, StoryblokSpace } from './screens/Settings/SettingsScreen'

/**
 * Output line from sb-mig command
 */
interface OutputLine {
  id: number
  type: 'stdout' | 'stderr' | 'info' | 'error' | 'complete'
  data: string
  timestamp: number
}

/**
 * Resource type for picker
 */
type ResourceType = 'components' | 'datasources' | 'roles'

/**
 * Current view
 */
type AppView = 'main' | 'settings'

/**
 * sb-mig GUI - Main Application
 */
function App() {
  // View state
  const [currentView, setCurrentView] = useState<AppView>('main')

  // Configuration state
  const [oauthToken, setOauthToken] = useState('')
  const [spaces, setSpaces] = useState<StoryblokSpace[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)

  // UI state
  const [isLoading, setIsLoading] = useState(true)
  const [sbmigVersion, setSbmigVersion] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  // Resource picker state
  const [showResourcePicker, setShowResourcePicker] = useState<{
    type: ResourceType
    action: 'sync' | 'backup'
  } | null>(null)
  const [discoveredResources, setDiscoveredResources] = useState<SbmigDiscoveredComponent[]>([])
  const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set())
  const [isDiscovering, setIsDiscovering] = useState(false)

  // Story copy state
  const [showStoryCopyModal, setShowStoryCopyModal] = useState(false)
  const [sourceSpaceId, setSourceSpaceId] = useState<string | null>(null)
  const [targetSpaceId, setTargetSpaceId] = useState<string | null>(null)
  const [storyTree, setStoryTree] = useState<StoryblokTreeNode[]>([])
  const [selectedStoryIds, setSelectedStoryIds] = useState<Set<number>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set())
  const [destinationPath, setDestinationPath] = useState('')
  const [destinationMode, setDestinationMode] = useState<'browse' | 'text'>('browse')
  const [targetStoryTree, setTargetStoryTree] = useState<StoryblokTreeNode[]>([])
  const [isLoadingStories, setIsLoadingStories] = useState(false)
  const [isLoadingTargetTree, setIsLoadingTargetTree] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [copyProgress, setCopyProgress] = useState<StoryblokCopyProgress | null>(null)

  // Terminal output
  const [output, setOutput] = useState<OutputLine[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const outputRef = useRef<HTMLDivElement>(null)
  const lineIdRef = useRef(0)

  // Active space object and derived working directory
  const activeSpace = spaces.find((s) => s.id === activeSpaceId) || null
  const workingDir = activeSpace?.workingDir || ''

  /**
   * Load saved configuration on mount
   */
  useEffect(() => {
    const loadConfig = async () => {
      try {
        // Try to get sb-mig version
        try {
          const version = await window.sbmigGui.sbmig.getVersion()
          setSbmigVersion(version)
        } catch {
          // sb-mig not available
        }

        // Load saved settings
        const savedOauthToken = await window.sbmigGui.db.getSetting('sbmig_oauth_token')
        const savedSpacesJson = await window.sbmigGui.db.getSetting('sbmig_spaces')
        const savedActiveSpace = await window.sbmigGui.db.getSetting('sbmig_active_space')

        if (savedOauthToken) setOauthToken(savedOauthToken)
        if (savedSpacesJson) {
          try {
            setSpaces(JSON.parse(savedSpacesJson))
          } catch {
            // Failed to parse
          }
        }
        if (savedActiveSpace) setActiveSpaceId(savedActiveSpace)
      } catch (error) {
        // Failed to load config
      } finally {
        setIsLoading(false)
      }
    }

    loadConfig()
  }, [])

  /**
   * Subscribe to output events
   */
  useEffect(() => {
    const unsubscribe = window.sbmigGui.sbmig.onOutput((event) => {
      const line: OutputLine = {
        id: lineIdRef.current++,
        type: event.type,
        data: event.data,
        timestamp: event.timestamp,
      }
      setOutput((prev) => [...prev, line])

      if (event.type === 'complete') {
        setIsRunning(false)
      }
    })

    return unsubscribe
  }, [])

  /**
   * Auto-scroll to bottom when new output arrives
   */
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output, autoScroll])

  /**
   * Run sb-mig debug command to validate configuration
   */
  const handleValidate = async () => {
    if (!workingDir) {
      setValidationResult({ success: false, message: 'Please select a space first' })
      return
    }

    setValidationResult(null)
    const result = await window.sbmigGui.sbmig.validate(workingDir, {
      oauthToken,
      spaceId: activeSpace?.spaceId,
      accessToken: activeSpace?.accessToken,
    })

    if (result.success) {
      setValidationResult({ success: true, message: 'Configuration is valid!' })
    } else {
      setValidationResult({ success: false, message: result.error || 'Validation failed' })
    }
  }

  /**
   * Execute an sb-mig command
   */
  const executeCommand = useCallback(
    async (command: string, args: string[]) => {
      if (!workingDir) {
        setOutput((prev) => [
          ...prev,
          {
            id: lineIdRef.current++,
            type: 'error',
            data: 'Please select a space first (Settings → Add Space)',
            timestamp: Date.now(),
          },
        ])
        return
      }

      if (isRunning) {
        setOutput((prev) => [
          ...prev,
          {
            id: lineIdRef.current++,
            type: 'error',
            data: 'A command is already running. Please wait or stop it first.',
            timestamp: Date.now(),
          },
        ])
        return
      }

      setIsRunning(true)
      await window.sbmigGui.sbmig.execute(command, args, workingDir, {
        oauthToken,
        spaceId: activeSpace?.spaceId,
        accessToken: activeSpace?.accessToken,
      })
    },
    [workingDir, oauthToken, activeSpace, isRunning]
  )

  /**
   * Kill running process
   */
  const handleKillProcess = async () => {
    await window.sbmigGui.sbmig.killProcess()
    setIsRunning(false)
  }

  /**
   * Clear terminal output
   */
  const clearOutput = () => {
    setOutput([])
    lineIdRef.current = 0
  }

  /**
   * Open resource picker
   */
  const openResourcePicker = async (type: ResourceType, action: 'sync' | 'backup') => {
    if (!workingDir) {
      setOutput((prev) => [
        ...prev,
        {
          id: lineIdRef.current++,
          type: 'error',
          data: 'Please select a space first',
          timestamp: Date.now(),
        },
      ])
      return
    }

    setIsDiscovering(true)
    setShowResourcePicker({ type, action })
    setSelectedResources(new Set())
    setDiscoveredResources([])

    try {
      let resources: SbmigDiscoveredComponent[] = []
      switch (type) {
        case 'components':
          resources = await window.sbmigGui.sbmig.discoverComponents(workingDir)
          break
        case 'datasources':
          resources = await window.sbmigGui.sbmig.discoverDatasources(workingDir)
          break
        case 'roles':
          resources = await window.sbmigGui.sbmig.discoverRoles(workingDir)
          break
      }
      setDiscoveredResources(resources)
    } catch {
      // Discovery failed
    } finally {
      setIsDiscovering(false)
    }
  }

  /**
   * Load stories from source space
   */
  const loadSourceStories = async (spaceId: string) => {
    const space = spaces.find((s) => s.id === spaceId)
    if (!space || !oauthToken) return

    setIsLoadingStories(true)
    setStoryTree([])
    setSelectedStoryIds(new Set())
    setExpandedFolders(new Set())

    try {
      const result = await window.sbmigGui.storyblok.fetchStories(space.spaceId, oauthToken)
      setStoryTree(result.tree)
    } catch {
      // Failed to load stories
    } finally {
      setIsLoadingStories(false)
    }
  }

  /**
   * Load target space story tree for destination picker
   */
  const loadTargetStories = async (spaceId: string) => {
    const space = spaces.find((s) => s.id === spaceId)
    if (!space || !oauthToken) return

    setIsLoadingTargetTree(true)
    setTargetStoryTree([])

    try {
      const result = await window.sbmigGui.storyblok.fetchStories(space.spaceId, oauthToken)
      // Filter to only show folders
      const foldersOnly = filterFoldersOnly(result.tree)
      setTargetStoryTree(foldersOnly)
    } catch {
      // Failed to load target stories
    } finally {
      setIsLoadingTargetTree(false)
    }
  }

  /**
   * Filter tree to only include folders
   */
  const filterFoldersOnly = (nodes: StoryblokTreeNode[]): StoryblokTreeNode[] => {
    return nodes
      .filter((node) => node.is_folder)
      .map((node) => ({
        ...node,
        children: filterFoldersOnly(node.children),
      }))
  }

  /**
   * Toggle folder expansion
   */
  const toggleFolderExpansion = (nodeId: number) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  /**
   * Get all story IDs from a node
   */
  const getAllStoryIds = (node: StoryblokTreeNode): number[] => {
    const ids: number[] = [node.id]
    for (const child of node.children) {
      ids.push(...getAllStoryIds(child))
    }
    return ids
  }

  /**
   * Toggle story selection
   */
  const toggleStorySelection = (node: StoryblokTreeNode) => {
    const allIds = getAllStoryIds(node)
    setSelectedStoryIds((prev) => {
      const next = new Set(prev)
      const allSelected = allIds.every((id) => prev.has(id))

      if (allSelected) {
        allIds.forEach((id) => next.delete(id))
      } else {
        allIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  /**
   * Check if node is fully selected
   */
  const isNodeFullySelected = (node: StoryblokTreeNode): boolean => {
    const allIds = getAllStoryIds(node)
    return allIds.every((id) => selectedStoryIds.has(id))
  }

  /**
   * Check if node is partially selected
   */
  const isNodePartiallySelected = (node: StoryblokTreeNode): boolean => {
    const allIds = getAllStoryIds(node)
    const selectedCount = allIds.filter((id) => selectedStoryIds.has(id)).length
    return selectedCount > 0 && selectedCount < allIds.length
  }

  /**
   * Execute story copy
   */
  const executeStoryCopy = async () => {
    if (selectedStoryIds.size === 0 || !sourceSpaceId || !targetSpaceId || !oauthToken) return

    const sourceSpace = spaces.find((s) => s.id === sourceSpaceId)
    const targetSpace = spaces.find((s) => s.id === targetSpaceId)
    if (!sourceSpace || !targetSpace) return

    setIsCopying(true)
    setCopyProgress({
      current: 0,
      total: selectedStoryIds.size,
      currentStory: '',
      status: 'pending',
    })

    const unsubscribe = window.sbmigGui.storyblok.onCopyProgress((progress) => {
      setCopyProgress(progress)
    })

    try {
      let destinationParentId: number | null = null
      if (destinationPath.trim()) {
        const destStory = await window.sbmigGui.storyblok.getStoryBySlug(
          targetSpace.spaceId,
          destinationPath.trim(),
          oauthToken
        )
        if (destStory) {
          destinationParentId = destStory.id
        }
      }

      const result = await window.sbmigGui.storyblok.copyStories(
        sourceSpace.spaceId,
        targetSpace.spaceId,
        Array.from(selectedStoryIds),
        destinationParentId,
        oauthToken
      )

      setOutput((prev) => [
        ...prev,
        {
          id: lineIdRef.current++,
          type: result.success ? 'info' : 'error',
          data: `Copy complete: ${result.copiedCount} stories copied${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`,
          timestamp: Date.now(),
        },
      ])

      if (result.success) {
        setShowStoryCopyModal(false)
        resetStoryCopyState()
      }
    } catch {
      // Copy failed
    } finally {
      unsubscribe()
      setIsCopying(false)
      setCopyProgress(null)
    }
  }

  /**
   * Reset story copy state
   */
  const resetStoryCopyState = () => {
    setSourceSpaceId(null)
    setTargetSpaceId(null)
    setStoryTree([])
    setSelectedStoryIds(new Set())
    setExpandedFolders(new Set())
    setDestinationPath('')
    setDestinationMode('browse')
    setTargetStoryTree([])
    setCopyProgress(null)
  }

  /**
   * Toggle resource selection
   */
  const toggleResourceSelection = (name: string) => {
    setSelectedResources((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  /**
   * Select/deselect all resources
   */
  const toggleAllResources = () => {
    if (selectedResources.size === discoveredResources.length) {
      setSelectedResources(new Set())
    } else {
      setSelectedResources(new Set(discoveredResources.map((r) => r.name)))
    }
  }

  /**
   * Execute with selected resources
   */
  const executeWithSelectedResources = async () => {
    if (!showResourcePicker || selectedResources.size === 0) return

    const { type, action } = showResourcePicker
    const resourceNames = Array.from(selectedResources)

    setShowResourcePicker(null)
    await executeCommand(action, [type, ...resourceNames])
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Spinner size="xl" />
      </div>
    )
  }

  // Settings view
  if (currentView === 'settings') {
    return (
      <div className="h-screen flex flex-col bg-background">
        {/* Title Bar */}
        <div className="h-10 bg-app-950 flex items-center justify-center border-b border-border draggable">
          <span className="text-sm font-medium text-muted-foreground">sb-mig GUI</span>
        </div>
        <SettingsScreen
          oauthToken={oauthToken}
          onOauthTokenChange={setOauthToken}
          spaces={spaces}
          onSpacesChange={setSpaces}
          activeSpaceId={activeSpaceId}
          onActiveSpaceChange={setActiveSpaceId}
          onBack={() => setCurrentView('main')}
        />
      </div>
    )
  }

  // Main view
  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Title Bar (macOS style) */}
      <div className="h-10 bg-app-950 flex items-center justify-center border-b border-border draggable">
        <span className="text-sm font-medium text-muted-foreground">sb-mig GUI</span>
      </div>

      {/* Header */}
      <header className="flex-shrink-0 px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                <span className="text-2xl">📦</span> Storyblok Manager
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                sb-mig v{sbmigVersion || 'unknown'} • Manage your Storyblok spaces
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Space Selector */}
            {spaces.length > 0 && (
              <select
                value={activeSpaceId || ''}
                onChange={async (e) => {
                  const newId = e.target.value || null
                  setActiveSpaceId(newId)
                  if (newId) {
                    await window.sbmigGui.db.setSetting('sbmig_active_space', newId)
                  }
                }}
                className="px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select space...</option>
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            )}

            {/* Status indicators */}
            {validationResult && (
              <span
                className={`px-3 py-1 rounded-lg text-sm ${
                  validationResult.success
                    ? 'bg-storyblok-green/20 text-storyblok-green'
                    : 'bg-destructive/20 text-destructive'
                }`}
              >
                {validationResult.message}
              </span>
            )}
            {isRunning && (
              <span className="px-3 py-1 rounded-lg text-sm bg-yellow-500/20 text-yellow-400 flex items-center gap-2">
                <Spinner size="sm" />
                Running...
              </span>
            )}

            {/* Settings Button */}
            <Button variant="ghost" size="sm" onClick={() => setCurrentView('settings')}>
              ⚙️ Settings
            </Button>
          </div>
        </div>
      </header>

      {/* No space configured prompt */}
      {spaces.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="text-6xl mb-4 block">🚀</span>
            <h2 className="text-xl font-semibold mb-2">Welcome to sb-mig GUI</h2>
            <p className="text-muted-foreground mb-4">
              Get started by configuring your first Storyblok space
            </p>
            <Button onClick={() => setCurrentView('settings')}>
              ⚙️ Open Settings
            </Button>
          </div>
        </div>
      )}

      {/* Main Content (only show if spaces configured) */}
      {spaces.length > 0 && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Operations Bar */}
          <div className="flex-shrink-0 p-4 border-b border-border">
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1 pr-3 border-r border-border">
                <span className="text-xs text-muted-foreground uppercase mr-2">Sync</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openResourcePicker('components', 'sync')}
                  disabled={isRunning || !activeSpaceId}
                >
                  Components
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openResourcePicker('datasources', 'sync')}
                  disabled={isRunning || !activeSpaceId}
                >
                  Datasources
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openResourcePicker('roles', 'sync')}
                  disabled={isRunning || !activeSpaceId}
                >
                  Roles
                </Button>
              </div>

              <div className="flex items-center gap-1 pr-3 border-r border-border">
                <span className="text-xs text-muted-foreground uppercase mr-2">Backup</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openResourcePicker('components', 'backup')}
                  disabled={isRunning || !activeSpaceId}
                >
                  Components
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => executeCommand('backup', ['stories', '--all'])}
                  disabled={isRunning || !activeSpaceId}
                >
                  Stories
                </Button>
              </div>

              <div className="flex items-center gap-1 pr-3 border-r border-border">
                <span className="text-xs text-muted-foreground uppercase mr-2">Copy</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowStoryCopyModal(true)}
                  disabled={isRunning || spaces.length < 1}
                >
                  Stories
                </Button>
              </div>

              <div className="flex items-center gap-1 pr-3 border-r border-border">
                <span className="text-xs text-muted-foreground uppercase mr-2">Other</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => executeCommand('discover', ['components', '--all'])}
                  disabled={isRunning || !activeSpaceId}
                >
                  Discover
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => executeCommand('debug', [])}
                  disabled={isRunning || !activeSpaceId}
                >
                  Debug
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleValidate}
                  disabled={isRunning || !activeSpaceId}
                >
                  Validate
                </Button>
              </div>

              {isRunning && (
                <Button size="sm" variant="destructive" onClick={handleKillProcess}>
                  ⏹️ Stop
                </Button>
              )}
            </div>
          </div>

          {/* Terminal Output */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Terminal Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-app-950 border-b border-border">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Output</span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="rounded"
                  />
                  Auto-scroll
                </label>
                <Button variant="ghost" size="sm" onClick={clearOutput}>
                  Clear
                </Button>
              </div>
            </div>

            {/* Terminal Content */}
            <div
              ref={outputRef}
              className="flex-1 overflow-y-auto p-4 bg-app-950 terminal-output"
            >
              {output.length === 0 ? (
                <div className="text-muted-foreground italic">
                  No output yet. Select a space and run a command to see results here.
                </div>
              ) : (
                output.map((line) => (
                  <div key={line.id} className={`whitespace-pre-wrap ${getLineColor(line.type)}`}>
                    {line.data}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Story Copy Modal */}
      {showStoryCopyModal && (
        <Modal
          isOpen={true}
          onClose={() => {
            setShowStoryCopyModal(false)
            resetStoryCopyState()
          }}
          title="Copy Stories Between Spaces"
          maxWidth="5xl"
        >
          <div className="space-y-4">
            {/* Source & Target Selection */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Source Space
                </label>
                <select
                  value={sourceSpaceId || ''}
                  onChange={(e) => {
                    setSourceSpaceId(e.target.value || null)
                    if (e.target.value) {
                      loadSourceStories(e.target.value)
                    } else {
                      setStoryTree([])
                      setSelectedStoryIds(new Set())
                    }
                  }}
                  className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select source space...</option>
                  {spaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name} ({space.spaceId})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Target Space
                </label>
                <select
                  value={targetSpaceId || ''}
                  onChange={(e) => {
                    setTargetSpaceId(e.target.value || null)
                    if (e.target.value && destinationMode === 'browse') {
                      loadTargetStories(e.target.value)
                    }
                  }}
                  className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select target space...</option>
                  {spaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name} ({space.spaceId})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Story Tree */}
            <div className="grid grid-cols-2 gap-4">
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-card border-b border-border">
                  <span className="text-sm font-medium">
                    Stories to Copy
                    {selectedStoryIds.size > 0 && (
                      <span className="ml-2 text-primary">({selectedStoryIds.size} selected)</span>
                    )}
                  </span>
                </div>
                <div className="h-[400px] overflow-y-auto">
                  {isLoadingStories ? (
                    <div className="flex items-center justify-center h-full">
                      <Spinner size="lg" />
                      <span className="ml-3 text-muted-foreground">Loading stories...</span>
                    </div>
                  ) : !sourceSpaceId ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      Select a source space to load stories
                    </div>
                  ) : storyTree.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      No stories found
                    </div>
                  ) : (
                    <VirtualStoryTree
                      nodes={storyTree}
                      expandedIds={expandedFolders}
                      onToggleSelect={toggleStorySelection}
                      onToggleExpand={toggleFolderExpansion}
                      isNodeFullySelected={isNodeFullySelected}
                      isNodePartiallySelected={isNodePartiallySelected}
                    />
                  )}
                </div>
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-card border-b border-border flex items-center justify-between">
                  <span className="text-sm font-medium">Destination Folder</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setDestinationMode('text')}
                      className={`px-2 py-1 text-xs rounded ${
                        destinationMode === 'text'
                          ? 'bg-primary/20 text-primary'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      Path
                    </button>
                    <button
                      onClick={() => {
                        setDestinationMode('browse')
                        if (targetSpaceId && targetStoryTree.length === 0) {
                          loadTargetStories(targetSpaceId)
                        }
                      }}
                      className={`px-2 py-1 text-xs rounded ${
                        destinationMode === 'browse'
                          ? 'bg-primary/20 text-primary'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      Browse
                    </button>
                  </div>
                </div>
                <div className="h-[368px] overflow-y-auto">
                  {destinationMode === 'text' ? (
                    <div className="p-4 space-y-3">
                      <Input
                        value={destinationPath}
                        onChange={(e) => setDestinationPath(e.target.value)}
                        placeholder="e.g., en/blog or leave empty for root"
                      />
                      <p className="text-xs text-muted-foreground">
                        Enter the full slug of the destination folder, or leave empty to copy to root level.
                      </p>
                      {destinationPath && (
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="text-sm">
                            Stories will be copied to:{' '}
                            <span className="text-primary font-mono">/{destinationPath}/</span>
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {!targetSpaceId ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                          Select a target space first
                        </div>
                      ) : isLoadingTargetTree ? (
                        <div className="flex items-center justify-center h-full">
                          <Spinner size="lg" />
                        </div>
                      ) : (
                        <DestinationFolderPicker
                          nodes={targetStoryTree}
                          selectedPath={destinationPath}
                          onSelect={setDestinationPath}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Progress */}
            {copyProgress && (
              <div className="p-3 bg-card rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm">
                    {copyProgress.status === 'copying'
                      ? `Copying: ${copyProgress.currentStory}`
                      : copyProgress.status === 'done'
                        ? 'Complete!'
                        : 'Preparing...'}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {copyProgress.current} / {copyProgress.total}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${(copyProgress.current / copyProgress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t border-border mt-4">
            <div className="flex-1 text-sm text-muted-foreground">
              {selectedStoryIds.size > 0 && (
                <span>
                  {selectedStoryIds.size} {selectedStoryIds.size === 1 ? 'story' : 'stories'}{' '}
                  selected
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                setShowStoryCopyModal(false)
                resetStoryCopyState()
              }}
              disabled={isCopying}
            >
              Cancel
            </Button>
            <Button
              onClick={executeStoryCopy}
              disabled={
                selectedStoryIds.size === 0 || !sourceSpaceId || !targetSpaceId || isCopying
              }
            >
              {isCopying ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Copying...
                </>
              ) : (
                `Copy ${selectedStoryIds.size > 0 ? `(${selectedStoryIds.size})` : ''}`
              )}
            </Button>
          </div>
        </Modal>
      )}

      {/* Resource Picker Modal */}
      {showResourcePicker && (
        <Modal
          isOpen={true}
          onClose={() => setShowResourcePicker(null)}
          title={`Select ${showResourcePicker.type} to ${showResourcePicker.action}`}
          maxWidth="2xl"
        >
          <div className="space-y-4">
            {isDiscovering ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size="lg" />
                <span className="ml-3 text-muted-foreground">
                  Discovering {showResourcePicker.type}...
                </span>
              </div>
            ) : discoveredResources.length === 0 ? (
              <div className="text-center py-8">
                <span className="text-4xl mb-4 block">📭</span>
                <p className="text-muted-foreground">
                  No {showResourcePicker.type} found in the working directory.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-border">
                  <button
                    onClick={toggleAllResources}
                    className="flex items-center gap-2 text-sm hover:text-foreground transition-colors"
                  >
                    <div
                      className={`w-4 h-4 rounded border transition-colors ${
                        selectedResources.size === discoveredResources.length
                          ? 'bg-primary border-primary'
                          : 'border-muted-foreground'
                      }`}
                    />
                    Select All
                  </button>
                  <span className="text-muted-foreground text-sm">
                    {selectedResources.size} of {discoveredResources.length} selected
                  </span>
                </div>

                <VirtualResourceList
                  resources={discoveredResources}
                  selectedResources={selectedResources}
                  onToggleSelection={toggleResourceSelection}
                  workingDir={workingDir}
                />
              </>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t border-border mt-4">
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => setShowResourcePicker(null)}>
              Cancel
            </Button>
            <Button
              onClick={executeWithSelectedResources}
              disabled={selectedResources.size === 0 || isDiscovering}
            >
              {showResourcePicker.action === 'sync' ? '🔄' : '💾'}{' '}
              {showResourcePicker.action.charAt(0).toUpperCase() +
                showResourcePicker.action.slice(1)}{' '}
              {selectedResources.size > 0 ? `(${selectedResources.size})` : ''}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * Get color class for output line type
 */
function getLineColor(type: OutputLine['type']): string {
  switch (type) {
    case 'stdout':
      return 'text-foreground'
    case 'stderr':
      return 'text-yellow-400'
    case 'info':
      return 'text-blue-400'
    case 'error':
      return 'text-red-400'
    case 'complete':
      return 'text-storyblok-green'
    default:
      return 'text-muted-foreground'
  }
}

/**
 * Virtualized resource list
 */
function VirtualResourceList({
  resources,
  selectedResources,
  onToggleSelection,
  workingDir,
}: {
  resources: SbmigDiscoveredComponent[]
  selectedResources: Set<string>
  onToggleSelection: (name: string) => void
  workingDir: string
}) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: resources.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 5,
  })

  return (
    <div ref={parentRef} className="max-h-[400px] overflow-y-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const resource = resources[virtualRow.index]
          return (
            <div
              key={resource.filePath}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="p-1"
            >
              <div
                onClick={() => onToggleSelection(resource.name)}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all h-full ${
                  selectedResources.has(resource.name)
                    ? 'bg-primary/10 border border-primary/30'
                    : 'bg-card border border-transparent hover:border-muted-foreground'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                    selectedResources.has(resource.name)
                      ? 'bg-primary border-primary'
                      : 'border-muted-foreground'
                  }`}
                >
                  {selectedResources.has(resource.name) && (
                    <svg className="w-3 h-3 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{resource.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {resource.filePath.replace(workingDir, '.')}
                  </div>
                </div>
                <span
                  className={`flex-shrink-0 px-2 py-0.5 rounded text-xs ${
                    resource.type === 'local'
                      ? 'bg-storyblok-green/20 text-storyblok-green'
                      : 'bg-yellow-500/20 text-yellow-400'
                  }`}
                >
                  {resource.type}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Virtualized story tree
 */
function VirtualStoryTree({
  nodes,
  expandedIds,
  onToggleSelect,
  onToggleExpand,
  isNodeFullySelected,
  isNodePartiallySelected,
}: {
  nodes: StoryblokTreeNode[]
  expandedIds: Set<number>
  onToggleSelect: (node: StoryblokTreeNode) => void
  onToggleExpand: (nodeId: number) => void
  isNodeFullySelected: (node: StoryblokTreeNode) => boolean
  isNodePartiallySelected: (node: StoryblokTreeNode) => boolean
}) {
  const flattenNodes = useCallback(
    (
      nodes: StoryblokTreeNode[],
      depth: number = 0
    ): Array<{ node: StoryblokTreeNode; depth: number }> => {
      const result: Array<{ node: StoryblokTreeNode; depth: number }> = []
      for (const node of nodes) {
        result.push({ node, depth })
        if (node.is_folder && expandedIds.has(node.id) && node.children.length > 0) {
          result.push(...flattenNodes(node.children, depth + 1))
        }
      }
      return result
    },
    [expandedIds]
  )

  const flatNodes = flattenNodes(nodes)
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  })

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const { node, depth } = flatNodes[virtualRow.index]
          const isSelected = isNodeFullySelected(node)
          const isPartial = isNodePartiallySelected(node)
          const isExpanded = expandedIds.has(node.id)

          return (
            <div
              key={node.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="px-2"
            >
              <div
                className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-muted ${
                  isSelected ? 'bg-primary/10' : ''
                }`}
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
              >
                {node.is_folder ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleExpand(node.id)
                    }}
                    className="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M6 6L14 10L6 14V6Z" />
                    </svg>
                  </button>
                ) : (
                  <div className="w-4" />
                )}

                <button
                  onClick={() => onToggleSelect(node)}
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                    isSelected
                      ? 'bg-primary border-primary'
                      : isPartial
                        ? 'bg-primary/50 border-primary'
                        : 'border-muted-foreground'
                  }`}
                >
                  {(isSelected || isPartial) && (
                    <svg className="w-2.5 h-2.5 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                    </svg>
                  )}
                </button>

                <span className="text-sm">
                  {node.is_folder ? '📁' : node.is_startpage ? '🏠' : '📄'}
                </span>

                <span
                  className={`text-sm truncate ${isSelected ? 'text-primary' : ''}`}
                  title={node.full_slug}
                >
                  {node.name}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Destination folder picker for selecting target folder
 */
function DestinationFolderPicker({
  nodes,
  selectedPath,
  onSelect,
  level = 0,
}: {
  nodes: StoryblokTreeNode[]
  selectedPath: string
  onSelect: (path: string) => void
  level?: number
}) {
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set())

  const toggleExpand = (nodeId: number) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  if (nodes.length === 0 && level === 0) {
    return (
      <div className="p-3 space-y-2">
        <button
          onClick={() => onSelect('')}
          className={`w-full text-left px-3 py-2 rounded text-sm ${
            selectedPath === ''
              ? 'bg-primary/20 text-primary'
              : 'text-foreground hover:bg-muted'
          }`}
        >
          📁 Root (no parent folder)
        </button>
        <p className="text-xs text-muted-foreground">No folders found in target space</p>
      </div>
    )
  }

  return (
    <div className={level === 0 ? 'p-3 space-y-1' : 'space-y-1'}>
      {level === 0 && (
        <button
          onClick={() => onSelect('')}
          className={`w-full text-left px-3 py-2 rounded text-sm ${
            selectedPath === ''
              ? 'bg-primary/20 text-primary'
              : 'text-foreground hover:bg-muted'
          }`}
        >
          📁 Root (no parent folder)
        </button>
      )}
      {nodes.map((node) => (
        <div key={node.id}>
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer ${
              selectedPath === node.full_slug
                ? 'bg-primary/20 text-primary'
                : 'text-foreground hover:bg-muted'
            }`}
            style={{ paddingLeft: `${level * 16 + 12}px` }}
          >
            {node.children.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleExpand(node.id)
                }}
                className="w-4 h-4 flex items-center justify-center text-muted-foreground"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${expandedFolders.has(node.id) ? 'rotate-90' : ''}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M6 6L14 10L6 14V6Z" />
                </svg>
              </button>
            )}
            {node.children.length === 0 && <div className="w-4" />}
            <button
              onClick={() => onSelect(node.full_slug)}
              className="flex-1 text-left text-sm truncate"
            >
              📁 {node.name}
            </button>
          </div>
          {expandedFolders.has(node.id) && node.children.length > 0 && (
            <DestinationFolderPicker
              nodes={node.children}
              selectedPath={selectedPath}
              onSelect={onSelect}
              level={level + 1}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export default App
