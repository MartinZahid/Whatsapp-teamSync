import { defineConfig } from 'vite'
import path from 'path'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs'

function copyDir(src: string, dest: string) {
  if (!existsSync(src)) return
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

function copyHtmlEntryFiles() {
  const entries = [
    { src: 'extension/src/popup/popup.html', dest: 'dist/popup/popup.html' },
    { src: 'extension/src/options/options.html', dest: 'dist/options/options.html' },
    { src: 'extension/src/content/index.html', dest: 'dist/content/index.html' },
    { src: 'extension/src/background/index.html', dest: 'dist/background/index.html' }
  ]
  for (const entry of entries) {
    if (existsSync(entry.src)) {
      const destDir = path.dirname(entry.dest)
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
      copyFileSync(entry.src, entry.dest)
    }
  }
}

function copyCssToFolders() {
  // Copy popup.css to popup/ folder
  if (existsSync('dist/styles/popup.css')) {
    copyFileSync('dist/styles/popup.css', 'dist/popup/popup.css')
  }
  // Copy options.css to options/ folder
  if (existsSync('dist/styles/options.css')) {
    copyFileSync('dist/styles/options.css', 'dist/options/options.css')
  }
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        'content/index': 'extension/src/content/index.ts',
        'background/service-worker': 'extension/src/background/service-worker.ts',
        'popup/popup': 'extension/src/popup/popup.ts',
        'options/options': 'extension/src/options/options.ts'
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name
          if (name.endsWith('.css')) {
            if (name.includes('index.css') || name.includes('content')) {
              return 'content/styles.css'
            }
            // For popup.css and options.css, put them in styles/ temporarily
            // We'll copy them to correct folders in closeBundle
            return 'styles/[name].css'
          }
          if (name.endsWith('.map')) return 'maps/[name][extname]'
          return '[name][extname]'
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'extension/src'),
      '@shared': path.resolve(__dirname, 'shared')
    }
  },
  plugins: [
    {
      name: 'copy-public-assets',
      closeBundle() {
        copyDir('extension/public', 'dist')
        copyHtmlEntryFiles()
        if (existsSync('dist/index.css')) {
          copyFileSync('dist/index.css', 'dist/content/styles.css')
        }
        // Copy CSS files to correct folders for popup and options pages
        copyCssToFolders()
      }
    }
  ]
})