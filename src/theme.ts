import { createTheme, type Theme } from '@mui/material/styles'

export function buildTheme(mode: 'light' | 'dark'): Theme {
  return createTheme({
    palette: {
      mode,
      ...(mode === 'light'
        ? {
            primary: { main: '#2f5bff' },
            secondary: { main: '#f48fb1' },
            background: { default: '#f4f5f7', paper: '#ffffff' },
            text: { primary: '#14161a', secondary: '#6b7280' },
            divider: '#e3e5ea',
          }
        : {
            primary: { main: '#6b8cff' },
            secondary: { main: '#f48fb1' },
            background: { default: '#0b0d12', paper: '#151922' },
            text: { primary: '#eef1f6', secondary: '#97a0b0' },
            divider: '#262c38',
          }),
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"Apple SD Gothic Neo"',
        'Pretendard',
        '"Noto Sans KR"',
        '"Segoe UI"',
        'Roboto',
        'sans-serif',
      ].join(','),
    },
  })
}
