import { useState, useEffect } from 'react'
import { Button, Input, Modal, EmptyState, InfoBox } from '../../components/ui'

/**
 * Stored space configuration
 */
export interface StoryblokSpace {
  id: string
  name: string
  spaceId: string
  accessToken: string
  workingDir: string
}

interface SettingsScreenProps {
  oauthToken: string
  onOauthTokenChange: (token: string) => void
  spaces: StoryblokSpace[]
  onSpacesChange: (spaces: StoryblokSpace[]) => void
  activeSpaceId: string | null
  onActiveSpaceChange: (spaceId: string | null) => void
  debugMode: boolean
  onDebugModeChange: (enabled: boolean) => void
  onBack: () => void
}

/**
 * Settings Screen - OAuth Token & Spaces Management
 */
export function SettingsScreen({
  oauthToken,
  onOauthTokenChange,
  spaces,
  onSpacesChange,
  activeSpaceId,
  onActiveSpaceChange,
  debugMode,
  onDebugModeChange,
  onBack,
}: SettingsScreenProps) {
  const [showOAuthToken, setShowOAuthToken] = useState(false)
  const [showAddSpace, setShowAddSpace] = useState(false)
  const [editingSpace, setEditingSpace] = useState<StoryblokSpace | null>(null)
  const [tokenSaved, setTokenSaved] = useState(false)

  /**
   * Toggle debug mode
   */
  const handleToggleDebugMode = async () => {
    const newValue = !debugMode
    onDebugModeChange(newValue)
    await window.sbmigGui.db.setSetting('sbmig_debug_mode', newValue ? 'true' : 'false')
  }

  /**
   * Save OAuth token with feedback
   */
  const handleSaveToken = async (token: string) => {
    onOauthTokenChange(token)
    await window.sbmigGui.db.setSetting('sbmig_oauth_token', token)
    setTokenSaved(true)
    setTimeout(() => setTokenSaved(false), 2000)
  }

  /**
   * Add a new space
   */
  const handleAddSpace = async (
    name: string,
    spaceId: string,
    accessToken: string,
    workingDir: string
  ) => {
    const newSpace: StoryblokSpace = {
      id: crypto.randomUUID(),
      name,
      spaceId,
      accessToken,
      workingDir,
    }
    const newSpaces = [...spaces, newSpace]
    onSpacesChange(newSpaces)
    await window.sbmigGui.db.setSetting('sbmig_spaces', JSON.stringify(newSpaces))
    
    // Auto-select if first space
    if (!activeSpaceId) {
      onActiveSpaceChange(newSpace.id)
      await window.sbmigGui.db.setSetting('sbmig_active_space', newSpace.id)
    }
    
    setShowAddSpace(false)
  }

  /**
   * Update an existing space
   */
  const handleUpdateSpace = async (
    id: string,
    name: string,
    spaceId: string,
    accessToken: string,
    workingDir: string
  ) => {
    const newSpaces = spaces.map((s) =>
      s.id === id ? { ...s, name, spaceId, accessToken, workingDir } : s
    )
    onSpacesChange(newSpaces)
    await window.sbmigGui.db.setSetting('sbmig_spaces', JSON.stringify(newSpaces))
    setEditingSpace(null)
  }

  /**
   * Delete a space
   */
  const handleDeleteSpace = async (id: string) => {
    const newSpaces = spaces.filter((s) => s.id !== id)
    onSpacesChange(newSpaces)
    await window.sbmigGui.db.setSetting('sbmig_spaces', JSON.stringify(newSpaces))
    
    if (activeSpaceId === id) {
      const newActiveId = newSpaces[0]?.id || null
      onActiveSpaceChange(newActiveId)
      if (newActiveId) {
        await window.sbmigGui.db.setSetting('sbmig_active_space', newActiveId)
      }
    }
    
    setEditingSpace(null)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Back
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <span className="text-2xl">⚙️</span> Settings
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Configure OAuth token and manage Storyblok spaces
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* OAuth Token Section */}
          <section className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span>🔑</span> OAuth Token
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Your personal OAuth token is used for API authentication across all spaces. 
              Get it from your{' '}
              <a 
                href="https://app.storyblok.com/#/me/account" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Storyblok account settings
              </a>.
            </p>
            <div className="flex items-center gap-2">
              <Input
                type={showOAuthToken ? 'text' : 'password'}
                value={oauthToken}
                onChange={(e) => handleSaveToken(e.target.value)}
                placeholder="Enter your OAuth token..."
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowOAuthToken(!showOAuthToken)}
                className="px-3"
              >
                {showOAuthToken ? '🙈' : '👁️'}
              </Button>
            </div>
            {tokenSaved && (
              <p className="text-sm text-storyblok-green mt-2">✓ Token saved</p>
            )}
          </section>

          {/* Spaces Section */}
          <section className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span>🌐</span> Storyblok Spaces
              </h2>
              <Button variant="secondary" size="sm" onClick={() => setShowAddSpace(true)}>
                + Add Space
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Configure your Storyblok spaces with their credentials and working directories.
            </p>

            {spaces.length === 0 ? (
              <EmptyState
                icon="📭"
                message="No spaces configured yet."
                submessage="Click 'Add Space' to get started."
              />
            ) : (
              <div className="space-y-3">
                {spaces.map((space) => (
                  <div
                    key={space.id}
                    className={`p-4 rounded-lg border transition-all ${
                      activeSpaceId === space.id
                        ? 'bg-primary/10 border-primary/30'
                        : 'bg-muted/50 border-border hover:border-muted-foreground'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{space.name}</span>
                          {activeSpaceId === space.id && (
                            <span className="px-2 py-0.5 rounded text-xs bg-primary/20 text-primary flex-shrink-0">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          Space ID: {space.spaceId}
                        </div>
                        <div className="text-sm text-muted-foreground truncate mt-1" title={space.workingDir}>
                          📁 {space.workingDir}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                        {activeSpaceId !== space.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              onActiveSpaceChange(space.id)
                              await window.sbmigGui.db.setSetting('sbmig_active_space', space.id)
                            }}
                          >
                            Set Active
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingSpace(space)}
                        >
                          ✏️ Edit
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Advanced Settings Section */}
          <section className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span>🔧</span> Advanced Settings
            </h2>
            
            {/* Debug Mode Toggle */}
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div className="flex-1">
                <div className="font-medium">Debug Mode</div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Show detailed logs, file paths, and timing information during operations
                </p>
              </div>
              <button
                onClick={handleToggleDebugMode}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                  debugMode ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    debugMode ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {debugMode && (
              <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <p className="text-sm text-amber-400 flex items-center gap-2">
                  <span>⚠️</span>
                  Debug mode is enabled. More detailed information will be shown in the sync log.
                </p>
              </div>
            )}
          </section>

          {/* Info Section */}
          <InfoBox variant="tip" title="Tips">
            <ul className="text-sm space-y-1 list-none p-0 m-0">
              <li>• The OAuth token is required for operations like copying stories between spaces</li>
              <li>• Each space needs its own Access Token (preview or public token)</li>
              <li>• The working directory should contain your project's <code className="px-1 bg-muted rounded">storyblok.config.js</code></li>
              <li>• You can quickly switch between spaces from the main view</li>
              <li>• Enable Debug Mode to see detailed logs and troubleshoot issues</li>
            </ul>
          </InfoBox>
        </div>
      </div>

      {/* Add Space Modal */}
      <SpaceModal
        isOpen={showAddSpace}
        onClose={() => setShowAddSpace(false)}
        onSave={handleAddSpace}
        title="Add Space"
      />

      {/* Edit Space Modal */}
      {editingSpace && (
        <SpaceModal
          isOpen={true}
          onClose={() => setEditingSpace(null)}
          onSave={(name, spaceId, accessToken, workingDir) =>
            handleUpdateSpace(editingSpace.id, name, spaceId, accessToken, workingDir)
          }
          onDelete={() => handleDeleteSpace(editingSpace.id)}
          title="Edit Space"
          initialName={editingSpace.name}
          initialSpaceId={editingSpace.spaceId}
          initialAccessToken={editingSpace.accessToken}
          initialWorkingDir={editingSpace.workingDir}
        />
      )}
    </div>
  )
}

/**
 * Space modal for adding/editing
 */
function SpaceModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  title,
  initialName = '',
  initialSpaceId = '',
  initialAccessToken = '',
  initialWorkingDir = '',
}: {
  isOpen: boolean
  onClose: () => void
  onSave: (name: string, spaceId: string, accessToken: string, workingDir: string) => void
  onDelete?: () => void
  title: string
  initialName?: string
  initialSpaceId?: string
  initialAccessToken?: string
  initialWorkingDir?: string
}) {
  const [name, setName] = useState(initialName)
  const [spaceId, setSpaceId] = useState(initialSpaceId)
  const [accessToken, setAccessToken] = useState(initialAccessToken)
  const [workingDir, setWorkingDir] = useState(initialWorkingDir)
  const [showToken, setShowToken] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setName(initialName)
      setSpaceId(initialSpaceId)
      setAccessToken(initialAccessToken)
      setWorkingDir(initialWorkingDir)
    }
  }, [isOpen, initialName, initialSpaceId, initialAccessToken, initialWorkingDir])

  const handleSave = () => {
    if (!name.trim() || !spaceId.trim() || !accessToken.trim() || !workingDir.trim()) return
    onSave(name.trim(), spaceId.trim(), accessToken.trim(), workingDir.trim())
  }

  const handleSelectDirectory = async () => {
    const dir = await window.sbmigGui.sbmig.selectDirectory()
    if (dir) {
      setWorkingDir(dir)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="md">
      <div className="space-y-4 overflow-hidden">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-muted-foreground">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Production, Staging"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-muted-foreground">Space ID</label>
          <input
            type="text"
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
            placeholder="e.g., 12345"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-muted-foreground">Access Token</label>
          <div className="flex items-center gap-2">
            <input
              type={showToken ? 'text' : 'password'}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Preview/Public token"
              className="flex-1 min-w-0 h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <Button variant="ghost" size="sm" onClick={() => setShowToken(!showToken)} className="flex-shrink-0">
              {showToken ? '🙈' : '👁️'}
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-muted-foreground">Working Directory</label>
          <div className="flex items-center gap-2">
            <div 
              className="flex-1 min-w-0 px-3 py-2 bg-muted border border-border rounded-lg text-sm overflow-hidden"
              title={workingDir || undefined}
            >
              <div className="truncate">{workingDir || 'No directory selected'}</div>
            </div>
            <Button variant="secondary" size="sm" onClick={handleSelectDirectory} className="flex-shrink-0">
              Browse
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Project folder containing storyblok.config.js
          </p>
        </div>
      </div>

      <div className="flex gap-3 pt-4">
        {onDelete && (
          <Button variant="destructive" onClick={onDelete}>
            Delete
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={!name.trim() || !spaceId.trim() || !accessToken.trim() || !workingDir.trim()}
        >
          Save
        </Button>
      </div>
    </Modal>
  )
}

export default SettingsScreen

