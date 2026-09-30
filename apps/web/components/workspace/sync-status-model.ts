import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  PauseIcon,
  WifiOff01Icon,
} from '@hugeicons/core-free-icons';
import type { IconData } from '@/components/ui/icon';
import type { StatusSnapshot } from '@/lib/sync';
import { formatAgo } from '@/lib/utils';

export interface StatusView {
  tone: 'success' | 'warning' | 'destructive' | 'neutral' | 'primary';
  icon: IconData | null;
  orb?: 'connecting' | 'working' | 'breathing' | 'searching' | 'weaving' | null;
  label: string;
  detail: string;
}

/** Pure mapping from sync status to the pill (tested). Never "Verified" while pending > 0 or offline. */
export function describeStatus(s: StatusSnapshot, now: number): StatusView {
  switch (s.connection) {
    case 'restoring':
    case 'connecting':
      return { tone: 'primary', icon: null, orb: 'connecting', label: 'Connecting…', detail: 'Restoring your local copy, then joining the room.' };
    case 'reconnecting': {
      const secs = s.retryAt ? Math.max(0, Math.ceil((s.retryAt - now) / 1000)) : 0;
      return {
        tone: 'warning',
        icon: null,
        orb: 'searching',
        label: secs > 0 ? `Connection lost · retry in ${secs}s` : 'Connection lost · retrying…',
        detail: `Lost connection to the server. Attempt ${Math.max(1, s.attempt)}. Your edits keep saving locally${s.pending ? ` (${s.pending} unsent)` : ''}.`,
      };
    }
    case 'offline':
      return {
        tone: 'destructive',
        icon: WifiOff01Icon,
        orb: null,
        label: s.pending ? `Offline · ${s.pending} unsent` : 'Offline',
        detail: 'No connection to the server. Edits are stored on this device and sync when you are back online.',
      };
    case 'paused':
      return { tone: 'neutral', icon: PauseIcon, orb: null, label: 'Paused', detail: 'Connection paused.' };
    case 'kicked':
    case 'reauth':
    case 'closed':
      return { tone: 'destructive', icon: AlertCircleIcon, orb: null, label: 'Disconnected', detail: 'Lost connection to the server and this session has ended. Reload to rejoin.' };
    case 'online':
      if (s.pending > 0) {
        return { tone: 'warning', icon: null, orb: 'working', label: `Saving (${s.pending})`, detail: `${s.pending} change${s.pending === 1 ? '' : 's'} waiting for the server to commit.` };
      }
      if (s.verifiedAt === null) {
        return { tone: 'primary', icon: null, orb: 'breathing', label: 'Syncing…', detail: 'Waiting for the room to go quiet to verify.' };
      }
      return {
        tone: 'success',
        icon: CheckmarkCircle02Icon,
        orb: null,
        label: 'Verified in sync',
        detail: `Checksum 0x${s.checksum ?? '--------'} · verified ${formatAgo(now - s.verifiedAt)}`,
      };
  }
}
