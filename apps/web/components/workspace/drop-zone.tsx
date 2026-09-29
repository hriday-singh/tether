'use client';

import { ArrowUp01Icon, File01Icon, Note01Icon } from '@hugeicons/core-free-icons';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { toast } from '@/components/ui/toaster';
import { useStore } from '@/lib/hooks';
import { LANGUAGES, type LanguageId } from '@/lib/languages';
import { useWorkspace } from './context';

export function DropZoneOverlay() {
  const ws = useWorkspace();
  const room = useStore(ws.client.room);
  const isHost = room.hostId === room.selfId;

  const [isDragging, setIsDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ name: string; content: string; langId: LanguageId | null } | null>(null);

  useEffect(() => {
    let counter = 0;

    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      counter++;
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragging(true);
      }
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      counter--;
      if (counter <= 0) {
        setIsDragging(false);
        counter = 0;
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      counter = 0;
      setIsDragging(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        
        // Find language by extension
        const found = Object.values(LANGUAGES).find((l) => l.ext === ext);
        const langId = found?.id ?? null;

        if (!isHost) {
          // Guarded for non-hosts: route cleanly into Scratchpad
          ws.client.doc.transact(() => {
            const pad = ws.client.scratchpadText;
            const current = pad.toString();
            const sep = current.length > 0 && !current.endsWith('\n') ? '\n\n' : '';
            pad.insert(pad.length, `${sep}// --- ${file.name} ---\n${text}`);
          });
          ws.ui.update((s) => ({ ...s, sidebarOpen: true, sidebarTab: 'scratchpad' }));
          toast.info(`Added "${file.name}" to Scratchpad`, {
            description: 'Only the room host can replace the main document.',
          });
          return;
        }

        // Host workflow: if main editor is empty, auto-populate
        if (ws.client.text.length === 0) {
          ws.client.doc.transact(() => {
            ws.client.text.insert(0, text);
          });
          if (langId && langId !== room.room.language) {
            void ws.client.command({ t: 'room.language', language: langId });
          }
          toast.success(`Imported "${file.name}" into editor`);
          return;
        }

        // Host has existing code: prompt choice
        setPendingFile({ name: file.name, content: text, langId });
      } catch {
        toast.error('Could not read dropped file');
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [isHost, room.room.language, ws]);

  const handleReplaceMain = () => {
    if (!pendingFile) return;
    ws.client.doc.transact(() => {
      ws.client.text.delete(0, ws.client.text.length);
      ws.client.text.insert(0, pendingFile.content);
    });
    if (pendingFile.langId && pendingFile.langId !== room.room.language) {
      void ws.client.command({ t: 'room.language', language: pendingFile.langId });
    }
    toast.success(`Replaced main document with "${pendingFile.name}"`);
    setPendingFile(null);
  };

  const handleAddToScratchpad = () => {
    if (!pendingFile) return;
    ws.client.doc.transact(() => {
      const pad = ws.client.scratchpadText;
      const current = pad.toString();
      const sep = current.length > 0 && !current.endsWith('\n') ? '\n\n' : '';
      pad.insert(pad.length, `${sep}// --- ${pendingFile.name} ---\n${pendingFile.content}`);
    });
    ws.ui.update((s) => ({ ...s, sidebarOpen: true, sidebarTab: 'scratchpad' }));
    toast.success(`Added "${pendingFile.name}" to Scratchpad`);
    setPendingFile(null);
  };

  return (
    <>
      {/* Dragging Visual Backdrop Overlay */}
      {isDragging && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/60 bg-card/90 p-8 shadow-card text-center">
            <div className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
              <Icon icon={ArrowUp01Icon} size={28} />
            </div>
            <h3 className="text-title font-semibold tracking-tight text-foreground">
              Drop file to import
            </h3>
            <p className="max-w-xs text-caption text-muted-foreground">
              {isHost
                ? 'Drop to replace document or add to Scratchpad'
                : 'Drop to add file safely to the Shared Scratchpad'}
            </p>
          </div>
        </div>
      )}

      {/* Host Confirmation Dialog */}
      <Dialog open={pendingFile !== null} onOpenChange={(open) => !open && setPendingFile(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import &ldquo;{pendingFile?.name}&rdquo;</DialogTitle>
            <DialogDescription>
              How would you like to import this file into the workspace?
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handleAddToScratchpad} className="flex-1">
              <Icon icon={Note01Icon} />
              Add to Scratchpad
            </Button>
            <Button variant="primary" onClick={handleReplaceMain} className="flex-1">
              <Icon icon={File01Icon} />
              Replace Main Editor
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
