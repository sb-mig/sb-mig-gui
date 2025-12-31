import { useState, useEffect, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button, Input, Modal, Spinner } from "./components/ui";
import {
  SettingsScreen,
  StoryblokSpace,
} from "./screens/Settings/SettingsScreen";

/**
 * Output line from sb-mig command
 */
interface OutputLine {
  id: number;
  type: "stdout" | "stderr" | "info" | "error" | "complete";
  data: string;
  timestamp: number;
}

/**
 * Resource type for picker
 */
type ResourceType = "components" | "datasources" | "roles";

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

  // Configuration state
  const [oauthToken, setOauthToken] = useState("");
  const [spaces, setSpaces] = useState<StoryblokSpace[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [sbmigVersion, setSbmigVersion] = useState<string | null>(null);
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

  // Terminal output
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const outputRef = useRef<HTMLDivElement>(null);
  const lineIdRef = useRef(0);

  // Active space object and derived working directory
  const activeSpace = spaces.find((s) => s.id === activeSpaceId) || null;
  const workingDir = activeSpace?.workingDir || "";

  /**
   * Load saved configuration on mount
   */
  useEffect(() => {
    const loadConfig = async () => {
      try {
        // Try to get sb-mig version
        try {
          const version = await window.sbmigGui.sbmig.getVersion();
          setSbmigVersion(version);
        } catch {
          // sb-mig not available
        }

        // Load saved settings
        const savedOauthToken = await window.sbmigGui.db.getSetting(
          "sbmig_oauth_token"
        );
        const savedSpacesJson = await window.sbmigGui.db.getSetting(
          "sbmig_spaces"
        );
        const savedActiveSpace = await window.sbmigGui.db.getSetting(
          "sbmig_active_space"
        );

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
        const savedExecutionMode = await window.sbmigGui.db.getSetting(
          "sbmig_execution_mode"
        );
        if (savedExecutionMode === "api" || savedExecutionMode === "cli") {
          setExecutionMode(savedExecutionMode);
        }
      } catch (error) {
        // Failed to load config
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, []);

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
      };
      setOutput((prev) => [...prev, line]);

      if (event.type === "complete") {
        setIsRunning(false);
      }
    });

    return unsubscribe;
  }, []);

  /**
   * Auto-scroll to bottom when new output arrives
   */
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, autoScroll]);

  /**
   * Run sb-mig debug command to validate configuration
   */
  const handleValidate = async () => {
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
  };

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
            type: "error",
            data: "Please select a space first (Settings → Add Space)",
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      if (isRunning) {
        setOutput((prev) => [
          ...prev,
          {
            id: lineIdRef.current++,
            type: "error",
            data: "A command is already running. Please wait or stop it first.",
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      setIsRunning(true);
      await window.sbmigGui.sbmig.execute(command, args, workingDir, {
        oauthToken,
        spaceId: activeSpace?.spaceId,
        accessToken: activeSpace?.accessToken,
      });
    },
    [workingDir, oauthToken, activeSpace, isRunning]
  );

  /**
   * Kill running process
   */
  const handleKillProcess = async () => {
    await window.sbmigGui.sbmig.killProcess();
    setIsRunning(false);
  };

  /**
   * Clear terminal output
   */
  const clearOutput = () => {
    setOutput([]);
    lineIdRef.current = 0;
  };

  /**
   * Open resource picker
   */
  const openResourcePicker = async (
    type: ResourceType,
    action: "sync" | "backup"
  ) => {
    if (!workingDir) {
      setOutput((prev) => [
        ...prev,
        {
          id: lineIdRef.current++,
          type: "error",
          data: "Please select a space first",
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    setIsDiscovering(true);
    setShowResourcePicker({ type, action });
    setSelectedResources(new Set());
    setDiscoveredResources([]);

    try {
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
      setDiscoveredResources(resources);
    } catch {
      // Discovery failed
    } finally {
      setIsDiscovering(false);
    }
  };

  /**
   * Load stories from source space
   */
  const loadSourceStories = async (spaceId: string) => {
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
  };

  /**
   * Load target space story tree for destination picker
   */
  const loadTargetStories = async (spaceId: string) => {
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
  };

  /**
   * Filter tree to only include folders
   */
  const filterFoldersOnly = (
    nodes: StoryblokTreeNode[]
  ): StoryblokTreeNode[] => {
    return nodes
      .filter((node) => node.is_folder)
      .map((node) => ({
        ...node,
        children: filterFoldersOnly(node.children),
      }));
  };

  /**
   * Toggle folder expansion
   */
  const toggleFolderExpansion = (nodeId: number) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  /**
   * Get all story IDs from a node
   */
  const getAllStoryIds = (node: StoryblokTreeNode): number[] => {
    const ids: number[] = [node.id];
    for (const child of node.children) {
      ids.push(...getAllStoryIds(child));
    }
    return ids;
  };

  /**
   * Toggle story selection
   */
  const toggleStorySelection = (node: StoryblokTreeNode) => {
    const allIds = getAllStoryIds(node);
    setSelectedStoryIds((prev) => {
      const next = new Set(prev);
      const allSelected = allIds.every((id) => prev.has(id));

      if (allSelected) {
        allIds.forEach((id) => next.delete(id));
      } else {
        allIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  /**
   * Check if node is fully selected
   */
  const isNodeFullySelected = (node: StoryblokTreeNode): boolean => {
    const allIds = getAllStoryIds(node);
    return allIds.every((id) => selectedStoryIds.has(id));
  };

  /**
   * Check if node is partially selected
   */
  const isNodePartiallySelected = (node: StoryblokTreeNode): boolean => {
    const allIds = getAllStoryIds(node);
    const selectedCount = allIds.filter((id) =>
      selectedStoryIds.has(id)
    ).length;
    return selectedCount > 0 && selectedCount < allIds.length;
  };

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

      setOutput((prev) => [
        ...prev,
        {
          id: lineIdRef.current++,
          type: result.success ? "info" : "error",
          data: `Copy complete: ${result.copiedCount} stories copied${
            result.errors.length > 0 ? `, ${result.errors.length} errors` : ""
          }`,
          timestamp: Date.now(),
        },
      ]);

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
  const resetStoryCopyState = () => {
    setSourceSpaceId(null);
    setTargetSpaceId(null);
    setStoryTree([]);
    setSelectedStoryIds(new Set());
    setExpandedFolders(new Set());
    setDestinationPath("");
    setDestinationMode("browse");
    setTargetStoryTree([]);
    setCopyProgress(null);
  };

  /**
   * Toggle resource selection
   */
  const toggleResourceSelection = (name: string) => {
    setSelectedResources((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  /**
   * Select/deselect all resources
   */
  const toggleAllResources = () => {
    if (selectedResources.size === discoveredResources.length) {
      setSelectedResources(new Set());
    } else {
      setSelectedResources(new Set(discoveredResources.map((r) => r.name)));
    }
  };

  /**
   * Execute with selected resources
   */
  const executeWithSelectedResources = async () => {
    if (!showResourcePicker || selectedResources.size === 0) return;

    const { type, action } = showResourcePicker;
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
        {/* Title Bar */}
        <div className="h-10 bg-app-950 flex items-center justify-center border-b border-border draggable">
          <span className="text-sm font-medium text-muted-foreground">
            sb-mig GUI
          </span>
        </div>
        <SettingsScreen
          oauthToken={oauthToken}
          onOauthTokenChange={setOauthToken}
          spaces={spaces}
          onSpacesChange={setSpaces}
          activeSpaceId={activeSpaceId}
          onActiveSpaceChange={setActiveSpaceId}
          onBack={() => setCurrentView("main")}
        />
      </div>
    );
  }

  // Main view
  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Title Bar (macOS style) */}
      <div className="h-10 bg-app-950 flex items-center justify-center border-b border-border draggable">
        <span className="text-sm font-medium text-muted-foreground">
          sb-mig GUI
        </span>
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
                sb-mig v{sbmigVersion || "unknown"} •{" "}
                {executionMode === "api" ? "Direct API mode" : "CLI mode"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Execution Mode Toggle */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-app-900 border border-border">
              <button
                onClick={async () => {
                  setExecutionMode("api");
                  await window.sbmigGui.db.setSetting(
                    "sbmig_execution_mode",
                    "api"
                  );
                }}
                className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                  executionMode === "api"
                    ? "bg-storyblok-green text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                ⚡ API
              </button>
              <button
                onClick={async () => {
                  setExecutionMode("cli");
                  await window.sbmigGui.db.setSetting(
                    "sbmig_execution_mode",
                    "cli"
                  );
                }}
                className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                  executionMode === "cli"
                    ? "bg-amber-500 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                💻 CLI
              </button>
            </div>

            {/* Status indicators */}
            {validationResult && (
              <span
                className={`px-3 py-1 rounded-lg text-sm ${
                  validationResult.success
                    ? "bg-storyblok-green/20 text-storyblok-green"
                    : "bg-destructive/20 text-destructive"
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
          <div className="text-center">
            <span className="text-6xl mb-4 block">🚀</span>
            <h2 className="text-xl font-semibold mb-2">
              Welcome to sb-mig GUI
            </h2>
            <p className="text-muted-foreground mb-4">
              Get started by configuring your first Storyblok space
            </p>
            <Button onClick={() => setCurrentView("settings")}>
              ⚙️ Open Settings
            </Button>
          </div>
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
                <div
                  key={space.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    activeSpaceId === space.id
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-card border-border text-card-foreground hover:border-muted-foreground"
                  }`}
                  onClick={async () => {
                    setActiveSpaceId(space.id);
                    await window.sbmigGui.db.setSetting(
                      "sbmig_active_space",
                      space.id
                    );
                  }}
                >
                  <div className="font-medium text-sm">{space.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    ID: {space.spaceId}
                  </div>
                  {space.workingDir && (
                    <div
                      className="text-xs text-muted-foreground truncate mt-1"
                      title={space.workingDir}
                    >
                      📁 {space.workingDir.split("/").slice(-2).join("/")}
                    </div>
                  )}
                </div>
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
                    <div className="flex items-center gap-1 pr-3 border-r border-border">
                      <span className="text-xs text-muted-foreground uppercase mr-2">
                        Sync
                      </span>
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
                    </div>

                    <div className="flex items-center gap-1 pr-3 border-r border-border">
                      <span className="text-xs text-muted-foreground uppercase mr-2">
                        Backup
                      </span>
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
                    </div>

                    <div className="flex items-center gap-1 pr-3 border-r border-border">
                      <span className="text-xs text-muted-foreground uppercase mr-2">
                        Copy
                      </span>
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
                      <span className="text-xs text-muted-foreground uppercase mr-2">
                        Other
                      </span>
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
                    </div>

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
                  {/* Terminal Header */}
                  <div className="flex items-center justify-between px-4 py-2 bg-app-950 border-b border-border">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">
                      Terminal Output
                    </span>
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
                    className="flex-1 overflow-y-auto p-4 bg-app-950 terminal-output font-mono text-sm"
                  >
                    {output.length === 0 ? (
                      <div className="text-muted-foreground italic">
                        No output yet. Select a space and run a command to see
                        results here.
                      </div>
                    ) : (
                      output.map((line) => (
                        <div
                          key={line.id}
                          className={`whitespace-pre-wrap ${getLineColor(
                            line.type
                          )}`}
                        >
                          {line.data}
                        </div>
                      ))
                    )}
                  </div>
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
                    {/* Copy Stories Card */}
                    <div className="bg-card border border-border rounded-xl p-6 hover:border-primary/50 transition-colors">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-lg bg-storyblok-green/20 flex items-center justify-center text-2xl">
                          📋
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg mb-1">
                            Copy Stories
                          </h3>
                          <p className="text-sm text-muted-foreground mb-4">
                            Copy stories between spaces with folder structure
                            preserved
                          </p>
                          <Button
                            onClick={() => setShowStoryCopyModal(true)}
                            disabled={spaces.length < 1}
                            className="w-full"
                          >
                            Open Story Copy
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Browse Stories Card */}
                    <div className="bg-card border border-border rounded-xl p-6 hover:border-primary/50 transition-colors">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center text-2xl">
                          🗂️
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg mb-1">
                            Browse Stories
                          </h3>
                          <p className="text-sm text-muted-foreground mb-4">
                            View story tree structure from any space
                          </p>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              if (activeSpace) {
                                setSourceSpaceId(activeSpace.id);
                                loadSourceStories(activeSpace.id);
                                setShowStoryCopyModal(true);
                              }
                            }}
                            disabled={!activeSpaceId}
                            className="w-full"
                          >
                            Browse Current Space
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Discover Resources Card */}
                    <div className="bg-card border border-border rounded-xl p-6 hover:border-primary/50 transition-colors">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center text-2xl">
                          🔍
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg mb-1">
                            Discover Resources
                          </h3>
                          <p className="text-sm text-muted-foreground mb-4">
                            Find components, datasources, and roles in your
                            project
                          </p>
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
                              onClick={() =>
                                openResourcePicker("roles", "sync")
                              }
                              disabled={!activeSpaceId}
                            >
                              Roles
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Coming Soon Card */}
                    <div className="bg-card/50 border border-border/50 rounded-xl p-6 opacity-60">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-2xl">
                          🚧
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg mb-1">
                            More Coming Soon
                          </h3>
                          <p className="text-sm text-muted-foreground mb-4">
                            Sync & Backup via API v2 are in development
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Switch to CLI mode for full sync/backup
                            functionality
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Status/Recent Activity */}
                  {copyProgress && (
                    <div className="bg-card border border-border rounded-xl p-6">
                      <h3 className="font-semibold mb-4">Copy Progress</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Status:</span>
                          <span
                            className={
                              copyProgress.status === "done"
                                ? "text-storyblok-green"
                                : copyProgress.status === "error"
                                ? "text-destructive"
                                : "text-yellow-400"
                            }
                          >
                            {copyProgress.status === "done"
                              ? "✅ Complete"
                              : copyProgress.status === "error"
                              ? "❌ Error"
                              : "⏳ " + copyProgress.currentStory}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            Progress:
                          </span>
                          <span>
                            {copyProgress.current} / {copyProgress.total}
                          </span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div
                            className="bg-storyblok-green h-2 rounded-full transition-all"
                            style={{
                              width: `${
                                (copyProgress.current / copyProgress.total) *
                                100
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Info Box */}
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                    <p className="text-sm text-blue-400">
                      <strong>💡 Tip:</strong> API mode provides faster
                      operations with structured responses. For full CLI
                      functionality (sync, backup, debug), switch to CLI mode
                      using the toggle in the header.
                    </p>
                  </div>
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
                    <div className="flex items-center justify-center h-full">
                      <Spinner size="lg" />
                      <span className="ml-3 text-muted-foreground">
                        Loading stories...
                      </span>
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

          <div className="flex gap-3 pt-4 border-t border-border mt-4">
            <div className="flex-1 text-sm text-muted-foreground">
              {selectedStoryIds.size > 0 && (
                <span>
                  {selectedStoryIds.size}{" "}
                  {selectedStoryIds.size === 1 ? "story" : "stories"} selected
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                setShowStoryCopyModal(false);
                resetStoryCopyState();
              }}
              disabled={isCopying}
            >
              Cancel
            </Button>
            <Button
              onClick={executeStoryCopy}
              disabled={
                selectedStoryIds.size === 0 ||
                !sourceSpaceId ||
                !targetSpaceId ||
                isCopying
              }
            >
              {isCopying ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Copying...
                </>
              ) : (
                `Copy ${
                  selectedStoryIds.size > 0 ? `(${selectedStoryIds.size})` : ""
                }`
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
                          ? "bg-primary border-primary"
                          : "border-muted-foreground"
                      }`}
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

          <div className="flex gap-3 pt-4 border-t border-border mt-4">
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => setShowResourcePicker(null)}>
              Cancel
            </Button>
            <Button
              onClick={executeWithSelectedResources}
              disabled={selectedResources.size === 0 || isDiscovering}
            >
              {showResourcePicker.action === "sync" ? "🔄" : "💾"}{" "}
              {showResourcePicker.action.charAt(0).toUpperCase() +
                showResourcePicker.action.slice(1)}{" "}
              {selectedResources.size > 0 ? `(${selectedResources.size})` : ""}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Get color class for output line type
 */
function getLineColor(type: OutputLine["type"]): string {
  switch (type) {
    case "stdout":
      return "text-foreground";
    case "stderr":
      return "text-yellow-400";
    case "info":
      return "text-blue-400";
    case "error":
      return "text-red-400";
    case "complete":
      return "text-storyblok-green";
    default:
      return "text-muted-foreground";
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
                <div
                  className={`w-4 h-4 rounded border transition-colors flex-shrink-0 ${
                    isSelected
                      ? "bg-primary border-primary"
                      : "border-muted-foreground"
                  }`}
                />
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
  nodes: StoryblokTreeNode[];
  expandedIds: Set<number>;
  onToggleSelect: (node: StoryblokTreeNode) => void;
  onToggleExpand: (id: number) => void;
  isNodeFullySelected: (node: StoryblokTreeNode) => boolean;
  isNodePartiallySelected: (node: StoryblokTreeNode) => boolean;
}) {
  // Flatten the tree for virtualization
  const flattenTree = (
    nodes: StoryblokTreeNode[],
    depth: number = 0
  ): { node: StoryblokTreeNode; depth: number }[] => {
    const result: { node: StoryblokTreeNode; depth: number }[] = [];
    for (const node of nodes) {
      result.push({ node, depth });
      if (node.is_folder && expandedIds.has(node.id)) {
        result.push(...flattenTree(node.children, depth + 1));
      }
    }
    return result;
  };

  const flatNodes = flattenTree(nodes);
  const parentRef = useRef<HTMLDivElement>(null);

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
                  <button
                    onClick={() => onToggleExpand(node.id)}
                    className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    {isExpanded ? "▼" : "▶"}
                  </button>
                )}
                {!node.is_folder && <div className="w-5" />}

                <button
                  onClick={() => onToggleSelect(node)}
                  className={`w-4 h-4 rounded border transition-colors flex-shrink-0 ${
                    isSelected
                      ? "bg-primary border-primary"
                      : isPartial
                      ? "bg-primary/50 border-primary"
                      : "border-muted-foreground"
                  }`}
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
}

/**
 * Destination folder picker
 */
function DestinationFolderPicker({
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
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
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
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.id);
              }}
              className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {isExpanded ? "▼" : "▶"}
            </button>
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
}

export default App;
