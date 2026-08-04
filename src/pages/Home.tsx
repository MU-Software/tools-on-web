import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import {
  Box,
  Card,
  CardActionArea,
  Chip,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { TOOLS } from '../tools/registry'

export default function Home() {
  const [keyword, setKeyword] = useState('')

  const items = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return TOOLS
    return TOOLS.filter((t) =>
      [t.title, t.desc, ...t.tags].join(' ').toLowerCase().includes(k),
    )
  }, [keyword])

  return (
    <Stack spacing={2}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          브라우저에서 사용 가능한 도구 모음
        </Typography>
      </Box>

      <TextField
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        type="search"
        placeholder="도구 검색"
        aria-label="도구 검색"
        autoComplete="off"
        fullWidth
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
          htmlInput: { enterKeyHint: 'search' },
        }}
      />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 1.5,
        }}
      >
        {items.map((tool) => (
          <Card key={tool.path} variant="outlined" sx={{ borderRadius: 2.25 }}>
            <CardActionArea
              component={RouterLink}
              to={tool.path}
              sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, p: 2, height: '100%' }}
            >
              <Box
                aria-hidden
                sx={{
                  flex: 'none',
                  width: 40,
                  height: 40,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '1.15rem',
                  borderRadius: 1.5,
                  bgcolor: 'action.hover',
                }}
              >
                {tool.icon}
              </Box>
              <Box>
                <Typography component="h2" sx={{ fontSize: '.95rem', fontWeight: 650 }}>
                  {tool.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: '.8rem' }}>
                  {tool.desc}
                </Typography>
                <Stack direction="row" sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                  {tool.tags.map((tag) => (
                    <Chip key={tag} label={tag} size="small" variant="outlined" />
                  ))}
                </Stack>
              </Box>
            </CardActionArea>
          </Card>
        ))}
      </Box>

      {items.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
          검색 결과가 없습니다
        </Typography>
      )}
    </Stack>
  )
}
