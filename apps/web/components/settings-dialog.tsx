'use client';

import type { ReactNode } from 'react';
import { usePrefs } from '@/components/providers';
import { Segmented, Slider, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectItem } from '@/components/ui/menus';
import { THEMES, type ThemeId, type UserPreferences } from '@/lib/prefs';

/** VS Code-style settings (docs/ui-ux/04 §3). Everything persists to `ide-preferences` and applies instantly. */
export function SettingsDialog({
  open,
  onOpenChange,
  onLatencyChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLatencyChange?: (ms: number) => void;
}) {
  const { prefs, setPrefs } = usePrefs();
  const set = <K extends keyof UserPreferences>(k: K) => (v: UserPreferences[K]) => setPrefs({ [k]: v } as Partial<UserPreferences>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Saved on this device.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="appearance" className="flex min-h-0 flex-col gap-3">
          <TabsList aria-label="Settings sections" className="self-start">
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="collab">Collaboration</TabsTrigger>
            <TabsTrigger value="network">Network</TabsTrigger>
          </TabsList>
          <div className="min-h-72 overflow-y-auto">
            <TabsContent value="appearance" className="flex flex-col gap-1">
              <Row label="Color theme">
                <Select value={prefs.themeId} onValueChange={(v) => set('themeId')(v as ThemeId)} aria-label="Color theme" className="w-52">
                  {THEMES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </Select>
              </Row>
              <Row label="UI font scale">
                <Segmented
                  aria-label="UI font scale"
                  value={prefs.uiScale}
                  onValueChange={set('uiScale')}
                  options={[
                    { value: 'sm', label: 'Small' },
                    { value: 'md', label: 'Medium' },
                    { value: 'lg', label: 'Large' },
                  ]}
                />
              </Row>
              <Row id="pref-ambient" label="Ambient animations" hint="Canvas orbs for connecting and storms">
                <Switch id="pref-ambient" checked={prefs.ambientAnimations} onCheckedChange={set('ambientAnimations')} aria-label="Ambient animations" />
              </Row>
              <Row id="pref-reduce-motion" label="Reduce motion" hint="Turns off transitions and morphs">
                <Switch id="pref-reduce-motion" checked={prefs.reduceMotion} onCheckedChange={set('reduceMotion')} aria-label="Reduce motion" />
              </Row>
            </TabsContent>

            <TabsContent value="editor" className="flex flex-col gap-1">
              <Row label={`Code font size (${prefs.editorFontSize}px)`}>
                <Slider className="w-52" min={11} max={18} step={1} value={[prefs.editorFontSize]} onValueChange={([v]) => set('editorFontSize')(v ?? 13)} aria-label="Code font size" />
              </Row>
              <Row label="Tab size">
                <Segmented
                  aria-label="Tab size"
                  value={String(prefs.tabSize) as '2' | '4'}
                  onValueChange={(v) => set('tabSize')(v === '4' ? 4 : 2)}
                  options={[
                    { value: '2', label: '2 Spaces' },
                    { value: '4', label: '4 Spaces' },
                  ]}
                />
              </Row>
              <Row id="pref-word-wrap" label="Word wrap" hint="Wrap at the viewport instead of scrolling sideways">
                <Switch id="pref-word-wrap" checked={prefs.wordWrap} onCheckedChange={set('wordWrap')} aria-label="Word wrap" />
              </Row>
              <Row id="pref-line-numbers" label="Line numbers">
                <Switch id="pref-line-numbers" checked={prefs.lineNumbers} onCheckedChange={set('lineNumbers')} aria-label="Line numbers" />
              </Row>
              <Row id="pref-bracket-colors" label="Bracket pair colorization">
                <Switch id="pref-bracket-colors" checked={prefs.bracketColors} onCheckedChange={set('bracketColors')} aria-label="Bracket pair colorization" />
              </Row>
            </TabsContent>

            <TabsContent value="collab" className="flex flex-col gap-1">
              <Row id="pref-follow-unlock" label="Unlock follow on own input" hint="Typing or scrolling stops following">
                <Switch id="pref-follow-unlock" checked={prefs.followUnlockOnInput} onCheckedChange={set('followUnlockOnInput')} aria-label="Unlock follow on own input" />
              </Row>
              <Row label={`Cursor name fade (${prefs.cursorFlagFadeSeconds.toFixed(1)}s)`}>
                <Slider className="w-52" min={1} max={5} step={0.5} value={[prefs.cursorFlagFadeSeconds]} onValueChange={([v]) => set('cursorFlagFadeSeconds')(v ?? 2)} aria-label="Cursor name fade seconds" />
              </Row>
              <Row id="pref-offscreen-badges" label="Off-screen cursor badges" hint="Pin collaborators above or below the viewport">
                <Switch id="pref-offscreen-badges" checked={prefs.offscreenCursorBadges} onCheckedChange={set('offscreenCursorBadges')} aria-label="Off-screen cursor badges" />
              </Row>
            </TabsContent>

            <TabsContent value="network" className="flex flex-col gap-1">
              <Row id="pref-telemetry" label="Live latency sampling" hint="Plot RTT in the diagnostics drawer">
                <Switch id="pref-telemetry" checked={prefs.telemetrySampling} onCheckedChange={set('telemetrySampling')} aria-label="Live latency sampling" />
              </Row>
              <Row label={`Simulated latency (${prefs.simulatedLatencyMs} ms)`} hint="Demo tool: delays every message to show convergence">
                <Slider
                  className="w-52"
                  min={0}
                  max={500}
                  step={10}
                  value={[prefs.simulatedLatencyMs]}
                  onValueChange={([v]) => {
                    set('simulatedLatencyMs')(v ?? 0);
                    onLatencyChange?.(v ?? 0);
                  }}
                  aria-label="Simulated latency"
                />
              </Row>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Row({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl px-2 py-2.5 transition-ui hover:bg-accent/40">
      <div className="min-w-0">
        {id ? (
          <label htmlFor={id} className="cursor-pointer text-body font-medium select-none">
            {label}
          </label>
        ) : (
          <p className="text-body font-medium">{label}</p>
        )}
        {hint && <p className="text-caption text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
