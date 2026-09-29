import { AlertCircleIcon, Home01Icon } from '@hugeicons/core-free-icons';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { CenterCard } from '@/components/workspace/gates';

export default function NotFound() {
  return (
    <CenterCard
      icon={AlertCircleIcon}
      title="Page not found"
      actions={
        <Button asChild>
          <Link href="/">
            <Icon icon={Home01Icon} /> Return to Home
          </Link>
        </Button>
      }
    >
      That page does not exist.
    </CenterCard>
  );
}
