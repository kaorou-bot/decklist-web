// 赛制列表：赛事页与单卡使用率页共用，模块级缓存避免重复请求
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { ServerFormat } from '../api/types'

let cache: ServerFormat[] | null = null

export function useFormats() {
  const [formats, setFormats] = useState<ServerFormat[]>(cache ?? [])
  const [loading, setLoading] = useState(cache === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cache) return
    let alive = true
    api
      .formats()
      .then((f) => {
        cache = f.items ?? []
        if (alive) setFormats(cache)
      })
      .catch((e) => alive && setError(String((e as Error).message ?? e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const defaultFormat = formats.find((f) => f.code === 'ST')?.code ?? formats[0]?.code ?? ''
  return { formats, loading, error, defaultFormat }
}
