# Tools on Web

브라우저에서 바로 쓰는 도구 모음.

pnpm + Vite + React + TypeScript + MUI SPA이며, `main`에 푸시하면 GitHub Actions가
빌드해서 GitHub Pages로 배포합니다.

## 개발

```bash
pnpm install
pnpm dev      # http://127.0.0.1:5173
pnpm build    # 타입체크 + 번들 + 404.html 생성
pnpm lint
```

루트 `index.html`은 저장소에 없습니다. `vite.config.ts`가 설정 로드 시점에
[src/site.ts](src/site.ts)로부터 생성하며 gitignore 대상입니다. 제목·설명·테마색은
`src/site.ts`에서 고치세요.

## 도구 추가하기

[src/tools/registry.ts](src/tools/registry.ts)의 `TOOLS` 배열에 항목 하나만 추가하면
홈 화면의 카드와 라우팅이 함께 생성됩니다.

```ts
{
  path: '/my-tool',
  icon: '🧰',
  title: '내 도구',
  desc: '한 줄 설명',
  tags: ['태그'],
  component: lazy(() => import('./my-tool/MyTool')),
}
```

`lazy()`로 감싸면 해당 도구를 열기 전까지 번들을 내려받지 않습니다. 특히 Serial Tester는
esptool-js 때문에 180KB가 넘으므로 반드시 필요합니다.

## 배포 구성

- **Pages 소스**: 저장소 Settings → Pages → Source를 **GitHub Actions**로 설정
- **커스텀 도메인**: [public/CNAME](public/CNAME)에 `tools.mudev.cc`. DNS에 `tools` CNAME →
  `mu-software.github.io` 레코드 필요
- **SPA 딥링크**: 빌드 스크립트가 `dist/index.html`을 `dist/404.html`로 복사합니다.
  Pages가 없는 경로에 404.html을 돌려주면 그 안의 SPA가 라우팅을 이어받습니다

## 도구별 참고사항

### Serial Tester (`/serial`)

- **WebSerial 플래셔 / WebUSB 디버그**: secure context가 필요하므로 HTTPS 배포에서 정상 동작
- **보드 제어(HTTP/WebSocket)**: 페이지가 HTTPS인데 보드는 `http://` · `ws://`라서 혼합
  콘텐츠로 차단됩니다. 브라우저 사이트 설정에서 "안전하지 않은 콘텐츠"를 허용하고,
  로컬 네트워크 접근(LNA) 권한을 수동으로 허용해야 합니다
