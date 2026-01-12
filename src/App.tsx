import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  FeatureCard,
  InfoBox,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  PanelHeader,
  ProgressBar,
  Spinner,
  TitleBar,
  ToggleGroup,
  TreeChevron,
} from "./components/ui";
import { ButtonGroup, OutputLine, SpaceCard } from "./components/composed";
import {
  SettingsScreen,
  StoryblokSpace,
} from "./screens/Settings/SettingsScreen";
import { useOutput } from "./hooks/useOutput";
import {
  toggleSetItem,
  addToSet,
  removeFromSet,
} from "./lib/set-utils";

/**
 * Resource type for picker
 */
type ResourceType = "components" | "datasources" | "roles";

/**
 * Static options for execution mode toggle (moved outside component to prevent recreation)
 */
const EXECUTION_MODE_OPTIONS: { value: ExecutionMode; label: string; icon: string }[] = [
  { value: "api", label: "API", icon: "⚡" },
  { value: "cli", label: "CLI", icon: "💻" },
];

/**
 * Current view
 */
type AppView = "main" | "settings";

/**
 * Execution mode - API uses sb-mig api-v2, CLI spawns sb-mig commands
 */
type ExecutionMode = "api" | "cli";

/**
 * sb-mig GUI - Main Application
 */
function App() {
  // View state
  const [currentView, setCurrentView] = useState<AppView>("main");

  // Execution mode (api = direct api-v2, cli = spawn sb-mig commands)
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("api");

  // Debug mode - shows detailed logs and information
  const [debugMode, setDebugMode] = useState(false);

  // Configuration state
  const [oauthToken, setOauthToken] = useState("");
  const [spaces, setSpaces] = useState<StoryblokSpace[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [sbmigBundledVersion, setSbmigBundledVersion] = useState<string | null>(null);
  const [sbmigInstalledVersion, setSbmigInstalledVersion] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Resource picker state
  const [showResourcePicker, setShowResourcePicker] = useState<{
    type: ResourceType;
    action: "sync" | "backup";
  } | null>(null);
  const [discoveredResources, setDiscoveredResources] = useState<
    SbmigDiscoveredComponent[]
  >([]);
  const [selectedResources, setSelectedResources] = useState<Set<string>>(
    new Set()
  );
  const [isDiscovering, setIsDiscovering] = useState(false);

  // Story copy state
  const [showStoryCopyModal, setShowStoryCopyModal] = useState(false);
  const [sourceSpaceId, setSourceSpaceId] = useState<string | null>(null);
  const [targetSpaceId, setTargetSpaceId] = useState<string | null>(null);
  const [storyTree, setStoryTree] = useState<StoryblokTreeNode[]>([]);
  const [selectedStoryIds, setSelectedStoryIds] = useState<Set<number>>(
    new Set()
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(
    new Set()
  );
  const [destinationPath, setDestinationPath] = useState("");
  const [destinationMode, setDestinationMode] = useState<"browse" | "text">(
    "browse"
  );
  const [targetStoryTree, setTargetStoryTree] = useState<StoryblokTreeNode[]>(
    []
  );
  const [isLoadingStories, setIsLoadingStories] = useState(false);
  const [isLoadingTargetTree, setIsLoadingTargetTree] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyProgress, setCopyProgress] =
    useState<StoryblokCopyProgress | null>(null);

  // Sync progress state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressEvent | null>(
    null
  );

  // Terminal output - using useOutput hook
  const { output, addLine, clear: clearOutput } = useOutput();
  const [autoScroll, setAutoScroll] = useState(true);
  const outputRef = useRef<HTMLDivElement>(null);
  const didLoadConfigRef = useRef(false);

  // Active space object and derived working directory (memoized)
  const activeSpace = useMemo(
    () => spaces.find((s) => s.id === activeSpaceId) || null,
    [spaces, activeSpaceId]
  );
  const workingDir = activeSpace?.workingDir || "";

  /**
   * Load saved configuration on mount
   */
  useEffect(() => {
    // React 18 StrictMode mounts twice in dev; protect expensive one-time init.
    if (didLoadConfigRef.current) return;
    didLoadConfigRef.current = true;

    let cancelled = false;

    const loadConfig = async () => {
      try {
        // Load saved settings (keep splash/spinner time minimal)
        const [
          savedOauthToken,
          savedSpacesJson,
          savedActiveSpace,
          savedExecutionMode,
          savedDebugMode,
        ] = await Promise.all([
          window.sbmigGui.db.getSetting("sbmig_oauth_token"),
          window.sbmigGui.db.getSetting("sbmig_spaces"),
          window.sbmigGui.db.getSetting("sbmig_active_space"),
          window.sbmigGui.db.getSetting("sbmig_execution_mode"),
          window.sbmigGui.db.getSetting("sbmig_debug_mode"),
        ]);

        if (cancelled) return;

        if (savedOauthToken) setOauthToken(savedOauthToken);
        if (savedSpacesJson) {
          try {
            setSpaces(JSON.parse(savedSpacesJson));
          } catch {
            // Failed to parse
          }
        }
        if (savedActiveSpace) setActiveSpaceId(savedActiveSpace);

        // Load execution mode preference
        if (savedExecutionMode === "api" || savedExecutionMode === "cli") {
          setExecutionMode(savedExecutionMode);
        }

        // Load debug mode preference
        if (savedDebugMode === "true") {
          setDebugMode(true);
        }
      } catch (error) {
        // Failed to load config
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Load sb-mig version lazily based on the active execution mode
   * (these checks can be slow: PATH discovery + spawning shell commands)
   */
  useEffect(() => {
    let cancelled = false;

    const loadVersion = async () => {
      if (executionMode === "api") {
        if (sbmigBundledVersion !== null) return;
        try {
          const bundledVersion =
            await window.sbmigGui.sbmig.getBundledVersion();
          if (!cancelled) setSbmigBundledVersion(bundledVersion);
        } catch {
          // bundled version not available
        }
        return;
      }

      // CLI mode
      if (sbmigInstalledVersion !== null) return;
      try {
        const installedVersion = await window.sbmigGui.sbmig.getVersion();
        if (!cancelled) setSbmigInstalledVersion(installedVersion);
      } catch {
        // installed version not available
      }
    };

    loadVersion();

    return () => {
      cancelled = true;
    };
  }, [executionMode, sbmigBundledVersion, sbmigInstalledVersion]);

  /**
   * Subscribe to output events
   */
  useEffect(() => {
    const unsubscribe = window.sbmigGui.sbmig.onOutput((event) => {
      addLine(event.type, event.data);

      if (event.type === "complete") {
        setIsRunning(false);
      }
    });

    return unsubscribe;
  }, [addLine]);

  /**
   * Auto-scroll to bottom when new output arrives
   * Uses requestAnimationFrame to avoid layout thrashing
   */
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      requestAnimationFrame(() => {
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
      });
    }
  }, [output.length, autoScroll]);

  /**
   * Run sb-mig debug command to validate configuration
   */
  const handleValidate = useCallback(async () => {
    if (!workingDir) {
      setValidationResult({
        success: false,
        message: "Please select a space first",
      });
      return;
    }

    setValidationResult(null);
    const result = await window.sbmigGui.sbmig.validate(workingDir, {
      oauthToken,
      spaceId: activeSpace?.spaceId,
      accessToken: activeSpace?.accessToken,
    });

    if (result.success) {
      setValidationResult({
        success: true,
        message: "Configuration is valid!",
      });
    } else {
      setValidationResult({
        success: false,
        message: result.error || "Validation failed",
      });
    }
  }, [workingDir, oauthToken, activeSpace]);

  /**
   * Handle space selection from sidebar
   */
  const handleSpaceSelect = useCallback(async (spaceId: string) => {
    setActiveSpaceId(spaceId);
    await window.sbmigGui.db.setSetting("sbmig_active_space", spaceId);
  }, []);

  /**
   * Handle execution mode change (memoized to prevent re-renders)
   */
  const handleExecutionModeChange = useCallback(async (value: string) => {
    setExecutionMode(value as ExecutionMode);
    await window.sbmigGui.db.setSetting("sbmig_execution_mode", value);
  }, []);

  /**
   * Execute an sb-mig command
   */
  const executeCommand = useCallback(
    async (command: string, args: string[]) => {
      if (!workingDir) {
        addLine("error", "Please select a space first (Settings → Add Space)");
        return;
      }

      if (isRunning) {
        addLine(
          "error",
          "A command is already running. Please wait or stop it first."
        );
        return;
      }

      setIsRunning(true);
      await window.sbmigGui.sbmig.execute(command, args, workingDir, {
        oauthToken,
        spaceId: activeSpace?.spaceId,
        accessToken: activeSpace?.accessToken,
      });
    },
    [workingDir, oauthToken, activeSpace, isRunning, addLine]
  );

  /**
   * Kill running process
   */
  const handleKillProcess = async () => {
    await window.sbmigGui.sbmig.killProcess();
    setIsRunning(false);
  };

  /**
   * Open resource picker
   */
  const openResourcePicker = async (
    type: ResourceType,
    action: "sync" | "backup"
  ) => {
    if (!workingDir) {
      addLine("error", "Please select a space first");
      return;
    }

    setIsDiscovering(true);
    setShowResourcePicker({ type, action });
    setSelectedResources(new Set());
    setDiscoveredResources([]);

    if (debugMode) {
      addLine("info", `[DEBUG] Discovering ${type} in: ${workingDir}`);
    }

    try {
      const startTime = Date.now();
      let resources: SbmigDiscoveredComponent[] = [];
      switch (type) {
        case "components":
          resources =
            executionMode === "api"
              ? await window.sbmigGui.apiV2.discoverComponents(workingDir)
              : await window.sbmigGui.sbmig.discoverComponents(workingDir);
          break;
        case "datasources":
          resources =
            executionMode === "api"
              ? await window.sbmigGui.apiV2.discoverDatasources(workingDir)
              : await window.sbmigGui.sbmig.discoverDatasources(workingDir);
          break;
        case "roles":
          resources =
            executionMode === "api"
              ? await window.sbmigGui.apiV2.discoverRoles(workingDir)
              : await window.sbmigGui.sbmig.discoverRoles(workingDir);
          break;
      }
      
      if (debugMode) {
        const duration = Date.now() - startTime;
        addLine("info", `[DEBUG] Found ${resources.length} ${type} in ${duration}ms`);
        resources.forEach((r) => {
          addLine("info", `[DEBUG]   - ${r.name} (${r.type}): ${r.filePath}`);
        });
      }
      
      setDiscoveredResources(resources);
    } catch (error) {
      if (debugMode) {
        addLine("error", `[DEBUG] Discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      setIsDiscovering(false);
    }
  };

  /**
   * Filter tree to only include folders (pure function, no deps)
   */
  const filterFoldersOnly = useCallback(
    (nodes: StoryblokTreeNode[]): StoryblokTreeNode[] => {
      return nodes
        .filter((node) => node.is_folder)
        .map((node) => ({
          ...node,
          children: filterFoldersOnly(node.children),
        }));
    },
    []
  );

  /**
   * Load stories from source space
   */
  const loadSourceStories = useCallback(
    async (spaceId: string) => {
      const space = spaces.find((s) => s.id === spaceId);
      if (!space || !oauthToken) return;

      setIsLoadingStories(true);
      setStoryTree([]);
      setSelectedStoryIds(new Set());
      setExpandedFolders(new Set());

      try {
        const result = await window.sbmigGui.apiV2.fetchStories(
          space.spaceId,
          oauthToken
        );
        setStoryTree(result.tree);
      } catch {
        // Failed to load stories
      } finally {
        setIsLoadingStories(false);
      }
    },
    [spaces, oauthToken]
  );

  /**
   * Load target space story tree for destination picker
   */
  const loadTargetStories = useCallback(
    async (spaceId: string) => {
      const space = spaces.find((s) => s.id === spaceId);
      if (!space || !oauthToken) return;

      setIsLoadingTargetTree(true);
      setTargetStoryTree([]);

      try {
        const result = await window.sbmigGui.apiV2.fetchStories(
          space.spaceId,
          oauthToken
        );
        // Filter to only show folders
        const foldersOnly = filterFoldersOnly(result.tree);
        setTargetStoryTree(foldersOnly);
      } catch {
        // Failed to load target stories
      } finally {
        setIsLoadingTargetTree(false);
      }
    },
    [spaces, oauthToken, filterFoldersOnly]
  );

  /**
   * Toggle folder expansion
   */
  const toggleFolderExpansion = useCallback((nodeId: number) => {
    setExpandedFolders((prev) => toggleSetItem(prev, nodeId));
  }, []);

  /**
   * Pre-compute all descendant IDs for each node (only recomputes when storyTree changes)
   * This enables O(1) lookups instead of O(n) recursive traversal
   */
  const nodeIdMap = useMemo(() => {
    const map = new Map<number, number[]>();

    const computeIds = (node: StoryblokTreeNode): number[] => {
      const ids = [node.id];
      for (const child of node.children) {
        ids.push(...computeIds(child));
      }
      map.set(node.id, ids);
      return ids;
    };

    storyTree.forEach(computeIds);
    return map;
  }, [storyTree]);

  /**
   * Pre-compute selection status for each node (recomputes when nodeIdMap or selection changes)
   * Returns 'full' | 'partial' | 'none' for each node ID
   * Optimized: Uses Set.has() directly instead of .filter().length for O(n) vs O(n²)
   */
  const selectionStatus = useMemo(() => {
    const status = new Map<number, "full" | "partial" | "none">();

    nodeIdMap.forEach((allIds, nodeId) => {
      // Count selected using reduce with Set.has() - O(n) instead of filter O(n)
      let selectedCount = 0;
      for (const id of allIds) {
        if (selectedStoryIds.has(id)) {
          selectedCount++;
        }
      }

      if (selectedCount === 0) {
        status.set(nodeId, "none");
      } else if (selectedCount === allIds.length) {
        status.set(nodeId, "full");
      } else {
        status.set(nodeId, "partial");
      }
    });

    return status;
  }, [nodeIdMap, selectedStoryIds]);

  /**
   * Toggle story selection using pre-computed nodeIdMap (O(1) lookup)
   */
  const toggleStorySelection = useCallback(
    (node: StoryblokTreeNode) => {
      const allIds = nodeIdMap.get(node.id) || [node.id];
      setSelectedStoryIds((prev) => {
        const allSelected = allIds.every((id) => prev.has(id));
        return allSelected ? removeFromSet(prev, allIds) : addToSet(prev, allIds);
      });
    },
    [nodeIdMap]
  );

  /**
   * Check if node is fully selected (O(1) lookup via selectionStatus)
   */
  const isNodeFullySelected = useCallback(
    (node: StoryblokTreeNode): boolean => {
      return selectionStatus.get(node.id) === "full";
    },
    [selectionStatus]
  );

  /**
   * Check if node is partially selected (O(1) lookup via selectionStatus)
   */
  const isNodePartiallySelected = useCallback(
    (node: StoryblokTreeNode): boolean => {
      return selectionStatus.get(node.id) === "partial";
    },
    [selectionStatus]
  );

  /**
   * Execute story copy
   */
  const executeStoryCopy = async () => {
    if (
      selectedStoryIds.size === 0 ||
      !sourceSpaceId ||
      !targetSpaceId ||
      !oauthToken
    )
      return;

    const sourceSpace = spaces.find((s) => s.id === sourceSpaceId);
    const targetSpace = spaces.find((s) => s.id === targetSpaceId);
    if (!sourceSpace || !targetSpace) return;

    setIsCopying(true);
    setCopyProgress({
      current: 0,
      total: selectedStoryIds.size,
      currentStory: "",
      status: "pending",
    });

    const unsubscribe = window.sbmigGui.apiV2.onCopyProgress((progress) => {
      setCopyProgress(progress);
    });

    try {
      let destinationParentId: number | null = null;
      if (destinationPath.trim()) {
        const destStory = await window.sbmigGui.apiV2.getStoryBySlug(
          targetSpace.spaceId,
          destinationPath.trim(),
          oauthToken
        );
        if (destStory) {
          destinationParentId = destStory.id;
        }
      }

      const result = await window.sbmigGui.apiV2.copyStories(
        sourceSpace.spaceId,
        targetSpace.spaceId,
        Array.from(selectedStoryIds),
        destinationParentId,
        oauthToken
      );

      addLine(
        result.success ? "info" : "error",
        `Copy complete: ${result.copiedCount} stories copied${
          result.errors.length > 0 ? `, ${result.errors.length} errors` : ""
        }`
      );

      if (result.success) {
        setShowStoryCopyModal(false);
        resetStoryCopyState();
      }
    } catch {
      // Copy failed
    } finally {
      unsubscribe();
      setIsCopying(false);
      setCopyProgress(null);
    }
  };

  /**
   * Reset story copy state
   */
  const resetStoryCopyState = useCallback(() => {
    setSourceSpaceId(null);
    setTargetSpaceId(null);
    setStoryTree([]);
    setSelectedStoryIds(new Set());
    setExpandedFolders(new Set());
    setDestinationPath("");
    setDestinationMode("browse");
    setTargetStoryTree([]);
    setCopyProgress(null);
  }, []);

  /**
   * Toggle resource selection
   */
  const toggleResourceSelection = useCallback((name: string) => {
    setSelectedResources((prev) => toggleSetItem(prev, name));
  }, []);

  /**
   * Select/deselect all resources
   */
  const toggleAllResources = useCallback(() => {
    setSelectedResources((prev) => {
      if (prev.size === discoveredResources.length) {
        return new Set();
      } else {
        return new Set(discoveredResources.map((r) => r.name));
      }
    });
  }, [discoveredResources]);

  /**
   * Execute with selected resources
   */
  const executeWithSelectedResources = async () => {
    if (!showResourcePicker || selectedResources.size === 0) return;

    const { type, action } = showResourcePicker;

    // API mode: use api-v2 for component sync
    if (executionMode === "api" && action === "sync" && type === "components") {
      // Get file paths for selected components
      const filePaths = discoveredResources
        .filter((r) => selectedResources.has(r.name))
        .map((r) => r.filePath);

      if (!activeSpace?.spaceId || !oauthToken) {
        addLine("error", "Missing space ID or OAuth token. Check Settings.");
        setShowResourcePicker(null);
        return;
      }

      setShowResourcePicker(null);
      setIsSyncing(true);
      setSyncProgress({
        type: "start",
        current: 0,
        total: filePaths.length,
      });

      // Show starting message
      addLine("info", `[API v2] Syncing ${filePaths.length} components...`);
      
      if (debugMode) {
        addLine("info", `[DEBUG] Space ID: ${activeSpace.spaceId}`);
        addLine("info", `[DEBUG] Working directory: ${workingDir}`);
        addLine("info", `[DEBUG] Files to sync:`);
        filePaths.forEach((fp) => addLine("info", `[DEBUG]   - ${fp}`));
      }

      // Subscribe to progress events
      const unsubscribe = window.sbmigGui.apiV2.onSyncProgress((progress) => {
        setSyncProgress(progress);
        // Also add progress to output for individual items
        if (progress.type === "progress" && progress.name) {
          const actionEmoji =
            progress.action === "created"
              ? "✅"
              : progress.action === "updated"
              ? "📝"
              : progress.action === "error"
              ? "❌"
              : "";
          if (
            actionEmoji &&
            ["created", "updated", "error"].includes(progress.action || "")
          ) {
            addLine(
              progress.action === "error" ? "error" : "info",
              `${actionEmoji} ${
                progress.action === "created"
                  ? "Created"
                  : progress.action === "updated"
                  ? "Updated"
                  : "Error"
              }: ${progress.name}`
            );
          }
        }
      });

      try {
        const startTime = Date.now();
        const result = await window.sbmigGui.apiV2.loadAndSyncComponents(
          filePaths,
          activeSpace.spaceId, // Use actual Storyblok space ID, not internal GUI ID
          oauthToken,
          workingDir,
          { presets: false, ssot: false }
        );

        const duration = Date.now() - startTime;

        // Summary (individual items were logged via progress events)
        const hasErrors = result.errors.length > 0;
        addLine(
          hasErrors ? "error" : "complete",
          `[API v2] Sync complete: ${result.created.length} created, ${result.updated.length} updated, ${result.errors.length} errors`
        );
        
        if (debugMode) {
          addLine("info", `[DEBUG] Sync completed in ${duration}ms`);
          if (result.created.length > 0) {
            addLine("info", `[DEBUG] Created: ${result.created.join(", ")}`);
          }
          if (result.updated.length > 0) {
            addLine("info", `[DEBUG] Updated: ${result.updated.join(", ")}`);
          }
          if (result.errors.length > 0) {
            addLine("error", `[DEBUG] Errors:`);
            result.errors.forEach((e) => {
              addLine("error", `[DEBUG]   - ${e.name}: ${e.message}`);
            });
          }
        }
      } catch (error) {
        addLine(
          "error",
          `[API v2] Sync failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        if (debugMode) {
          addLine("error", `[DEBUG] Full error: ${error instanceof Error ? error.stack : String(error)}`);
        }
      } finally {
        unsubscribe(); // Always cleanup IPC listener
        setIsSyncing(false);
        setSyncProgress(null);
      }

      return;
    }

    // CLI mode: existing behavior
    const resourceNames = Array.from(selectedResources);
    setShowResourcePicker(null);
    await executeCommand(action, [type, ...resourceNames]);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Spinner size="xl" />
      </div>
    );
  }

  // Settings view
  if (currentView === "settings") {
    return (
      <div className="h-screen flex flex-col bg-background">
        <TitleBar />
        <SettingsScreen
          oauthToken={oauthToken}
          onOauthTokenChange={setOauthToken}
          spaces={spaces}
          onSpacesChange={setSpaces}
          activeSpaceId={activeSpaceId}
          onActiveSpaceChange={setActiveSpaceId}
          debugMode={debugMode}
          onDebugModeChange={setDebugMode}
          onBack={() => setCurrentView("main")}
        />
      </div>
    );
  }

  // Main view
  return (
    <div className="h-screen flex flex-col bg-background">
      <TitleBar />

      {/* Header */}
      <header className="flex-shrink-0 px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                <span className="text-2xl">📦</span> Storyblok Manager
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                sb-mig v{executionMode === "api" 
                  ? (sbmigBundledVersion || "unknown") + " (bundled)"
                  : (sbmigInstalledVersion || "not installed") + " (system)"
                } •{" "}
                {executionMode === "api" ? "Direct API mode" : "CLI mode"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Execution Mode Toggle */}
            <ToggleGroup
              options={EXECUTION_MODE_OPTIONS}
              value={executionMode}
              onChange={handleExecutionModeChange}
            />

            {/* Status indicators */}
            {validationResult && (
              <Badge variant={validationResult.success ? "success" : "error"}>
                {validationResult.message}
              </Badge>
            )}
            {isRunning && (
              <Badge variant="warning">
                <Spinner size="sm" />
                Running...
              </Badge>
            )}

            {/* Settings Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentView("settings")}
            >
              ⚙️ Settings
            </Button>
          </div>
        </div>
      </header>

      {/* No space configured prompt */}
      {spaces.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="🚀"
            title="Welcome to sb-mig GUI"
            message="Get started by configuring your first Storyblok space"
            size="lg"
            action={
              <Button onClick={() => setCurrentView("settings")}>
                ⚙️ Open Settings
              </Button>
            }
          />
        </div>
      )}

      {/* Main Content with Sidebar (only show if spaces configured) */}
      {spaces.length > 0 && (
        <div className="flex-1 overflow-hidden flex">
          {/* Left Sidebar: Spaces */}
          <div className="w-72 flex-shrink-0 border-r border-border overflow-y-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Spaces
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentView("settings")}
                className="text-xs"
              >
                + Add
              </Button>
            </div>

            <div className="space-y-2">
              {spaces.map((space) => (
                <SpaceCard
                  key={space.id}
                  space={space}
                  isActive={activeSpaceId === space.id}
                  onClick={() => handleSpaceSelect(space.id)}
                />
              ))}
            </div>

            {/* Validate Button */}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleValidate}
              disabled={!workingDir}
              className="w-full"
            >
              🔍 Validate Configuration
            </Button>
          </div>

          {/* Right Panel: Mode-specific UI */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {executionMode === "cli" ? (
              /* ========== CLI MODE UI ========== */
              <>
                {/* Operations Bar */}
                <div className="flex-shrink-0 p-4 border-b border-border">
                  <div className="flex flex-wrap gap-2">
                    <ButtonGroup label="Sync">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openResourcePicker("components", "sync")}
                        disabled={isRunning || !activeSpaceId}
                      >
                        Components
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          openResourcePicker("datasources", "sync")
                        }
                        disabled={isRunning || !activeSpaceId}
                      >
                        Datasources
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openResourcePicker("roles", "sync")}
                        disabled={isRunning || !activeSpaceId}
                      >
                        Roles
                      </Button>
                    </ButtonGroup>

                    <ButtonGroup label="Backup">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          openResourcePicker("components", "backup")
                        }
                        disabled={isRunning || !activeSpaceId}
                      >
                        Components
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          executeCommand("backup", ["stories", "--all"])
                        }
                        disabled={isRunning || !activeSpaceId}
                      >
                        Stories
                      </Button>
                    </ButtonGroup>

                    <ButtonGroup label="Copy">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setShowStoryCopyModal(true)}
                        disabled={isRunning || spaces.length < 1}
                      >
                        Stories
                      </Button>
                    </ButtonGroup>

                    <ButtonGroup label="Other" showDivider={false}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          executeCommand("discover", ["components", "--all"])
                        }
                        disabled={isRunning || !activeSpaceId}
                      >
                        Discover
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => executeCommand("debug", [])}
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
                    </ButtonGroup>

                    {isRunning && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={handleKillProcess}
                      >
                        ⏹️ Stop
                      </Button>
                    )}
                  </div>
                </div>

                {/* Terminal Output */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <PanelHeader
                    title="Terminal Output"
                    rightContent={
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
                    }
                  />

                  {/* Terminal Content - Virtualized */}
                  {output.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center bg-app-950">
                      <EmptyState
                        icon="📝"
                        message="No output yet. Select a space and run a command to see results here."
                        size="sm"
                      />
                    </div>
                  ) : (
                    <VirtualTerminalOutput
                      output={output}
                      outputRef={outputRef}
                      autoScroll={autoScroll}
                    />
                  )}
                </div>
              </>
            ) : (
              /* ========== API MODE UI ========== */
              <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-4xl mx-auto space-y-6">
                  {/* API Mode Header */}
                  <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold text-foreground mb-2">
                      ⚡ Direct API Mode
                    </h2>
                    <p className="text-muted-foreground">
                      Fast, structured operations using sb-mig API v2
                    </p>
                  </div>

                  {/* Available Operations */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FeatureCard
                      icon="📋"
                      iconBg="storyblok-green"
                      title="Copy Stories"
                      description="Copy stories between spaces with folder structure preserved"
                    >
                      <Button
                        onClick={() => setShowStoryCopyModal(true)}
                        disabled={spaces.length < 1}
                        className="w-full"
                      >
                        Open Story Copy
                      </Button>
                    </FeatureCard>

                    <FeatureCard
                      icon="🔄"
                      iconBg="storyblok-green"
                      title="Sync Resources"
                      description="Sync components, datasources, and roles to Storyblok"
                    >
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            openResourcePicker("components", "sync")
                          }
                          disabled={!activeSpaceId}
                        >
                          Components
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            openResourcePicker("datasources", "sync")
                          }
                          disabled={!activeSpaceId}
                        >
                          Datasources
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openResourcePicker("roles", "sync")}
                          disabled={!activeSpaceId}
                        >
                          Roles
                        </Button>
                      </div>
                    </FeatureCard>

                    <FeatureCard
                      icon="💾"
                      iconBg="muted"
                      title="Backup Resources"
                      description="Backup via API v2 coming soon"
                      disabled
                    >
                      <p className="text-xs text-muted-foreground">
                        Switch to CLI mode for backup functionality
                      </p>
                    </FeatureCard>
                  </div>

                  {/* Copy Progress */}
                  {copyProgress && (
                    <ProgressBar
                      current={copyProgress.current}
                      total={copyProgress.total}
                      title="Copy Progress"
                      status={
                        copyProgress.status === "done"
                          ? "✅ Complete"
                          : copyProgress.status === "error"
                          ? "❌ Error"
                          : `⏳ ${copyProgress.currentStory}`
                      }
                      showCard
                    />
                  )}

                  {/* Sync Progress Bar */}
                  {isSyncing && syncProgress && (
                    <ProgressBar
                      current={syncProgress.current ?? 0}
                      total={syncProgress.total ?? 0}
                      title="Sync Progress"
                      status={
                        syncProgress.type === "start"
                          ? "Starting sync..."
                          : syncProgress.type === "progress"
                          ? `${
                              syncProgress.action === "creating"
                                ? "Creating"
                                : syncProgress.action === "updating"
                                ? "Updating"
                                : syncProgress.action === "created"
                                ? "✓ Created"
                                : syncProgress.action === "updated"
                                ? "✓ Updated"
                                : syncProgress.action === "error"
                                ? "✗ Error"
                                : ""
                            }: ${syncProgress.name || ""}`
                          : syncProgress.type === "complete"
                          ? "Complete!"
                          : "Syncing..."
                      }
                      showCard
                    />
                  )}

                  {/* API Mode Output Log */}
                  {output.length > 0 && (
                    <div className="bg-card border border-border rounded-xl overflow-hidden">
                      <PanelHeader
                        title="Sync Log"
                        rightContent={
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearOutput}
                            className="text-xs"
                          >
                            Clear
                          </Button>
                        }
                      />
                      <div className="p-4 max-h-48 overflow-y-auto font-mono text-xs space-y-1">
                        {output.map((line) => (
                          <OutputLine key={line.id} line={line} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Info Box */}
                  <InfoBox variant="tip">
                    API mode provides faster operations with structured
                    responses. Sync is fully supported. For backup and debug,
                    switch to CLI mode using the toggle in the header.
                  </InfoBox>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Story Copy Modal */}
      {showStoryCopyModal && (
        <Modal
          isOpen={true}
          onClose={() => {
            setShowStoryCopyModal(false);
            resetStoryCopyState();
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
                  value={sourceSpaceId || ""}
                  onChange={(e) => {
                    setSourceSpaceId(e.target.value || null);
                    if (e.target.value) {
                      loadSourceStories(e.target.value);
                    } else {
                      setStoryTree([]);
                      setSelectedStoryIds(new Set());
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
                  value={targetSpaceId || ""}
                  onChange={(e) => {
                    setTargetSpaceId(e.target.value || null);
                    if (e.target.value && destinationMode === "browse") {
                      loadTargetStories(e.target.value);
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
                      <span className="ml-2 text-primary">
                        ({selectedStoryIds.size} selected)
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-[400px] overflow-y-auto">
                  {isLoadingStories ? (
                    <LoadingState
                      message="Loading stories..."
                      className="h-full"
                    />
                  ) : !sourceSpaceId ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      Select a source space to load stories
                    </div>
                  ) : storyTree.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <EmptyState
                        icon="📭"
                        message="No stories found"
                        size="sm"
                      />
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
                  <span className="text-sm font-medium">
                    Destination Folder
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setDestinationMode("text")}
                      className={`px-2 py-1 text-xs rounded ${
                        destinationMode === "text"
                          ? "bg-primary/20 text-primary"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Path
                    </button>
                    <button
                      onClick={() => {
                        setDestinationMode("browse");
                        if (targetSpaceId && targetStoryTree.length === 0) {
                          loadTargetStories(targetSpaceId);
                        }
                      }}
                      className={`px-2 py-1 text-xs rounded ${
                        destinationMode === "browse"
                          ? "bg-primary/20 text-primary"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Browse
                    </button>
                  </div>
                </div>
                <div className="h-[368px] overflow-y-auto">
                  {destinationMode === "text" ? (
                    <div className="p-4 space-y-3">
                      <Input
                        value={destinationPath}
                        onChange={(e) => setDestinationPath(e.target.value)}
                        placeholder="e.g., en/blog or leave empty for root"
                      />
                      <p className="text-xs text-muted-foreground">
                        Enter the full slug of the destination folder, or leave
                        empty to copy to root level.
                      </p>
                      {destinationPath && (
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="text-sm">
                            Stories will be copied to:{" "}
                            <span className="text-primary font-mono">
                              /{destinationPath}/
                            </span>
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
                        <LoadingState className="h-full" />
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
                    {copyProgress.status === "copying"
                      ? `Copying: ${copyProgress.currentStory}`
                      : copyProgress.status === "done"
                      ? "Complete!"
                      : "Preparing..."}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {copyProgress.current} / {copyProgress.total}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${
                        (copyProgress.current / copyProgress.total) * 100
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <ModalFooter
            leftContent={
              selectedStoryIds.size > 0 && (
                <span className="text-sm text-muted-foreground">
                  {selectedStoryIds.size}{" "}
                  {selectedStoryIds.size === 1 ? "story" : "stories"} selected
                </span>
              )
            }
            onCancel={() => {
              setShowStoryCopyModal(false);
              resetStoryCopyState();
            }}
            cancelDisabled={isCopying}
            onSubmit={executeStoryCopy}
            submitDisabled={
              selectedStoryIds.size === 0 ||
              !sourceSpaceId ||
              !targetSpaceId ||
              isCopying
            }
            submitContent={
              isCopying ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Copying...
                </>
              ) : (
                `Copy ${
                  selectedStoryIds.size > 0 ? `(${selectedStoryIds.size})` : ""
                }`
              )
            }
          />
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
              <LoadingState
                message={`Discovering ${showResourcePicker.type}...`}
                className="py-8"
              />
            ) : discoveredResources.length === 0 ? (
              <EmptyState
                icon="📭"
                message={`No ${showResourcePicker.type} found in the working directory.`}
              />
            ) : (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-border">
                  <button
                    onClick={toggleAllResources}
                    className="flex items-center gap-2 text-sm hover:text-foreground transition-colors"
                  >
                    <Checkbox
                      checked={
                        selectedResources.size === discoveredResources.length
                      }
                      partial={
                        selectedResources.size > 0 &&
                        selectedResources.size < discoveredResources.length
                      }
                    />
                    Select All
                  </button>
                  <span className="text-muted-foreground text-sm">
                    {selectedResources.size} of {discoveredResources.length}{" "}
                    selected
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

          <ModalFooter
            onCancel={() => setShowResourcePicker(null)}
            onSubmit={executeWithSelectedResources}
            submitDisabled={selectedResources.size === 0 || isDiscovering}
            submitContent={
              <>
                {showResourcePicker.action === "sync" ? "🔄" : "💾"}{" "}
                {showResourcePicker.action.charAt(0).toUpperCase() +
                  showResourcePicker.action.slice(1)}{" "}
                {selectedResources.size > 0
                  ? `(${selectedResources.size})`
                  : ""}
              </>
            }
          />
        </Modal>
      )}
    </div>
  );
}

/**
 * Virtualized resource list
 * Memoized to prevent re-renders when parent state changes but these props don't
 */
const VirtualResourceList = memo(function VirtualResourceList({
  resources,
  selectedResources,
  onToggleSelection,
  workingDir,
}: {
  resources: SbmigDiscoveredComponent[];
  selectedResources: Set<string>;
  onToggleSelection: (name: string) => void;
  workingDir: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: resources.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="max-h-[400px] overflow-y-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const resource = resources[virtualRow.index];
          const isSelected = selectedResources.has(resource.name);

          return (
            <div
              key={resource.filePath}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <button
                onClick={() => onToggleSelection(resource.name)}
                className="w-full flex items-center gap-3 p-2 hover:bg-muted rounded transition-colors"
              >
                <Checkbox checked={isSelected} />
                <div className="flex-1 text-left min-w-0">
                  <div className="font-medium text-sm truncate">
                    {resource.name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {resource.filePath.replace(workingDir, ".")}
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/**
 * Virtualized story tree
 * Memoized to prevent re-renders when parent state changes but these props don't
 */
const VirtualStoryTree = memo(function VirtualStoryTree({
  nodes,
  expandedIds,
  onToggleSelect,
  onToggleExpand,
  isNodeFullySelected,
  isNodePartiallySelected,
}: {
  nodes: StoryblokTreeNode[];
  expandedIds: Set<number>;
  onToggleSelect: (node: StoryblokTreeNode) => void;
  onToggleExpand: (id: number) => void;
  isNodeFullySelected: (node: StoryblokTreeNode) => boolean;
  isNodePartiallySelected: (node: StoryblokTreeNode) => boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Memoize flattened tree - only recompute when nodes or expandedIds change
  const flatNodes = useMemo(() => {
    const flatten = (
      treeNodes: StoryblokTreeNode[],
      depth: number = 0
    ): { node: StoryblokTreeNode; depth: number }[] => {
      const result: { node: StoryblokTreeNode; depth: number }[] = [];
      for (const node of treeNodes) {
        result.push({ node, depth });
        if (node.is_folder && expandedIds.has(node.id)) {
          result.push(...flatten(node.children, depth + 1));
        }
      }
      return result;
    };
    return flatten(nodes);
  }, [nodes, expandedIds]);

  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const { node, depth } = flatNodes[virtualRow.index];
          const isSelected = isNodeFullySelected(node);
          const isPartial = isNodePartiallySelected(node);
          const isExpanded = expandedIds.has(node.id);

          return (
            <div
              key={node.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded transition-colors h-full"
                style={{ paddingLeft: `${depth * 20 + 8}px` }}
              >
                {node.is_folder && (
                  <TreeChevron
                    expanded={isExpanded}
                    onClick={() => onToggleExpand(node.id)}
                  />
                )}
                {!node.is_folder && <div className="w-5" />}

                <Checkbox
                  checked={isSelected}
                  partial={isPartial}
                  onChange={() => onToggleSelect(node)}
                />

                <span className="text-sm truncate flex-1">
                  {node.is_folder ? "📁" : "📄"} {node.name}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/**
 * Destination folder picker
 * Memoized to prevent re-renders when parent state changes but these props don't
 */
const DestinationFolderPicker = memo(function DestinationFolderPicker({
  nodes,
  selectedPath,
  onSelect,
}: {
  nodes: StoryblokTreeNode[];
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => toggleSetItem(prev, id));
  };

  const renderNode = (
    node: StoryblokTreeNode,
    depth: number = 0
  ): React.ReactNode => {
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedPath === node.full_slug;

    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded transition-colors cursor-pointer ${
            isSelected ? "bg-primary/20 text-primary" : ""
          }`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          onClick={() => onSelect(node.full_slug)}
        >
          {node.children.length > 0 && (
            <TreeChevron
              expanded={isExpanded}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.id);
              }}
            />
          )}
          {node.children.length === 0 && <div className="w-5" />}

          <span className="text-sm truncate flex-1">📁 {node.name}</span>

          {isSelected && <span className="text-xs text-primary">✓</span>}
        </div>

        {isExpanded &&
          node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="p-2">
      {/* Root option */}
      <div
        className={`flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded transition-colors cursor-pointer mb-1 ${
          selectedPath === "" ? "bg-primary/20 text-primary" : ""
        }`}
        onClick={() => onSelect("")}
      >
        <div className="w-5" />
        <span className="text-sm">📂 Root (top level)</span>
        {selectedPath === "" && (
          <span className="text-xs text-primary ml-auto">✓</span>
        )}
      </div>

      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No folders found in target space
        </p>
      ) : (
        nodes.map((node) => renderNode(node))
      )}
    </div>
  );
});

/**
 * Virtualized terminal output for CLI mode
 * Renders only visible lines for better performance with large output
 */
const VirtualTerminalOutput = memo(function VirtualTerminalOutput({
  output,
  outputRef,
  autoScroll,
}: {
  output: { id: number; type: "stdout" | "stderr" | "info" | "error" | "complete"; data: string; timestamp: number }[];
  outputRef: React.RefObject<HTMLDivElement | null>;
  autoScroll: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: output.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20, // Approximate line height
    overscan: 20, // Render extra lines for smooth scrolling
  });

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (autoScroll && parentRef.current) {
      requestAnimationFrame(() => {
        if (parentRef.current) {
          parentRef.current.scrollTop = parentRef.current.scrollHeight;
        }
      });
    }
  }, [output.length, autoScroll]);

  // Sync the external ref for parent component access
  useEffect(() => {
    if (outputRef && "current" in outputRef) {
      (outputRef as React.MutableRefObject<HTMLDivElement | null>).current =
        parentRef.current;
    }
  }, [outputRef]);

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto p-4 bg-app-950 terminal-output font-mono text-sm"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const line = output[virtualRow.index];
          return (
            <div
              key={line.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <OutputLine line={line} />
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default App;
