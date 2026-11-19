import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Recording } from '../recordings/recording.entity.js';
import { User } from '../users/user.entity.js';

export type BroadcastStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'cancelled';

/**
 * pending   : 아직 전화를 걸지 않음
 * ringing   : 푸시 발송, 응답 대기 중
 * retrying  : 미응답/거절 → 재시도 대기 중
 * answered  : 받아서 듣는 중
 * completed : 끝까지 들음            (종료 상태)
 * partial   : 받았지만 중간에 끊음   (종료 상태)
 * missed    : 재시도까지 모두 미응답 (종료 상태)
 * cancelled : 방송 취소              (종료 상태)
 */
export type BroadcastTargetStatus =
  | 'pending'
  | 'ringing'
  | 'retrying'
  | 'answered'
  | 'completed'
  | 'partial'
  | 'missed'
  | 'cancelled';

export const TERMINAL_TARGET_STATUSES: BroadcastTargetStatus[] = [
  'completed',
  'partial',
  'missed',
  'cancelled',
];

export const ACTIVE_TARGET_STATUSES: BroadcastTargetStatus[] = [
  'pending',
  'ringing',
  'retrying',
  'answered',
];

@Entity('broadcasts')
export class Broadcast {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column()
  recordingId: number;

  @ManyToOne(() => Recording, { eager: true })
  @JoinColumn({ name: 'recordingId' })
  recording: Recording;

  @Column({ type: 'varchar', default: 'draft' })
  status: BroadcastStatus;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ type: 'int' })
  maxAttempts: number;

  @Column({ type: 'int' })
  retryDelaySec: number;

  @Column({ type: 'int', nullable: true })
  createdById: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => BroadcastTarget, (t) => t.broadcast)
  targets: BroadcastTarget[];
}

@Entity('broadcast_targets')
@Index(['broadcastId', 'userId'], { unique: true })
export class BroadcastTarget {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  broadcastId: number;

  @ManyToOne(() => Broadcast, (b) => b.targets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'broadcastId' })
  broadcast: Broadcast;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'varchar', default: 'pending' })
  status: BroadcastTargetStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastRingAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  answeredAt: Date | null;

  @Column({ type: 'int', default: 0 })
  listenedSec: number;

  @Column({ default: false })
  listenedFully: boolean;

  @Column({ type: 'int', default: 0 })
  playCount: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
