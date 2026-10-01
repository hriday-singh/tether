import {
  AlertCircleIcon,
  CodeIcon,
  CpuIcon,
  CrownIcon,
  Edit02Icon,
  Key01Icon,
  LockKeyIcon,
  PlusSignIcon,
  Shield01Icon,
  SquareUnlock01Icon,
  UserAdd01Icon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons';
import type { AuditEvent } from '@tether/shared';
import type { IconData } from '@/components/ui/icon';
import { languageInfo } from '@/lib/languages';

export interface EventView {
  icon: IconData;
  text: string;
  tone: 'neutral' | 'primary' | 'warning' | 'destructive' | 'success';
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Audit event -> one readable line (docs/06 audit event types). Unknown types still render. */
export function describeEvent(e: AuditEvent): EventView {
  const who = e.actorName ?? 'Someone';
  const p = e.payload;
  switch (e.type) {
    case 'room.created':
      return { icon: PlusSignIcon, text: `${who} created the room (${languageInfo(str(p.language)).label})`, tone: 'primary' };
    case 'member.joined':
      return { icon: UserAdd01Icon, text: `${who} joined`, tone: 'success' };
    case 'member.left': {
      const name = str(p.name, who);
      const reason = str(p.reason);
      const text =
        reason === 'kicked' ? `${name} was removed by the host` : reason === 'timeout' ? `${name} timed out` : `${name} left`;
      return { icon: UserRemove01Icon, text, tone: reason === 'kicked' ? 'destructive' : 'neutral' };
    }
    case 'host.changed':
      return { icon: CrownIcon, text: `${str(p.toName, 'Someone')} is now host`, tone: 'warning' };
    case 'room.locked':
      return { icon: LockKeyIcon, text: `${who} locked the room`, tone: 'warning' };
    case 'room.unlocked':
      return { icon: SquareUnlock01Icon, text: `${who} unlocked the room`, tone: 'neutral' };
    case 'room.passcode':
      return { icon: Key01Icon, text: `${who} ${str(p.action, 'changed')} the password`, tone: 'neutral' };
    case 'room.language':
      return {
        icon: CodeIcon,
        text: `${who} switched ${languageInfo(str(p.from)).label} to ${languageInfo(str(p.to)).label}`,
        tone: 'primary',
      };
    case 'edit.summary': {
      const lines = Array.isArray(p.lines) ? p.lines.map(num) : [];
      const range = lines.length === 2 ? (lines[0] === lines[1] ? `L${lines[0]}` : `L${lines[0]}–${lines[1]}`) : '';
      return { icon: Edit02Icon, text: `${who} edited ${range} (+${num(p.inserted)} −${num(p.deleted)})`.replace('  ', ' '), tone: 'neutral' };
    }
    case 'throttle.applied':
      return { icon: AlertCircleIcon, text: `${who} was batched to 5 updates/s (nothing lost)`, tone: 'warning' };
    case 'security.flood':
      return { icon: Shield01Icon, text: `${who} was disconnected for sending too much, too fast`, tone: 'destructive' };
    case 'security.protocol':
      return { icon: Shield01Icon, text: `${who} was disconnected after sending invalid data`, tone: 'destructive' };
    case 'demo.storm':
      return { icon: CpuIcon, text: `${who} launched Chaos: ${num(p.bots)} bots, ${num(p.seconds)} s${p.faults ? ', faults on' : ''}`, tone: 'primary' };
    case 'demo.storm_completed': {
      const converged = p.converged;
      const label = converged === true ? 'Converged' : converged === false ? 'Diverged' : 'Verifying';
      const tone: EventView['tone'] = converged === true ? 'success' : converged === false ? 'destructive' : 'primary';
      return { icon: CpuIcon, text: `Chaos complete: ${num(p.bots)} bots · ${num(p.ops)} ops · ${(num(p.durationMs) / 1000).toFixed(1)}s — ${label}`, tone };
    }
    default:
      return { icon: AlertCircleIcon, text: `${who}: ${e.type}`, tone: 'neutral' };
  }
}
