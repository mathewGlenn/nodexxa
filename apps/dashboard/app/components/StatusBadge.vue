<template>
  <!-- Health is always conveyed by icon + text, never by color alone. -->
  <UBadge :color="meta.color" variant="subtle" :icon="meta.icon" :data-status="normalized" class="whitespace-nowrap">
    {{ label ?? meta.label }}
  </UBadge>
</template>

<script setup lang="ts">
type Color = 'success' | 'warning' | 'error' | 'neutral' | 'info' | 'primary'
const props = defineProps<{ status?: string | null, label?: string }>()

const MAP: Record<string, { color: Color, icon: string, label: string }> = {
  healthy: { color: 'success', icon: 'i-lucide-circle-check', label: 'Healthy' },
  degraded: { color: 'warning', icon: 'i-lucide-triangle-alert', label: 'Degraded' },
  unhealthy: { color: 'error', icon: 'i-lucide-circle-x', label: 'Unhealthy' },
  unreachable: { color: 'error', icon: 'i-lucide-unplug', label: 'Unreachable' },
  stale: { color: 'warning', icon: 'i-lucide-clock-alert', label: 'Stale' },
  unknown: { color: 'neutral', icon: 'i-lucide-circle-help', label: 'Unknown' },
  unsupported: { color: 'neutral', icon: 'i-lucide-circle-slash', label: 'Not supported' },
  missing: { color: 'neutral', icon: 'i-lucide-ghost', label: 'Missing at provider' },
  disabled: { color: 'neutral', icon: 'i-lucide-circle-pause', label: 'Disabled' },
  pending: { color: 'info', icon: 'i-lucide-loader', label: 'Pending' },
  revoked: { color: 'neutral', icon: 'i-lucide-ban', label: 'Revoked' },
  info: { color: 'info', icon: 'i-lucide-info', label: 'Info' },
}

// Maps raw provider/agent states onto the platform's reliability vocabulary.
const ALIASES: Record<string, string> = {
  ok: 'healthy', up: 'healthy', active: 'healthy', online: 'healthy', running: 'healthy', healthy: 'healthy',
  down: 'unhealthy', error: 'unhealthy', auth_error: 'unhealthy', errored: 'unhealthy', exited: 'unhealthy', dead: 'unhealthy', failed: 'unhealthy', stopped: 'unhealthy', off: 'unhealthy', unhealthy: 'unhealthy', critical: 'unhealthy',
  rate_limited: 'degraded', warning: 'degraded', restarting: 'degraded', starting: 'pending', deploying: 'pending', building: 'pending', new: 'pending', pending_deployment: 'pending', creating: 'pending',
  stale: 'stale', never_seen: 'unknown', forbidden: 'unsupported', no_data: 'unknown', unavailable: 'unsupported', not_supported: 'unsupported',
  open: 'unhealthy', acknowledged: 'degraded', resolved: 'healthy', archive: 'disabled', inactive: 'unhealthy', superseded: 'disabled', canceled: 'disabled',
}

const normalized = computed(() => {
  const s = (props.status ?? 'unknown').toLowerCase()
  return MAP[s] ? s : ALIASES[s] ?? 'unknown'
})
const meta = computed(() => {
  const base = MAP[normalized.value]!
  // Keep the raw provider wording visible when it differs from our category.
  const raw = props.status && !MAP[props.status.toLowerCase()] ? props.status.replaceAll('_', ' ').toLowerCase() : null
  return { ...base, label: raw ?? base.label }
})
</script>
