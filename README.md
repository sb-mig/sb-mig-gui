# sb-mig GUI

A visual interface for managing Storyblok CMS with [sb-mig](https://github.com/sb-mig/sb-mig).

## Features

- **Multi-space management** - Configure and switch between multiple Storyblok spaces
- **Component sync** - Sync components, datasources, and roles to Storyblok
- **Backup** - Backup components and stories from Storyblok
- **Story copy** - Copy stories between spaces with folder hierarchy
- **Real-time terminal** - See command output in real-time

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [sb-mig](https://github.com/sb-mig/sb-mig) CLI installed globally (`npm install -g sb-mig`)

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## Build

```bash
# Build for production
npm run build

# Create distributable
npm run dist           # Default platform
npm run dist:mac       # macOS (default arch)
npm run dist:mac:arm64 # macOS Apple Silicon
npm run dist:mac:x64   # macOS Intel
npm run dist:win       # Windows
npm run dist:linux     # Linux
```

## Configuration

1. **OAuth Token** - Get your OAuth token from [Storyblok](https://app.storyblok.com/#/me/account)
2. **Space ID** - Find your space ID in Storyblok's space settings
3. **Access Token** - Create a preview token in your space's settings
4. **Working Directory** - Select your project folder containing `storyblok.config.js`

## Versioning & Releases

This project uses [Changesets](https://github.com/changesets/changesets) for version management.

### Creating a Changeset

When you make changes that should be released:

```bash
npm run changeset
```

This will prompt you to:
1. Select what kind of change (patch/minor/major)
2. Write a summary of the changes

Commit the changeset file with your changes.

### Release Process

1. **Automated Version PR**: When changesets are merged to `main`, a PR is automatically created to bump versions
2. **Merge Version PR**: When the version PR is merged, a git tag is created
3. **Automated Builds**: The tag triggers GitHub Actions to build for macOS and Windows
4. **GitHub Release**: Artifacts are automatically uploaded to a GitHub Release

### Manual Versioning

```bash
# Bump version based on changesets
npm run changeset:version

# Create git tag
git tag v1.x.x
git push origin v1.x.x
```

## Tech Stack

- [Electron](https://www.electronjs.org/) - Desktop app framework
- [React](https://react.dev/) - UI library
- [Vite](https://vitejs.dev/) - Build tool
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Local SQLite database
- [shadcn/ui](https://ui.shadcn.com/) - UI components

## Notes

### Native Modules

This project uses `better-sqlite3`, a native Node.js module. After running `npm install`, the `postinstall` script automatically runs `electron-rebuild` to compile the module for Electron's version of Node.js.

If you encounter issues, you can manually rebuild:

```bash
npx electron-rebuild
```

## License

MIT
