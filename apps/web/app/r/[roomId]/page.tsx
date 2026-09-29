import type { Metadata } from 'next';
import { RoomScreen } from '@/components/workspace/room-screen';

export async function generateMetadata({ params }: { params: Promise<{ roomId: string }> }): Promise<Metadata> {
  const { roomId } = await params;
  return { title: roomId };
}

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <RoomScreen roomId={decodeURIComponent(roomId).toLowerCase()} />;
}
