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

# Create distributable (macOS)
npm run dist:mac
```

## Configuration

1. **OAuth Token** - Get your OAuth token from [Storyblok](https://app.storyblok.com/#/me/account)
2. **Space ID** - Find your space ID in Storyblok's space settings
3. **Access Token** - Create a preview token in your space's settings
4. **Working Directory** - Select your project folder containing `storyblok.config.js`

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
