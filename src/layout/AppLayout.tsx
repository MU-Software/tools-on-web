import { Suspense } from 'react'
import { Link as RouterLink, Outlet, useLocation } from 'react-router'
import {
  AppBar,
  Box,
  CircularProgress,
  Container,
  IconButton,
  Toolbar,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { TOOLS } from '../tools/registry'
import { SITE } from '../site'

export function AppLayout() {
  const { pathname } = useLocation()
  const isHome = pathname === '/'
  const current = TOOLS.find((t) => t.path === pathname)

  return (
    <Box sx={{ minHeight: '100svh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" color="transparent" elevation={0} sx={{ backdropFilter: 'blur(8px)' }}>
        <Toolbar sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
          {!isHome && (
            <IconButton component={RouterLink} to="/" edge="start" aria-label="도구 목록으로" sx={{ mr: 1 }}>
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography
            variant="h6"
            component={isHome ? 'h1' : 'div'}
            sx={{ flexGrow: 1, fontSize: '1.05rem', letterSpacing: '-.02em' }}
          >
            {current?.title ?? SITE.title}
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ py: 3 }}>
        <Suspense
          fallback={
            <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
              <CircularProgress />
            </Box>
          }
        >
          <Outlet />
        </Suspense>
      </Container>
    </Box>
  )
}
