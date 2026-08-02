import { useWallpaperStore, type Wallpaper } from '../../shared/store/wallpaperStore'
import {
  useAppearanceStore,
  ACCENT_PRESETS,
  type ThemeMode,
} from '../../shared/store/appearanceStore'
import {
  Monitor,
  Palette,
  Moon,
  Sun,
  Check,
  Image,
  LayoutGrid,
  Keyboard,
  HardDrive,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { Checkbox } from '../../shared/components/ui'
import { APP_REGISTRY } from '../../shared/registry/registry'
import { NON_DISABLEABLE } from '../../shared/registry/enabledApps'
import { useAddonStore } from '../../shared/store/addonStore'
import { ShortcutList } from '../../shared/components/shortcuts/ShortcutsOverlay'
import { StorageSettings } from './StorageSettings'
import { SecuritySettings } from '../auth/SecuritySettings'

const WALLPAPERS: { id: Wallpaper; name: string; preview: React.CSSProperties }[] = [
  {
    id: 'dots',
    name: 'Dots',
    preview: {
      backgroundImage: 'radial-gradient(var(--k-outline-variant) 1px, transparent 1px)',
      backgroundSize: '12px 12px',
      backgroundColor: 'var(--k-surface)',
    },
  },
  {
    id: 'grid',
    name: 'Grid',
    preview: {
      backgroundImage:
        'linear-gradient(var(--k-outline-variant) 1px, transparent 1px), linear-gradient(90deg, var(--k-outline-variant) 1px, transparent 1px)',
      backgroundSize: '16px 16px',
      backgroundColor: 'var(--k-surface)',
    },
  },
  {
    id: 'linen',
    name: 'Fine',
    preview: {
      backgroundImage:
        'radial-gradient(var(--k-outline-variant) 0.5px, transparent 0.5px), radial-gradient(var(--k-outline-variant) 0.5px, var(--k-surface) 0.5px)',
      backgroundSize: '6px 6px',
      backgroundPosition: '0 0, 3px 3px',
      backgroundColor: 'var(--k-surface)',
    },
  },
]

const THEMES: { id: ThemeMode; name: string; icon: typeof Moon }[] = [
  { id: 'dark', name: 'Dark', icon: Moon },
  { id: 'light', name: 'Light', icon: Sun },
]

function SectionHeader({ icon: Icon, title }: { icon: typeof Monitor; title: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="border-outline-variant bg-surface-container text-primary flex h-9 w-9 items-center justify-center border">
        <Icon size={18} strokeWidth={1.75} />
      </div>
      <h2 className="font-ui text-on-surface text-base font-semibold">{title}</h2>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-ui text-on-surface-variant mb-3 text-[11px] font-semibold tracking-widest uppercase">
      {children}
    </p>
  )
}

export function Settings() {
  const { wallpaper, setWallpaper } = useWallpaperStore()
  const theme = useAppearanceStore((s) => s.theme)
  const accent = useAppearanceStore((s) => s.accent)
  const setTheme = useAppearanceStore((s) => s.setTheme)
  const setAccent = useAppearanceStore((s) => s.setAccent)
  const disabledApps = useAddonStore((s) => s.disabled)
  const toggleApp = useAddonStore((s) => s.toggle)

  return (
    <div className="bg-surface text-on-surface flex h-full flex-col select-none">
      <div className="custom-scrollbar flex-1 overflow-y-auto p-7">
        <header className="mb-8">
          <h1 className="font-ui text-on-surface text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-on-surface-variant mt-1 text-[13px]">Tune the look of ImbatranimOS.</p>
        </header>

        {/* Appearance ─────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionHeader icon={Palette} title="Appearance" />

          {/* Theme */}
          <div className="mb-8">
            <FieldLabel>Theme</FieldLabel>
            <div className="flex gap-3">
              {THEMES.map((t) => {
                const Icon = t.icon
                const active = theme === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-2 border px-4 py-2.5 text-[12px] font-medium transition-colors outline-none',
                      'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset',
                      active
                        ? 'border-primary bg-primary text-on-primary'
                        : 'border-outline-variant bg-surface-container-low text-on-surface hover:bg-surface-container-high'
                    )}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    {t.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Accent */}
          <div className="mb-8">
            <FieldLabel>Accent color</FieldLabel>
            <div className="flex flex-wrap gap-3">
              {ACCENT_PRESETS.map((preset) => {
                const active = accent === preset.id
                return (
                  <button
                    key={preset.id}
                    onClick={() => setAccent(preset.id)}
                    title={preset.name}
                    aria-label={preset.name}
                    aria-pressed={active}
                    className={cn(
                      'group flex items-center gap-2 border px-2.5 py-2 transition-colors outline-none',
                      'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset',
                      active
                        ? 'border-primary bg-surface-container-high'
                        : 'border-outline-variant bg-surface-container-low hover:bg-surface-container'
                    )}
                  >
                    <span
                      className="flex h-6 w-6 items-center justify-center"
                      style={{ backgroundColor: preset.hex, color: preset.on }}
                    >
                      {active && <Check size={13} strokeWidth={3} />}
                    </span>
                    <span className="text-on-surface pr-1 text-[12px] font-medium">
                      {preset.name}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Wallpaper */}
          <div>
            <FieldLabel>Desktop pattern</FieldLabel>
            <div className="grid grid-cols-3 gap-4">
              {WALLPAPERS.map((wp) => {
                const active = wallpaper === wp.id
                return (
                  <button
                    key={wp.id}
                    onClick={() => setWallpaper(wp.id)}
                    className={cn(
                      'group relative overflow-hidden border transition-colors outline-none',
                      'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset',
                      active ? 'border-primary' : 'border-outline-variant hover:border-outline'
                    )}
                  >
                    <div className="aspect-[16/10] w-full" style={wp.preview} />
                    {active && (
                      <div className="bg-primary text-on-primary absolute top-2 right-2 flex h-5 w-5 items-center justify-center">
                        <Check size={12} strokeWidth={3} />
                      </div>
                    )}
                    <div className="border-outline-variant bg-surface-container-low flex items-center gap-1.5 border-t px-2 py-1.5">
                      <Image size={12} strokeWidth={1.75} className="text-on-surface-variant" />
                      <span className="text-on-surface text-[11px] font-medium">{wp.name}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {/* Apps ────────────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionHeader icon={LayoutGrid} title="Apps" />
          <p className="text-on-surface-variant mb-5 text-[12px]">
            Turn add-ons on or off. Disabled apps disappear from Start, search, and the desktop —
            their code never loads. Core apps stay on so you can't lock yourself out.
          </p>
          <div className="grid gap-2">
            {APP_REGISTRY.map((app) => {
              const AppIcon = app.icon
              const required = NON_DISABLEABLE.has(app.id)
              const enabled = required || !disabledApps.includes(app.id)
              return (
                <div
                  key={app.id}
                  className="border-outline-variant bg-surface-container-low flex items-center gap-3 border px-3 py-2.5"
                >
                  <span className="border-outline-variant bg-surface-container-lowest text-on-surface flex h-7 w-7 shrink-0 items-center justify-center border">
                    <AppIcon size={15} strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-ui text-on-surface block truncate text-[13px] font-medium">
                      {app.name}
                    </span>
                    <span className="text-on-surface-variant block truncate text-[11px]">
                      {app.description}
                    </span>
                  </span>
                  {required && (
                    <span className="text-on-surface-variant text-[9px] font-semibold tracking-widest uppercase">
                      Required
                    </span>
                  )}
                  <Checkbox
                    aria-label={`Enable ${app.name}`}
                    checked={enabled}
                    disabled={required}
                    onCheckedChange={() => toggleApp(app.id)}
                  />
                </div>
              )
            })}
          </div>
        </section>

        {/* Storage ────────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionHeader icon={HardDrive} title="Storage" />
          <StorageSettings />
        </section>

        {/* Keyboard ───────────────────────────────────────────── */}
        <section className="mb-10">
          <SectionHeader icon={Keyboard} title="Keyboard shortcuts" />
          <p className="font-ui text-on-surface-variant mb-3 text-[11px]">
            Press <span className="text-on-surface font-semibold">?</span> anywhere on the desktop
            to open this list.
          </p>
          <ShortcutList />
        </section>

        {/* Security ───────────────────────────────────────────── */}
        <SecuritySettings />

        {/* About ──────────────────────────────────────────────── */}
        <section className="border-outline-variant mb-6 border-t pt-8">
          <SectionHeader icon={Monitor} title="About this machine" />
          <div className="grid gap-2">
            {[
              { label: 'OS', value: 'ImbatranimOS' },
              { label: 'Shell', value: 'React desktop on Alpine' },
              { label: 'Status', value: 'Developer Preview' },
            ].map((item) => (
              <div
                key={item.label}
                className="border-outline-variant bg-surface-container-low flex items-center justify-between border px-3 py-2.5"
              >
                <span className="text-on-surface-variant text-[10px] font-semibold tracking-widest uppercase">
                  {item.label}
                </span>
                <span className="font-ui text-on-surface text-[13px] font-semibold">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="border-outline-variant bg-surface-container-low flex items-center justify-between border-t px-7 py-3">
        <span className="text-on-surface-variant text-[10px] font-semibold tracking-widest uppercase">
          ImbatranimOS
        </span>
        <span className="font-ui text-on-surface-variant text-[10px] tabular-nums">
          v0.1 · preview
        </span>
      </div>
    </div>
  )
}
