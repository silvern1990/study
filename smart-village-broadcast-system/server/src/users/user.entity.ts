import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type UserRole = 'admin' | 'resident';
export type PushPlatform = 'ios' | 'android';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', default: 'resident' })
  role: UserRole;

  /** SIP 계정 = 내선번호 (예: 20001) */
  @Column({ type: 'varchar', unique: true, nullable: true })
  extension: string | null;

  // TODO: 운영에서는 평문 대신 a1-hash(md5(user:domain:password))만 저장하는 방식을 고려
  @Column({ select: false })
  sipPassword: string;

  @Column({ type: 'varchar', nullable: true })
  pushPlatform: PushPlatform | null;

  /** FCM 토큰 (Android) 또는 일반 APNs 토큰 (iOS) */
  @Column({ type: 'varchar', nullable: true })
  pushToken: string | null;

  /** iOS PushKit VoIP 토큰 */
  @Column({ type: 'varchar', nullable: true })
  voipPushToken: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
