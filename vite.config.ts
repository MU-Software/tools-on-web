import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { SITE } from './src/site'

// Vite의 진입점은 실제 index.html 파일이어야 하므로, 저장소에 두는 대신
// 설정 로드 시점(dev·build 공통)에 src/site.ts로부터 생성합니다.
writeFileSync(
  fileURLToPath(new URL('./index.html', import.meta.url)),
  `<!doctype html>
<html lang="${SITE.lang}">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="${SITE.themeColor}" />
    <title>${SITE.title}</title>
    <meta name="description" content="${SITE.description}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
)

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset({ target: '19' })] }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
