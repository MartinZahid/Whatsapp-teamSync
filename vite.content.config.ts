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

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        'content/index': 'extension/src/content/index.ts'
      },
      output: {
        entryFileNames: '[name].js',
        format: 'iife',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name
          if (name.endsWith('.css')) {
            return 'content/styles.css'
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
      name: 'copy-content-assets',
      closeBundle() {
        copyDir('extension/public', 'dist')
        copyHtmlEntryFiles()
      }
    }
  ]
})
