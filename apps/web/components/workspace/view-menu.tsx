'use client';

import {
  AiMagicIcon,
  BrowserIcon,
  CodeIcon,
  CpuIcon,
  FullScreenIcon,
  Layout01Icon,
  MaximizeScreenIcon,
  MinimizeScreenIcon,
  Note01Icon,
  Search01Icon,
  SidebarRightIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { openSearchPanel } from '@codemirror/search';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menus';
import { DEMO_MODE } from '@/lib/api';
import { useStore } from '@/lib/hooks';
import { languageInfo } from '@/lib/languages';
import { useWorkspace, type UIState } from './context';

export function ViewMenu() {
  const ws = useWorkspace();
  const ui = useStore(ws.ui);
  const room = useStore(ws.client.room);
  const lang = languageInfo(room.room.language);
  const hasPreview = lang.preview !== null;

  return (
    <DropdownMenu>
      <Tip label="Views & Panels">
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="Views and panels">
            <Icon icon={Layout01Icon} size={15} />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-56">
        <WorkspacePanelsItems ws={ws} ui={ui} hasPreview={hasPreview} />
        <DiagnosticsViewsItems ws={ws} ui={ui} />

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => ws.ui.update((s) => ({ ...s, zenMode: !s.zenMode }))}>
          <Icon icon={FullScreenIcon} />
          <span>{ui.zenMode ? 'Exit Zen Mode' : 'Zen Mode'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspacePanelsItems({
  ws,
  ui,
  hasPreview,
}: {
  ws: ReturnType<typeof useWorkspace>;
  ui: UIState;
  hasPreview: boolean;
}) {
  return (
    <>
      <DropdownMenuLabel>Workspace Panels</DropdownMenuLabel>

      <DropdownMenuItem onSelect={() => ws.maximizePanel('editor')}>
        <Icon icon={ui.maximizedPanel === 'editor' ? MinimizeScreenIcon : MaximizeScreenIcon} />
        <span>{ui.maximizedPanel === 'editor' ? 'Restore Editor' : 'Maximize Editor'}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        onSelect={() => {
          if (ws.view.current) openSearchPanel(ws.view.current);
        }}
      >
        <Icon icon={Search01Icon} />
        <span>Find in Document</span>
      </DropdownMenuItem>

      <DropdownMenuItem onSelect={() => ws.togglePanel('sidebar')}>
        <Icon icon={SidebarRightIcon} />
        <span>Sidebar</span>
        {ui.sidebarOpen && <Icon icon={Tick02Icon} size={14} className="ml-auto text-primary" />}
      </DropdownMenuItem>

      {hasPreview && (
        <DropdownMenuItem onSelect={() => ws.togglePanel('preview')}>
          <Icon icon={BrowserIcon} />
          <span>Live Preview</span>
          {ui.previewOpen && <Icon icon={Tick02Icon} size={14} className="ml-auto text-primary" />}
        </DropdownMenuItem>
      )}
    </>
  );
}

function DiagnosticsViewsItems({
  ws,
  ui,
}: {
  ws: ReturnType<typeof useWorkspace>;
  ui: UIState;
}) {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Diagnostics &amp; Views</DropdownMenuLabel>

      <DropdownMenuItem onSelect={() => ws.openDrawerTab('console')}>
        <Icon icon={CodeIcon} />
        <span>Console &amp; REPL</span>
        {ui.drawerOpen && ui.drawerTab === 'console' && (
          <Icon icon={Tick02Icon} size={14} className="ml-auto text-primary" />
        )}
      </DropdownMenuItem>

      <DropdownMenuItem onSelect={() => ws.openDrawerTab('sync')}>
        <Icon icon={CpuIcon} />
        <span>Sync &amp; Latency Stats</span>
        {ui.drawerOpen && ui.drawerTab === 'sync' && (
          <Icon icon={Tick02Icon} size={14} className="ml-auto text-primary" />
        )}
      </DropdownMenuItem>

      {DEMO_MODE && (
        <DropdownMenuItem onSelect={() => ws.openDrawerTab('chaos')}>
          <Icon icon={AiMagicIcon} />
          <span>Chaos Lab</span>
          {ui.drawerOpen && ui.drawerTab === 'chaos' && (
            <Icon icon={Tick02Icon} size={14} className="ml-auto text-primary" />
          )}
        </DropdownMenuItem>
      )}

      <DropdownMenuItem
        onSelect={() => ws.ui.update((s) => ({ ...s, sidebarOpen: true, sidebarTab: 'scratchpad' }))}
      >
        <Icon icon={Note01Icon} />
        <span>Shared Scratchpad</span>
        {ui.sidebarOpen && ui.sidebarTab === 'scratchpad' && (
          <Icon icon={Tick02Icon} size={14} className="ml-auto text-primary" />
        )}
      </DropdownMenuItem>
    </>
  );
}
